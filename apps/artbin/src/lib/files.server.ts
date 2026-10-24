import {
  mkdir,
  writeFile,
  unlink,
  stat,
  readdir,
  readFile,
  rm,
} from "fs/promises";
import { createReadStream, existsSync, mkdirSync, renameSync } from "fs";
import {
  join,
  dirname,
  basename,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { createHash } from "crypto";
import { Result } from "better-result";
import {
  detectKind,
  isImageKind,
  needsPreview,
  isWebImage,
  type FileKind,
} from "@tea/artbin-core/detection/kind";
import { getMimeType } from "@tea/artbin-core/detection/mime";
import { sanitizeFilename } from "@tea/artbin-core/detection/filenames";
import { nanoid } from "nanoid";
import { generateFolderPreview } from "./folder-preview.server.ts";
import { getAncestorFolderIds } from "./file-queries.server.ts";
import { resolveApprovedWalPalette } from "./bsp-assets.server.ts";
import { walToPng } from "./game-textures.server.ts";
import {
  getBspDependencyPath,
  getBspThumbnailPath,
  getBspWalkabilityPath,
  refreshBspDependencyManifest,
} from "./bsp-derivatives.server.ts";

const execFileAsync = promisify(execFile);

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

// Re-export shared detection utilities for backward compatibility
export {
  detectKind,
  isImageKind,
  needsPreview,
  isWebImage,
  getMimeType,
  sanitizeFilename,
  type FileKind,
};

// Base directories. The overrides let verification runs isolate every mutation
// without touching a developer's real library.
export const PUBLIC_DIR = resolve(
  process.env.ARTBIN_PUBLIC_DIR ?? join(process.cwd(), "public"),
);
export const UPLOADS_DIR = join(PUBLIC_DIR, "uploads");
export const TEMP_DIR = resolve(
  process.env.ARTBIN_TEMP_DIR ?? join(process.cwd(), "tmp", "uploads"),
);

export function slugToPath(slug: string): string {
  return resolveWithin(UPLOADS_DIR, slug);
}

export function getFilePath(filePath: string): string {
  return resolveWithin(UPLOADS_DIR, filePath);
}

export function getPreviewPath(filePath: string): string {
  return resolveWithin(UPLOADS_DIR, filePath + ".preview.png");
}

function resolveWithin(root: string, untrustedPath: string): string {
  if (!untrustedPath || isAbsolute(untrustedPath))
    throw new Error("Invalid upload path");
  const target = resolve(root, untrustedPath);
  const relativePath = relative(root, target);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("Invalid upload path");
  }
  return target;
}

