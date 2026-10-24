import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  identifyBsp,
  normalizeGameAssetPath,
  parseBsp,
  planWorldAssets,
  type BspFormat,
  type BspIdentification,
  type BspWarning,
  type WorldAssetPlan,
} from "@jackharrhy/tea-maps-renderer/core";
import { existsSync } from "node:fs";
import {
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import sharp from "sharp";

const uploadsDirectory = resolve(
  process.env.ARTBIN_PUBLIC_DIR ?? join(process.cwd(), "public"),
  "uploads",
);

export interface BspDependencyManifest {
  format: BspFormat;
  version: BspIdentification["version"];
  warnings: readonly BspWarning[];
  assets: WorldAssetPlan;
}

export function getBspDependencyPath(filePath: string): string {
  return siblingPath(filePath, ".artbin-bsp.json");
}

export function getBspWalkabilityPath(filePath: string): string {
  return siblingPath(filePath, ".worldview-walkability.json");
}

export function getBspThumbnailPath(filePath: string): string {
  const file = parse(filePath);
  return getUploadPath(join(dirname(filePath), `${file.base}.thumbnail.webp`));
}

const thumbnailWidth = 384;

export async function createBspThumbnail(png: Uint8Array): Promise<Buffer> {
  return sharp(png)
    .resize(thumbnailWidth, thumbnailWidth, { fit: "inside" })
    .webp({ quality: 82 })
    .toBuffer();
}

const pendingThumbnails = new Map<string, Promise<void>>();

export async function ensureBspThumbnail(filePath: string): Promise<string> {
  const thumbnailPath = getBspThumbnailPath(filePath);
  let pending = pendingThumbnails.get(thumbnailPath);
  if (!pending) {
    pending = refreshBspThumbnail(filePath, thumbnailPath).finally(() => {
      pendingThumbnails.delete(thumbnailPath);
    });
    pendingThumbnails.set(thumbnailPath, pending);
  }
  await pending;
  return thumbnailPath;
}

async function refreshBspThumbnail(
  filePath: string,
  thumbnailPath: string,
): Promise<void> {
  const previewPath = getUploadPath(`${filePath}.preview.png`);
  const preview = await stat(previewPath);
  const thumbnail = await stat(thumbnailPath).catch(() => null);
  if (thumbnail && thumbnail.mtimeMs >= preview.mtimeMs) return;
  await writeDerivedFile(
    thumbnailPath,
    await createBspThumbnail(await readFile(previewPath)),
  );
}

export function hasBspWalkability(filePath: string): boolean {
  return existsSync(getBspWalkabilityPath(filePath));
}

export function inspectBspDependencies(
  bytes: ArrayBuffer | ArrayBufferView,
): BspDependencyManifest {
  const world = parseBsp(bytes);
  return {
    format: world.format,
    version: world.version,
    warnings: world.warnings,
    assets: planWorldAssets(world, { includeViewerDefaults: false }),
  };
}

export async function writeBspDependencyManifest(
  filePath: string,
  bytes: ArrayBufferView,
) {
  const manifest = inspectBspDependencies(bytes);
  await writeDerivedFile(
    getBspDependencyPath(filePath),
    JSON.stringify(manifest),
  );
  return manifest;
}

export async function refreshBspDependencyManifest(
  filePath: string,
  bytes: ArrayBufferView,
) {
  try {
    return await writeBspDependencyManifest(filePath, bytes);
  } catch {
    await unlink(getBspDependencyPath(filePath)).catch(() => {});
    return null;
  }
}

export async function readBspDependencyManifest(
  filePath: string,
): Promise<BspDependencyManifest | null> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(getBspDependencyPath(filePath), "utf8"),
    );
    return isBspDependencyManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function identifyBspFile(
  filePath: string,
): Promise<BspIdentification | null> {
  try {
    const handle = await open(getUploadPath(filePath), "r");
    try {
      const prefix = Buffer.allocUnsafe(8);
      const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0);
      return identifyBsp(prefix.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

export async function writeDerivedFile(
  path: string,
  contents: string | Uint8Array,
): Promise<void> {
  const temporaryPath = `${path}.tmp-${crypto.randomUUID()}`;
  try {
    await writeFile(temporaryPath, contents);
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

function siblingPath(filePath: string, suffix: string): string {
  const file = parse(filePath);
  const target = resolve(
    uploadsDirectory,
    dirname(filePath),
    `${file.name}${suffix}`,
  );
  const relativePath = relative(uploadsDirectory, target);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("Invalid BSP derivative path");
  }
  return target;
}

function getUploadPath(filePath: string): string {
  const target = resolve(uploadsDirectory, filePath);
  const relativePath = relative(uploadsDirectory, target);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("Invalid BSP path");
  }
  return target;
}

function isBspDependencyManifest(
  value: unknown,
): value is BspDependencyManifest {
  if (!isRecord(value) || !isBspIdentification(value.format, value.version))
    return false;
  if (!Array.isArray(value.warnings) || !value.warnings.every(isWarning))
    return false;
  return isWorldAssetPlan(value.assets);
}

function isWorldAssetPlan(value: unknown): value is WorldAssetPlan {
  if (!isRecord(value)) return false;
  if (value.palette !== null && !isPalettePlan(value.palette)) return false;
  if (!Array.isArray(value.wads) || !value.wads.every(isWadPlan)) return false;
  if (!Array.isArray(value.textures) || !value.textures.every(isTexturePlan))
    return false;
  if (value.skybox !== null && !isSkyboxPlan(value.skybox)) return false;
  if (!Array.isArray(value.sprites) || !value.sprites.every(isSpritePlan))
    return false;
  return Array.isArray(value.sounds) && value.sounds.every(isSoundPlan);
}

function hasCandidates(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Array.isArray(value.candidates) &&
    value.candidates.every(isAssetPath)
  );
}

function isPalettePlan(value: unknown): boolean {
  return hasCandidates(value) && value.kind === "palette";
}

function isWadPlan(value: unknown): boolean {
  return (
    hasCandidates(value) &&
    value.kind === "wad" &&
    isWadReference(value.reference)
  );
}

function isTexturePlan(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.kind === "texture" &&
    typeof value.name === "string" &&
    isIntegerArray(value.materialIndices) &&
    Array.isArray(value.imageCandidates) &&
    value.imageCandidates.every(isAssetPath) &&
    Array.isArray(value.walCandidates) &&
    value.walCandidates.every(isAssetPath)
  );
}

function isSkyboxPlan(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.kind === "skybox" &&
    typeof value.name === "string" &&
    Array.isArray(value.faces) &&
    value.faces.every(
      (face) =>
        hasCandidates(face) &&
        ["rt", "bk", "lf", "ft", "up", "dn"].includes(face.suffix as string),
    )
  );
}

