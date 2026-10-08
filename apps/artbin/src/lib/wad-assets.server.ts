import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  extractTextureFromWad,
  inspectWad,
  type WadContents,
} from "./game-textures.server.ts";

import type { User } from "#db";
import { files } from "#db";
import { db } from "#db/connection.server";
import { eq } from "drizzle-orm";
import { getFilePath } from "./files.server.ts";
import {
  resolveApprovedBspPalette,
  resolveBspPalette,
} from "./bsp-assets.server.ts";
import { getWADTextureFilename, splitWADTexturePath } from "./wad-paths.ts";

const pendingPreviews = new Map<string, Promise<Buffer>>();
const inspectionCache = new Map<string, Promise<WadContents | null>>();

function getWADCacheDirectory(): string {
  return process.env.ARTBIN_CACHE_DIR
    ? join(process.env.ARTBIN_CACHE_DIR, "wad")
    : join(process.cwd(), "data", "cache", "wad");
}

export function isWADFilename(filename: string): boolean {
  return filename.toLowerCase().endsWith(".wad");
}

export async function clearWADPreviewCache(): Promise<void> {
  inspectionCache.clear();
  await rm(getWADCacheDirectory(), { recursive: true, force: true });
}

export async function inspectWADFile(
  filePath: string,
  sha256?: string | null,
): Promise<WadContents | null> {
  const fullPath = getFilePath(filePath);
  const fingerprint =
    sha256 && /^[a-f0-9]{64}$/.test(sha256)
      ? sha256
      : await stat(fullPath).then(
          (metadata) => `${metadata.size}:${metadata.mtimeMs}`,
        );
  const cacheKey = `${filePath}:${fingerprint}`;
  const existing = inspectionCache.get(cacheKey);
  if (existing) return existing;

  const inspection = readFile(fullPath).then(inspectWad);
  inspectionCache.set(cacheKey, inspection);
  try {
    return await inspection;
  } catch (error) {
    inspectionCache.delete(cacheKey);
    throw error;
  }
}

export async function getVisibleWADLibrary(fileId: string, user: User) {
  const file = await db.query.files.findFirst({
    where: eq(files.id, fileId),
  });
  if (!file || !isWADFilename(file.name)) return null;

  const canView =
    file.status === "approved" ||
    file.uploaderId === user.id ||
    Boolean(user.isAdmin);
  if (!canView) return null;

  try {
    const contents = await inspectWADFile(file.path, file.sha256);
    return contents ? { file, contents } : null;
  } catch {
    return null;
  }
}

export async function getVisibleWADLibraryByPath(filePath: string, user: User) {
  const file = await db.query.files.findFirst({
    where: eq(files.path, filePath),
  });
  if (!file) return null;
  return getVisibleWADLibrary(file.id, user);
}

export async function getVisibleWADTextureByPath(path: string, user: User) {
  const virtualPath = splitWADTexturePath(path);
  if (!virtualPath) return null;

  const library = await getVisibleWADLibraryByPath(virtualPath.wadPath, user);
  if (!library) return null;

  const texture = library.contents.textures.find(
    (candidate) =>
      getWADTextureFilename(candidate, library.contents.textures) ===
      virtualPath.textureFilename,
  );
  return texture ? { ...library, texture } : null;
}

async function readCachedPreview(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function getWADTexturePreview(
  file: { path: string; sha256: string | null },
  textureIndex: number,
  user?: User,
): Promise<Buffer | null> {
  if (!Number.isSafeInteger(textureIndex) || textureIndex < 0) return null;

  let buffer: Buffer | null = null;
  let digest = file.sha256;
  if (!digest || !/^[a-f0-9]{64}$/.test(digest)) {
    buffer = await readFile(getFilePath(file.path));
    digest = createHash("sha256").update(buffer).digest("hex");
  }

  const cacheDirectory = join(getWADCacheDirectory(), digest);
  const cachePath = join(cacheDirectory, `${textureIndex}.png`);
  const cached = await readCachedPreview(cachePath);
  if (cached) return cached;

  const existing = pendingPreviews.get(cachePath);
  if (existing) return existing;

  const render = (async () => {
    const wadBuffer = buffer ?? (await readFile(getFilePath(file.path)));
    const paletteAsset =
      inspectWad(wadBuffer).version === "WAD2"
        ? user
          ? await resolveBspPalette(file, user)
          : await resolveApprovedBspPalette(file)
        : null;
    const palette = paletteAsset
      ? new Uint8Array(await readFile(getFilePath(paletteAsset.path)))
      : undefined;
    const texture = await extractTextureFromWad(
      wadBuffer,
      textureIndex,
      palette,
    );
    if (!texture) throw new Error("WAD texture not found");
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(cachePath, texture.pngBuffer);
    return texture.pngBuffer;
  })();
  pendingPreviews.set(cachePath, render);

  try {
    return await render;
  } catch (error) {
    if (error instanceof Error && error.message === "WAD texture not found")
      return null;
    throw error;
  } finally {
    pendingPreviews.delete(cachePath);
  }
}
