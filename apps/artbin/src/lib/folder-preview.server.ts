/**
 * Folder preview generation
 *
 * Creates a 3x3 grid preview image from textures in a folder using Sharp.
 */

import sharp from "sharp";
import { db } from "#db/connection.server";
import { files, folders } from "#db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { join } from "path";
import {
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { randomUUID } from "crypto";
import { UPLOADS_DIR, slugToPath } from "./files.server.ts";
import { getDescendantFolderIds } from "./file-queries.server.ts";
import { createRequestLogger } from "evlog";

// Preview configuration
const GRID_SIZE = 3; // 3x3 grid
const THUMB_SIZE = 128; // Each thumbnail is 128x128
const PREVIEW_SIZE = GRID_SIZE * THUMB_SIZE; // 384x384 total
export const FOLDER_PREVIEW_FILENAME = "_folder-preview.png";

export function getFolderPreviewPath(folderSlug: string): string {
  return `${folderSlug}/${FOLDER_PREVIEW_FILENAME}`;
}

export function getFolderPreviewFullPath(folderSlug: string): string {
  return join(UPLOADS_DIR, getFolderPreviewPath(folderSlug));
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Get textures from a folder and all its descendants, randomly sampled
 */
type PreviewInput = string | Buffer;

async function getPreviewTexturesRecursive(
  folderId: string,
): Promise<PreviewInput[]> {
  // Get all descendant folder IDs
  const allFolderIds = await getDescendantFolderIds(folderId);

  // Fetch a bounded candidate set; non-displayable records are filtered below.
  const textures = await db
    .select({
      path: files.path,
      hasPreview: files.hasPreview,
    })
    .from(files)
    .where(inArray(files.folderId, allFolderIds))
    .limit(GRID_SIZE * GRID_SIZE * 3);

  const wadFiles = await db
    .select({ path: files.path, sha256: files.sha256 })
    .from(files)
    .where(
      and(
        inArray(files.folderId, allFolderIds),
        sql`lower(${files.name}) like '%.wad'`,
      ),
    )
    .limit(GRID_SIZE * GRID_SIZE * 3);

  // Filter to files with displayable images (textures or models with previews)
  const imageTextures = textures.filter((t) => {
    if (!t.path) return false;
    if (t.hasPreview) return true; // Any file with a preview (models, TGA, etc.)
    const ext = t.path.toLowerCase().split(".").pop();
    return ["png", "jpg", "jpeg", "gif", "webp"].includes(ext || "");
  });

  // Shuffle to get random sampling across all folders
  const shuffled = shuffleArray(imageTextures);

  // Get paths to the actual displayable images
  const paths: string[] = [];

  for (const t of shuffled) {
    if (paths.length >= GRID_SIZE * GRID_SIZE) break;
    if (!t.path) continue;

    const imgPath = t.hasPreview
      ? join(UPLOADS_DIR, t.path + ".preview.png")
      : join(UPLOADS_DIR, t.path);

    if (existsSync(imgPath) && !paths.includes(imgPath)) {
      paths.push(imgPath);
    }
  }

  const wadTextures = await getWADPreviewTextures(
    wadFiles,
    GRID_SIZE * GRID_SIZE,
  );
  if (wadTextures.length === 0) return paths;
  if (paths.length === 0) return wadTextures;

  const combined: PreviewInput[] = [];
  while (
    combined.length < GRID_SIZE * GRID_SIZE &&
    (paths.length || wadTextures.length)
  ) {
    const image = paths.shift();
    if (image) combined.push(image);
    const wad = wadTextures.shift();
    if (wad && combined.length < GRID_SIZE * GRID_SIZE) combined.push(wad);
  }
  return shuffleArray(combined);
}

async function getWADPreviewTextures(
  wadFiles: { path: string; sha256: string | null }[],
  limit: number,
): Promise<Buffer[]> {
  if (wadFiles.length === 0) return [];
  const { getWADTexturePreview, inspectWADFile } =
    await import("./wad-assets.server.ts");
  const libraries = await Promise.all(
    shuffleArray(wadFiles).map(async (file) => {
      try {
        const contents = await inspectWADFile(file.path, file.sha256);
        return contents
          ? {
              file,
              indices: shuffleArray(
                contents.textures.map((texture) => texture.index),
              ),
            }
          : null;
      } catch {
        return null;
      }
    }),
  );
  const available = libraries.filter((library) => library !== null);
  const previews: Buffer[] = [];
  while (
    previews.length < limit &&
    available.some((library) => library.indices.length > 0)
  ) {
    for (const library of available) {
      const textureIndex = library.indices.pop();
      if (textureIndex === undefined) continue;
      try {
        const preview = await getWADTexturePreview(library.file, textureIndex);
        if (preview) previews.push(preview);
      } catch {
        // A malformed texture should not prevent the rest of the folder preview.
      }
      if (previews.length >= limit) break;
    }
  }
  return previews;
}

export async function generateFolderPreview(
  folderId: string,
): Promise<string | null> {
  const folder = await db.query.folders.findFirst({
    where: eq(folders.id, folderId),
  });

  if (!folder) {
    const log = createRequestLogger();
    log.set({ folderPreview: { folderId, error: "not-found" } });
    log.emit();
    return null;
  }

  // Get textures for the preview
  const texturePaths = await getPreviewTexturesRecursive(folderId);

  if (texturePaths.length === 0) {
    await clearFolderPreview(folder);
    return null;
  }

  try {
    // Create thumbnail buffers for each texture
    const thumbnails: { input: Buffer; top: number; left: number }[] = [];

    for (let i = 0; i < texturePaths.length && i < GRID_SIZE * GRID_SIZE; i++) {
      const texture = texturePaths[i];
      const row = Math.floor(i / GRID_SIZE);
      const col = i % GRID_SIZE;

      try {
        // Resize to thumbnail, cover the area
        const thumb = await sharp(texture)
          .resize(THUMB_SIZE, THUMB_SIZE, {
            fit: "cover",
            position: "center",
          })
          .png()
          .toBuffer();

        thumbnails.push({
          input: thumb,
          top: row * THUMB_SIZE,
          left: col * THUMB_SIZE,
        });
      } catch (err) {
        const log = createRequestLogger();
        log.error(err instanceof Error ? err : new Error(String(err)), {
          step: "resize-thumbnail",
          texture:
            typeof texture === "string" ? texture : "virtual-wad-texture",
        });
        log.emit();
      }
    }

    if (thumbnails.length === 0) {
      await clearFolderPreview(folder);
      return null;
    }

    // Create the composite image
    // Start with a gray background
    const composite = sharp({
      create: {
        width: PREVIEW_SIZE,
        height: PREVIEW_SIZE,
        channels: 3,
        background: { r: 240, g: 240, b: 240 },
      },
    })
      .composite(thumbnails)
      .png();

    const png = await composite.toBuffer();
    // Rendering can overlap a move. Resolve the folder's current path at publication
    // time, with no async gap between the filesystem write and the database update.
    return db.transaction(
      (tx) => {
        const current = tx
          .select()
          .from(folders)
          .where(eq(folders.id, folderId))
          .get();
        if (!current) return null;
        mkdirSync(slugToPath(current.slug), { recursive: true });
        const previewPath = getFolderPreviewPath(current.slug);
        const fullPath = getFolderPreviewFullPath(current.slug);
        const temporaryPath = `${fullPath}.tmp-${randomUUID()}.png`;
        try {
          writeFileSync(temporaryPath, png);
          renameSync(temporaryPath, fullPath);
          tx.update(folders)
            .set({ previewPath })
            .where(eq(folders.id, folderId))
            .run();
        } finally {
          if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
        }
        return previewPath;
      },
      { behavior: "immediate" },
    );
  } catch (err) {
    const log = createRequestLogger();
    log.set({
      folderPreview: { folderSlug: folder.slug, error: "generation-failed" },
    });
    const error = err instanceof Error ? err : new Error(String(err));
    log.error(error, { step: "generate-preview" });
    log.emit();
    throw error;
  }
}

async function clearFolderPreview(
  folder: typeof folders.$inferSelect,
): Promise<void> {
  db.transaction(
    (tx) => {
      const current = tx
        .select()
        .from(folders)
        .where(eq(folders.id, folder.id))
        .get();
      if (!current || current.slug !== folder.slug) return;
      const path = getFolderPreviewFullPath(current.slug);
      if (existsSync(path)) unlinkSync(path);
      tx.update(folders)
        .set({ previewPath: null })
        .where(eq(folders.id, folder.id))
        .run();
    },
    { behavior: "immediate" },
  );
}

export async function deleteFolderPreview(folderId: string): Promise<void> {
  const folder = await db.query.folders.findFirst({
    where: eq(folders.id, folderId),
  });

  if (!folder) return;
  await clearFolderPreview(folder);
}