/** Compute sha256 hex digest from a Buffer. */
export function computeSha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Compute sha256 hex digest by streaming a file from disk. */
export function computeSha256FromFile(absolutePath: string): Promise<string> {
  return new Promise((fulfill, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(absolutePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => fulfill(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function getUniqueFilename(
  dirPath: string,
  filename: string,
): Promise<string> {
  const fullPath = join(dirPath, filename);

  if (!existsSync(fullPath)) {
    return filename;
  }

  const ext = extname(filename);
  const base = basename(filename, ext);
  let counter = 1;
  let newFilename: string;

  do {
    newFilename = `${base}_${counter}${ext}`;
    counter++;
  } while (existsSync(join(dirPath, newFilename)));

  return newFilename;
}

export async function saveFile(
  buffer: Buffer,
  folderSlug: string,
  filename: string,
  overwrite = true,
): Promise<{ path: string; name: string }> {
  const sanitized = sanitizeFilename(filename);
  const dirPath = slugToPath(folderSlug);

  await ensureDir(dirPath);

  const finalName = overwrite
    ? sanitized
    : await getUniqueFilename(dirPath, sanitized);
  const fullPath = join(dirPath, finalName);

  await writeFile(fullPath, buffer);

  return {
    path: join(folderSlug, finalName),
    name: finalName,
  };
}

export async function deleteFile(filePath: string): Promise<void> {
  const fullPath = getFilePath(filePath);
  const previewPath = getPreviewPath(filePath);

  try {
    await unlink(fullPath);
  } catch {
    // File may not exist
  }

  try {
    await unlink(previewPath);
  } catch {
    // Preview may not exist
  }
  if (/\.bsp$/i.test(filePath)) {
    await Promise.all([
      unlink(getBspThumbnailPath(filePath)).catch(() => {}),
      unlink(getBspDependencyPath(filePath)).catch(() => {}),
      unlink(getBspWalkabilityPath(filePath)).catch(() => {}),
    ]);
  }
}

export function moveFile(fromPath: string, toPath: string): void {
  if (fromPath === toPath) return;
  const fullFromPath = getFilePath(fromPath);
  const fullToPath = getFilePath(toPath);

  mkdirSync(dirname(fullToPath), { recursive: true });
  const paths: Array<[string, string]> = [[fullFromPath, fullToPath]];
  const derivatives: Array<[string, string]> = [
    [getPreviewPath(fromPath), getPreviewPath(toPath)],
  ];
  if (/\.bsp$/i.test(fromPath)) {
    derivatives.push(
      [getBspThumbnailPath(fromPath), getBspThumbnailPath(toPath)],
      [getBspDependencyPath(fromPath), getBspDependencyPath(toPath)],
      [getBspWalkabilityPath(fromPath), getBspWalkabilityPath(toPath)],
    );
  }
  paths.push(...derivatives.filter(([from]) => existsSync(from)));
  for (const [, to] of paths) {
    if (existsSync(to))
      throw new Error(`Move destination already exists: ${to}`);
  }
  const moved: Array<[string, string]> = [];
  try {
    for (const [from, to] of paths) {
      renameSync(from, to);
      moved.push([from, to]);
    }
  } catch (error) {
    try {
      for (const [from, to] of moved.toReversed()) renameSync(to, from);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "File move and rollback failed",
        {
          cause: rollbackError,
        },
      );
    }
    throw error;
  }
}

export async function deleteFolder(folderSlug: string): Promise<void> {
  const dirPath = slugToPath(folderSlug);
  await rm(dirPath, { recursive: true, force: true });
}

export async function getImageDimensions(
  filePath: string,
): Promise<Result<{ width: number; height: number }, Error>> {
  try {
    const { stdout } = await execFileAsync(
      "identify",
      ["-format", "%w %h", `${resolve(filePath)}[0]`],
      {
        timeout: 60_000,
      },
    );
    const [width, height] = stdout.trim().split(" ").map(Number);
    if (width && height) {
      return Result.ok({ width, height });
    }
    return Result.err(
      new Error(`Could not read image dimensions for ${filePath}`),
    );
  } catch (error) {
    return Result.err(toError(error));
  }
}

export async function generatePreview(
  inputPath: string,
): Promise<Result<boolean, Error>> {
  const outputPath = inputPath + ".preview.png";

  try {
    if (/\.wal$/i.test(inputPath)) {
      const palette = await resolveApprovedWalPalette(
        relative(UPLOADS_DIR, resolve(inputPath)).split(sep).join("/"),
      );
      if (!palette)
        throw new Error(
          "WAL preview requires an approved pics/colormap.pcx in its collection or _provided",
        );
      const png = await walToPng(
        await readFile(inputPath),
        await readFile(getFilePath(palette.path)),
      );
      await writeFile(outputPath, png);
      return Result.ok(true);
    }
    // Debian's runtime image provides ImageMagick 6. Pass paths as arguments,
    // not shell source, and select one frame so the preview has a stable filename.
    await execFileAsync(
      "convert",
      [`${resolve(inputPath)}[0]`, `PNG:${resolve(outputPath)}`],
      {
        timeout: 60_000,
      },
    );
    return Result.ok(true);
  } catch (error) {
    return Result.err(toError(error));
  }
}

export async function processImage(filePath: string): Promise<
  Result<
    {
      width: number | null;
      height: number | null;
      hasPreview: boolean;
    },
    Error
  >
> {
  const fullPath = getFilePath(filePath);
  let hasPreview = false;

  // Generate preview for legacy formats (non-fatal if it fails)
  if (needsPreview(filePath)) {
    const preview = await generatePreview(fullPath);
    if (preview.isOk()) {
      hasPreview = preview.value;
    }
    // If preview generation fails (e.g. ImageMagick not installed),
    // continue without a preview rather than failing the entire upload
  }

  // Get dimensions from preview if it exists, otherwise from original
  const dimensionPath = hasPreview ? fullPath + ".preview.png" : fullPath;
  const dims = await getImageDimensions(dimensionPath);

  return Result.ok({
    width: dims.isOk() ? dims.value.width : null,
    height: dims.isOk() ? dims.value.height : null,
    hasPreview,
  });
}

const MODEL_PREVIEW_EXTENSIONS = new Set(["glb", "gltf"]);

/**
 * Check if a file is a 3D model that supports preview generation.
 * Currently only GLB/GLTF since poppygl needs glTF format.
 */
export function canGenerateModelPreview(filename: string): boolean {
  const ext = extname(filename).toLowerCase().slice(1);
  return MODEL_PREVIEW_EXTENSIONS.has(ext);
}

/**
 * Generate a preview PNG for a 3D model file using poppygl (software rasterizer).
 * Returns true if a preview was generated, false otherwise.
 */
export async function generateModelPreview(
  buffer: Buffer,
  outputPath: string,
): Promise<Result<boolean, Error>> {
  try {
    const { renderGLTFToPNGFromGLB } = await import("poppygl");
    const png = await renderGLTFToPNGFromGLB(buffer, {
      width: 256,
      height: 256,
    });
    await writeFile(outputPath, png);
    return Result.ok(true);
  } catch (error) {
    return Result.err(toError(error));
  }
}

export async function saveTempFile(
  buffer: Buffer,
  filename: string,
): Promise<string> {
  await ensureDir(TEMP_DIR);
  const sanitized = sanitizeFilename(filename);
  const tempPath = join(TEMP_DIR, `${Date.now()}_${sanitized}`);
  await writeFile(tempPath, buffer);
  return tempPath;
}

export async function cleanupTempFile(tempPath: string): Promise<void> {
  try {
    await unlink(tempPath);
  } catch {
    // Ignore errors
  }
}

export async function cleanupOldTempFiles(): Promise<void> {
  if (!existsSync(TEMP_DIR)) return;

  const files = await readdir(TEMP_DIR);
  const oneHourAgo = Date.now() - 60 * 60 * 1000;

  for (const file of files) {
    const filePath = join(TEMP_DIR, file);
    try {
      const stats = await stat(filePath);
      if (stats.mtimeMs < oneHourAgo) {
        await unlink(filePath);
      }
    } catch {
      // Ignore errors
    }
  }
}

import { db } from "#db/connection.server";
import { files, folders } from "#db";
import { eq, inArray, sql } from "drizzle-orm";

export interface CreateFileRecord {
  id: string;
  path: string;
  name: string;
  mimeType: string;
  size: number;
  kind: FileKind;
  width?: number | null;
  height?: number | null;
  hasPreview?: boolean;
  folderId: string;
  uploaderId?: string | null;
  source?: string | null;
  sourceArchive?: string | null;
  sha256?: string | null;
  status?: "pending" | "approved" | "rejected";
  suggestedFolderId?: string | null;
}

/**
 * Insert a file record and increment the parent folder's file count.
 * Use this instead of direct db.insert(files) to keep counts in sync.
 */
export async function insertFileRecord(
  record: CreateFileRecord,
): Promise<Result<void, Error>> {
  try {
    db.transaction((tx) => {
      tx.insert(files)
        .values({
          id: record.id,
          path: record.path,
          name: record.name,
          mimeType: record.mimeType,
          size: record.size,
          kind: record.kind,
          width: record.width ?? null,
          height: record.height ?? null,
          hasPreview: record.hasPreview ?? false,
          folderId: record.folderId,
          uploaderId: record.uploaderId ?? null,
          source: record.source ?? null,
          sourceArchive: record.sourceArchive ?? null,
          sha256: record.sha256 ?? null,
          status: record.status ?? "approved",
          suggestedFolderId: record.suggestedFolderId ?? null,
        })
        .run();

      // Increment folder's file count
      if (record.folderId) {
        tx.update(folders)
          .set({ fileCount: sql`file_count + 1` })
          .where(eq(folders.id, record.folderId))
          .run();
      }
    });

    return Result.ok(undefined);
  } catch (error) {
    return Result.err(toError(error));
  }
}

export interface IngestFileOptions {
  buffer: Buffer;
  fileName: string;
  folderSlug: string;
  folderId: string;
  source: string;
  status?: "approved" | "pending";
  uploaderId?: string | null;
  sourceArchive?: string | null;
  suggestedFolderId?: string | null;
  processImages?: boolean;
  kind?: string;
  mimeType?: string;
  width?: number | null;
  height?: number | null;
  overwrite?: boolean;
}

export interface IngestFileResult {
  fileId: string;
  path: string;
  name: string;
  kind: string;
  mimeType: string;
  sha256: string;
  width: number | null;
  height: number | null;
  hasPreview: boolean;
}

export interface AdoptFileOptions {
  path: string;
  folderId: string;
  source: string;
  uploaderId?: string | null;
}

/** Register a file that already exists beneath uploads without rewriting its contents. */
export async function adoptFile(
  opts: AdoptFileOptions,
): Promise<Result<IngestFileResult, Error>> {
  try {
    const fullPath = getFilePath(opts.path);
    const buffer = await readFile(fullPath);
    const name = basename(opts.path);
    const kind = detectKind(name);
    const mimeType = await getMimeType(name, buffer);
    let width: number | null = null;
    let height: number | null = null;
    let hasPreview = false;

    if (isImageKind(kind)) {
      const imageInfo = await processImage(opts.path);
      if (imageInfo.isOk()) {
        width = imageInfo.value.width;
        height = imageInfo.value.height;
        hasPreview = imageInfo.value.hasPreview;
      }
    } else if (kind === "model" && canGenerateModelPreview(name)) {
      const preview = await generateModelPreview(
        buffer,
        `${fullPath}.preview.png`,
      );
      if (preview.isOk()) hasPreview = preview.value;
    }

    const sha256 = computeSha256(buffer);
    const fileId = nanoid();
    const inserted = await insertFileRecord({
      id: fileId,
      path: opts.path,
      name,
      mimeType,
      size: buffer.length,
      kind,
      width,
      height,
      hasPreview,
      folderId: opts.folderId,
      uploaderId: opts.uploaderId ?? null,
      source: opts.source,
      sha256,
      status: "approved",
    });
    if (inserted.isErr()) return Result.err(inserted.error);
    if (/\.bsp$/i.test(name))
      await refreshBspDependencyManifest(opts.path, buffer);
    return Result.ok({
      fileId,
      path: opts.path,
      name,
      kind,
      mimeType,
      sha256,
      width,
      height,
      hasPreview,
    });
  } catch (error) {
    return Result.err(toError(error));
  }
}

/**
 * Unified file ingestion: save to disk, detect type, process images, hash, and insert DB record.
 * Orchestrates the 6 common steps every file upload pathway performs.
 */
export async function ingestFile(
  opts: IngestFileOptions,
): Promise<Result<IngestFileResult, Error>> {
  try {
    // 1. Save file to disk
    const { path: savedPath, name: savedName } = await saveFile(
      opts.buffer,
      opts.folderSlug,
      opts.fileName,
      opts.overwrite ?? true,
    );

    // 2. Detect file kind (unless pre-computed)
    const kind: FileKind = (opts.kind as FileKind) ?? detectKind(savedName);

    // 3. Detect MIME type (unless pre-computed)
    const mimeType =
      opts.mimeType ?? (await getMimeType(savedName, opts.buffer));

    // 4. Process image (generate preview + get dimensions)
    let width: number | null = opts.width ?? null;
    let height: number | null = opts.height ?? null;
    let hasPreview = false;

    const dimensionsPreComputed =
      opts.width !== undefined && opts.height !== undefined;
    const shouldProcessImages = opts.processImages !== false;

    if (isImageKind(kind) && shouldProcessImages && !dimensionsPreComputed) {
      const imageInfo = await processImage(savedPath);
      if (imageInfo.isOk()) {
        width = imageInfo.value.width;
        height = imageInfo.value.height;
        hasPreview = imageInfo.value.hasPreview;
      }
    } else if (
      isImageKind(kind) &&
      !shouldProcessImages &&
      needsPreview(savedName)
    ) {
      // Even when full image processing is skipped (e.g. CLI uploads for speed),
      // still generate previews for non-web-native formats (TGA, BMP, PCX, etc.)
      // since browsers cannot render them at all without a PNG preview.
      const preview = await generatePreview(getFilePath(savedPath));
      if (preview.isOk()) {
        hasPreview = preview.value;
      }
    }

    // 4b. Generate model preview for GLB/GLTF files
    if (kind === "model" && canGenerateModelPreview(savedName)) {
      const previewPath = getFilePath(savedPath) + ".preview.png";
      const preview = await generateModelPreview(opts.buffer, previewPath);
      if (preview.isOk()) {
        hasPreview = preview.value;
      }
    }

    // 5. Hash the file contents
    const sha256 = computeSha256(opts.buffer);

    // 6. Create the DB record
    const fileId = nanoid();
    const inserted = await insertFileRecord({
      id: fileId,
      path: savedPath,
      name: savedName,
      mimeType,
      size: opts.buffer.length,
      kind,
      width,
      height,
      hasPreview,
      folderId: opts.folderId,
      uploaderId: opts.uploaderId ?? null,
      source: opts.source,
      sourceArchive: opts.sourceArchive ?? null,
      sha256,
      status: opts.status ?? "approved",
      suggestedFolderId: opts.suggestedFolderId ?? null,
    });
    if (inserted.isErr()) return Result.err(inserted.error);
    if (/\.bsp$/i.test(savedName))
      await refreshBspDependencyManifest(savedPath, opts.buffer);

    return Result.ok({
      fileId,
      path: savedPath,
      name: savedName,
      kind,
      mimeType,
      sha256,
      width,
      height,
      hasPreview,
    });
  } catch (error) {
    return Result.err(toError(error));
  }
}

export async function deleteFileRecord(
  fileId: string,
): Promise<Result<void, Error>> {
  try {
    // Get the file first to know which folder to update
    const file = await db.query.files.findFirst({
      where: eq(files.id, fileId),
    });

    if (!file) return Result.ok(undefined);

    // Delete the file record
    await db.delete(files).where(eq(files.id, fileId));

    // Decrement folder's file count
    if (file.folderId) {
      await db
        .update(folders)
        .set({ fileCount: sql`MAX(0, file_count - 1)` })
        .where(eq(folders.id, file.folderId));
    }

    return Result.ok(undefined);
  } catch (error) {
    return Result.err(toError(error));
  }
}

export async function incrementFolderFileCount(
  folderId: string,
  count: number = 1,
): Promise<void> {
  await db
    .update(folders)
    .set({ fileCount: sql`file_count + ${count}` })
    .where(eq(folders.id, folderId));
}

export async function recalculateFolderCounts(
  folderIds: string[],
): Promise<void> {
  if (folderIds.length === 0) return;
  await db
    .update(folders)
    .set({
      fileCount: sql`(SELECT count(*) FROM ${files} WHERE ${files.folderId} = ${folders.id})`,
    })
    .where(inArray(folders.id, folderIds));
}

/**
 * Finalize folders after a batch upload: recalculate file counts and generate
 * preview images. Automatically walks up the folder tree so ancestor folders
 * get updated previews too (cascading previews).
 *
 * Preview generation failures are non-fatal -- they are passed to `onError`
 * if provided, otherwise silently ignored.
 */
export async function finalizeFolders(
  folderIds: string[],
  onError?: (error: Error, folderId: string) => void,
  onProgress?: (current: number, total: number) => Promise<void>,
): Promise<void> {
  // Include ancestors so parent folders get previews from descendant textures
  const allIds = await getAncestorFolderIds(folderIds);

  await recalculateFolderCounts(folderIds); // Only recount the directly-affected folders
  await onProgress?.(0, allIds.length);
  let completed = 0;
  for (const folderId of allIds) {
    try {
      await generateFolderPreview(folderId);
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)), folderId);
    }
    await onProgress?.(++completed, allIds.length);
  }
}

/**
 * Sentinel value for `getOrCreateFolder` parentId parameter.
 * Use this instead of `null` to explicitly mark a folder as root-level.
 * This prevents accidental root-level folder creation when a parentId
 * is simply missing or forgotten.
 */
export const ROOT_FOLDER = Symbol.for("ROOT_FOLDER");

/**
 * Get an existing folder by slug, or create one if it doesn't exist.
 * `parentId` is required -- pass `ROOT_FOLDER` for root-level folders,
 * or a parent folder ID string for nested folders.
 */
export async function getOrCreateFolder(
  slug: string,
  name: string,
  parentId: typeof ROOT_FOLDER | string,
  description?: string,
): Promise<string> {
  const existing = await db.query.folders.findFirst({
    where: eq(folders.slug, slug),
  });

  if (existing) {
    return existing.id;
  }

  const id = nanoid();
  await db.insert(folders).values({
    id,
    name,
    slug,
    parentId: parentId === ROOT_FOLDER ? null : parentId,
    ...(description ? { description } : {}),
  });

  await ensureDir(slugToPath(slug));

  return id;
}