function isSpritePlan(value: unknown): boolean {
  return (
    hasCandidates(value) &&
    value.kind === "sprite" &&
    isAssetReference(value.reference) &&
    isIntegerArray(value.entityIndices)
  );
}

function isSoundPlan(value: unknown): boolean {
  return (
    hasCandidates(value) &&
    value.kind === "sound" &&
    ["ambient", "music", "player"].includes(value.usage as string) &&
    ["map", "viewer-default"].includes(value.origin as string) &&
    isAssetReference(value.reference)
  );
}

function isWadReference(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.declaredPath === "string" &&
    typeof value.basename === "string"
  );
}

function isAssetReference(value: unknown): boolean {
  return (
    isWadReference(value) &&
    isRecord(value) &&
    typeof value.normalizedPath === "string" &&
    isAssetPath(value.normalizedPath)
  );
}

function isIntegerArray(value: unknown): boolean {
  return (
    Array.isArray(value) && value.every((entry) => Number.isSafeInteger(entry))
  );
}

function isWarning(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.message === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAssetPath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return normalizeGameAssetPath(value) === value;
  } catch {
    return false;
  }
}

function isBspIdentification(
  format: unknown,
  version: unknown,
): format is BspFormat {
  return (
    (format === "quake-bsp29" && version === 29) ||
    (format === "quake-bsp2" && version === "BSP2") ||
    (format === "goldsrc-bsp30" && version === 30) ||
    (format === "quake2-bsp38" && version === 38)
  );
}
