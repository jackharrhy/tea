import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type MaterialTextureAsset = {
  file: Bun.BunFile;
  hash: string;
  key: string;
  url: string;
};

export type MaterialTextureManifestEntry = {
  url: string;
  width: number;
  height: number;
  renderMode: "retro" | "reality";
};

const hashFile = async (file: Bun.BunFile): Promise<string> =>
  createHash("sha256")
    .update(await file.bytes())
    .digest("hex");

const encodedTexturePath = (relativePath: string): string =>
  `/textures/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
const encodedSpritePath = (relativePath: string): string =>
  `/sprites/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
const encodedAudioPath = (relativePath: string): string =>
  `/audio/${relativePath.split("/").map(encodeURIComponent).join("/")}`;

export async function loadMaterialTextureManifest(rootUrl: URL): Promise<{
  etag: string;
  textures: Record<string, MaterialTextureManifestEntry>;
}> {
  const root = fileURLToPath(rootUrl);
  const assets: Array<[string, MaterialTextureManifestEntry]> = [];
  for await (const path of new Bun.Glob("**/*.png").scan({
    cwd: root,
    dot: false,
  })) {
    const relativePath = path.replaceAll("\\", "/");
    const file = Bun.file(join(root, path));
    const bytes = await file.bytes();
    const hash = createHash("sha256").update(bytes).digest("hex");
    const { width, height } = pngDimensions(bytes, relativePath);
    assets.push([
      relativePath.slice(0, -4),
      {
        url: `${encodedTexturePath(relativePath)}?v=${hash}`,
        width,
        height,
        renderMode: materialRenderMode(relativePath.slice(0, -4)),
      },
    ]);
  }
  const textures = Object.fromEntries(
    assets.toSorted(([left], [right]) => left.localeCompare(right)),
  );
  const etag = `"${createHash("sha256").update(JSON.stringify(textures)).digest("hex")}"`;
  return { etag, textures };
}

export function materialRenderMode(name: string): "retro" | "reality" {
  return /^GURGUR\/dylans[^/]*$/i.test(name) || /^GURGUR\/REAL\//i.test(name)
    ? "reality"
    : "retro";
}

export async function loadAssetManifest(
  materialRoot: URL,
  spriteRoot: URL,
  audioRoot: URL,
): Promise<{
  etag: string;
  materials: Record<string, MaterialTextureManifestEntry>;
  sprites: Record<string, string>;
  audio: Record<string, string>;
}> {
  const materials = (await loadMaterialTextureManifest(materialRoot)).textures;
  const sprites = await loadLogicalAssetManifest(
    spriteRoot,
    ".png",
    encodedSpritePath,
  );
  const audio = await loadLogicalAssetManifest(
    audioRoot,
    ".mp3",
    encodedAudioPath,
  );
  const value = { materials, sprites, audio };
  return {
    ...value,
    etag: `"${createHash("sha256").update(JSON.stringify(value)).digest("hex")}"`,
  };
}

export async function loadMaterialTextureAsset(
  rootUrl: URL,
  pathname: string,
): Promise<MaterialTextureAsset | null> {
  return loadPngAsset(rootUrl, pathname, "/textures/", encodedTexturePath);
}

export async function loadSpriteAsset(
  rootUrl: URL,
  pathname: string,
): Promise<MaterialTextureAsset | null> {
  return loadFileAsset(
    rootUrl,
    pathname,
    "/sprites/",
    ".png",
    encodedSpritePath,
  );
}

export async function loadAudioAsset(
  rootUrl: URL,
  pathname: string,
): Promise<MaterialTextureAsset | null> {
  return loadFileAsset(rootUrl, pathname, "/audio/", ".mp3", encodedAudioPath);
}

async function loadLogicalAssetManifest(
  rootUrl: URL,
  extension: string,
  encodePath: (relativePath: string) => string,
): Promise<Record<string, string>> {
  const root = fileURLToPath(rootUrl);
  const assets: Array<[string, string]> = [];
  for await (const path of new Bun.Glob(`**/*${extension}`).scan({
    cwd: root,
    dot: false,
  })) {
    const relativePath = path.replaceAll("\\", "/");
    const file = Bun.file(join(root, path));
    const hash = await hashFile(file);
    assets.push([
      relativePath.slice(0, -extension.length),
      `${encodePath(relativePath)}?v=${hash}`,
    ]);
  }
  return Object.fromEntries(
    assets.toSorted(([left], [right]) => left.localeCompare(right)),
  );
}

function pngDimensions(
  bytes: Uint8Array,
  relativePath: string,
): { width: number; height: number } {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.length < 24 ||
    signature.some((value, index) => bytes[index] !== value) ||
    String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR"
  )
    throw new Error(`authored material is not a valid PNG: ${relativePath}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0 || width > 16_384 || height > 16_384)
    throw new Error(
      `authored material PNG dimensions are invalid: ${relativePath}`,
    );
  return { width, height };
}

async function loadPngAsset(
  rootUrl: URL,
  pathname: string,
  prefix: string,
  encodePath: (relativePath: string) => string,
): Promise<MaterialTextureAsset | null> {
  return loadFileAsset(rootUrl, pathname, prefix, ".png", encodePath);
}

async function loadFileAsset(
  rootUrl: URL,
  pathname: string,
  prefix: string,
  extension: string,
  encodePath: (relativePath: string) => string,
): Promise<MaterialTextureAsset | null> {
  if (!pathname.startsWith(prefix)) return null;
  const segments: string[] = [];
  for (const encoded of pathname.slice(prefix.length).split("/")) {
    let segment: string;
    try {
      segment = decodeURIComponent(encoded);
    } catch {
      return null;
    }
    if (
      !segment ||
      segment === "." ||
      segment === ".." ||
      /[/\\]/.test(segment)
    )
      return null;
    segments.push(segment);
  }
  const filename = segments.at(-1);
  if (!filename?.toLowerCase().endsWith(extension)) return null;
  const file = Bun.file(join(fileURLToPath(rootUrl), ...segments));
  if (!(await file.exists())) return null;
  const relativePath = segments.join("/");
  return {
    file,
    hash: await hashFile(file),
    key: relativePath.slice(0, -extension.length),
    url: encodePath(relativePath),
  };
}
