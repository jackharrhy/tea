import {
  decodeTga,
  decodeWalTexture,
  readPcxPalette,
  readWalTextureHeader,
  validateTextureDimensions,
  type DecodedMipTexture,
  type WorldPaletteAssetPlan,
  type WorldSkyboxAssetPlan,
  type WorldTextureAssetPlan,
} from "../core/index.js";
import type { LoadedMaterialTexture, LoadedSkybox } from "../render/assets.js";
import { abortIfNeeded, type LoadAssetContext } from "./asset-source.js";
import { GameAssetLoader } from "./game-asset-source.js";
import type { WarningDetail } from "./types.js";

interface Quake2MaterialStage {
  readonly value: {
    readonly materialTextures: ReadonlyMap<number, LoadedMaterialTexture>;
    readonly missingTextures: readonly string[];
  };
  readonly warnings: readonly WarningDetail[];
}

interface DecodedImage {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

const MAX_CONCURRENT_TEXTURE_LOADS = 8;
type ReplacementExtension = "png" | "tga" | "jpg" | "jpeg";

function imageMediaType(extension: ReplacementExtension): string {
  if (extension === "png") return "image/png";
  if (extension === "tga") return "image/x-tga";
  return "image/jpeg";
}

async function decodeBrowserImage(
  bytes: ArrayBuffer,
  mediaType: string,
  context: LoadAssetContext,
): Promise<DecodedImage> {
  if (typeof createImageBitmap !== "function") {
    throw new Error(`${mediaType} texture decoding requires createImageBitmap`);
  }
  const bitmap = await createImageBitmap(
    new Blob([bytes], { type: mediaType }),
  );
  abortIfNeeded(context.signal);
  try {
    validateTextureDimensions(
      bitmap.width,
      bitmap.height,
      `${mediaType} texture`,
    );
    const canvas =
      typeof OffscreenCanvas === "function"
        ? new OffscreenCanvas(bitmap.width, bitmap.height)
        : Object.assign(document.createElement("canvas"), {
            width: bitmap.width,
            height: bitmap.height,
          });
    const drawing = canvas.getContext("2d", { willReadFrequently: true });
    if (!drawing)
      throw new Error(
        `could not create a canvas for ${mediaType} texture decoding`,
      );
    drawing.drawImage(bitmap, 0, 0);
    const pixels = drawing.getImageData(0, 0, bitmap.width, bitmap.height);
    return {
      width: bitmap.width,
      height: bitmap.height,
      rgba: new Uint8Array(pixels.data.buffer.slice(0)),
    };
  } finally {
    bitmap.close();
  }
}

export async function decodeQuake2Image(
  bytes: ArrayBuffer,
  extension: ReplacementExtension,
  context: LoadAssetContext,
): Promise<DecodedImage> {
  if (extension === "tga") return decodeTga(bytes);
  return decodeBrowserImage(bytes, imageMediaType(extension), context);
}

export async function loadQuake2Palette(
  plan: WorldPaletteAssetPlan,
  loader: GameAssetLoader,
): Promise<Uint8Array | undefined> {
  for (const candidate of plan.candidates) {
    const bytes = await loader.read(candidate, "palette");
    if (bytes) return readPcxPalette(bytes);
  }
  return undefined;
}

export async function loadQuake2Skybox(
  plan: WorldSkyboxAssetPlan,
  loader: GameAssetLoader,
  context: LoadAssetContext,
): Promise<LoadedSkybox | undefined> {
  const entries = await Promise.all(
    plan.faces.map(async ({ suffix, candidates }) => {
      for (const path of candidates) {
        const extension = replacementExtension(path);
        const bytes = await loader.read(path, "skybox");
        if (bytes)
          return [
            suffix,
            await decodeQuake2Image(bytes, extension, context),
          ] as const;
      }
      return null;
    }),
  );
  if (entries.some((entry) => entry === null)) return undefined;
  const decoded = new Map(entries.filter((entry) => entry !== null));
  const sides: LoadedSkybox["sides"] = {
    rt: decoded.get("rt")!,
    bk: decoded.get("bk")!,
    lf: decoded.get("lf")!,
    ft: decoded.get("ft")!,
    up: decoded.get("up")!,
    dn: decoded.get("dn")!,
  };
  const first = sides.rt;
  if (
    !plan.faces.every(
      ({ suffix }) =>
        sides[suffix].width === first.width &&
        sides[suffix].height === first.height,
    )
  ) {
    throw new Error(
      `Quake II skybox ${plan.name} faces do not have matching dimensions`,
    );
  }
  return { name: plan.name, sides };
}

function replacementExtension(path: string): ReplacementExtension {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  switch (extension) {
    case "png":
    case "tga":
    case "jpg":
    case "jpeg":
      return extension;
    default:
      throw new Error(`unsupported Quake II replacement extension in ${path}`);
  }
}

async function firstReplacement(
  candidates: readonly string[],
  loader: GameAssetLoader,
  context: LoadAssetContext,
  warnings: WarningDetail[],
): Promise<{ readonly image: DecodedImage; readonly path: string } | null> {
  for (const path of candidates) {
    const bytes = await loader.read(path, "texture");
    if (!bytes) continue;
    try {
      return {
        image: await decodeQuake2Image(
          bytes,
          replacementExtension(path),
          context,
        ),
        path,
      };
    } catch (error) {
      abortIfNeeded(context.signal);
      warnings.push({
        code: "asset-warning",
        message: `${path} could not be decoded: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return null;
}

async function firstWal(
  candidates: readonly string[],
  loader: GameAssetLoader,
): Promise<{ readonly bytes: ArrayBuffer; readonly path: string } | null> {
  for (const path of candidates) {
    const bytes = await loader.read(path, "texture");
    if (bytes) return { bytes, path };
  }
  return null;
}

function decodedTexture(name: string, image: DecodedImage): DecodedMipTexture {
  return {
    name,
    width: image.width,
    height: image.height,
    levels: [{ width: image.width, height: image.height, rgba: image.rgba }],
    alphaTest: false,
  };
}

async function loadTexture(
  plan: WorldTextureAssetPlan,
  palette: Uint8Array | undefined,
  loader: GameAssetLoader,
  context: LoadAssetContext,
  warnings: WarningDetail[],
): Promise<LoadedMaterialTexture | null> {
  const [replacement, wal] = await Promise.all([
    firstReplacement(plan.imageCandidates, loader, context, warnings),
    firstWal(plan.walCandidates, loader),
  ]);
  abortIfNeeded(context.signal);
  if (replacement) {
    let logical: { readonly width: number; readonly height: number } =
      replacement.image;
    if (wal) {
      try {
        logical = readWalTextureHeader(wal.bytes);
      } catch (error) {
        warnings.push({
          code: "asset-warning",
          message: `${wal.path} could not supply replacement dimensions: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    return {
      texture: decodedTexture(plan.name, replacement.image),
      logicalWidth: logical.width,
      logicalHeight: logical.height,
    };
  }
  if (!wal || !palette) return null;
  try {
    const decoded = decodeWalTexture(wal.bytes, palette);
    return {
      texture: { ...decoded, alphaTest: false },
      logicalWidth: decoded.width,
      logicalHeight: decoded.height,
    };
  } catch (error) {
    warnings.push({
      code: "asset-warning",
      message: `${wal.path} could not be decoded: ${error instanceof Error ? error.message : String(error)}`,
    });
    return null;
  }
}

export async function loadQuake2MaterialTextures(
  plans: readonly WorldTextureAssetPlan[],
  palette: Uint8Array | undefined,
  loader: GameAssetLoader,
  context: LoadAssetContext,
): Promise<Quake2MaterialStage> {
  const entries = plans;
  const materialTextures = new Map<number, LoadedMaterialTexture>();
  const missingTextures = new Set<string>();
  const assetWarnings = new Map<string, readonly WarningDetail[]>();
  let completed = 0;
  let next = 0;

  await Promise.all(
    Array.from(
      { length: Math.min(MAX_CONCURRENT_TEXTURE_LOADS, entries.length) },
      async () => {
        while (next < entries.length) {
          const entry = entries[next++];
          if (!entry) return;
          const entryWarnings: WarningDetail[] = [];
          const texture = await loadTexture(
            entry,
            palette,
            loader,
            context,
            entryWarnings,
          );
          if (entryWarnings.length > 0)
            assetWarnings.set(entry.name.toLowerCase(), entryWarnings);
          if (texture) {
            for (const materialIndex of entry.materialIndices) {
              materialTextures.set(materialIndex, texture);
            }
          } else missingTextures.add(entry.name);
          completed += 1;
          context.progress({
            phase: "textures",
            label: entry.name,
            loaded: completed,
            total: entries.length,
            phaseProgress: { completed, total: entries.length },
          });
        }
      },
    ),
  );

  const missing = [...missingTextures].toSorted();
  return {
    value: { materialTextures, missingTextures: missing },
    warnings: [
      ...[...assetWarnings]
        .toSorted(([left], [right]) => left.localeCompare(right))
        .flatMap(([, warnings]) => warnings),
      ...missing.map((name) => ({
        code: "missing-texture" as const,
        message: `Quake II texture ${name} was not found as a replacement image or WAL`,
      })),
    ],
  };
}
