import { basename, extname } from "node:path";
import { readFile } from "node:fs/promises";

import { eq } from "drizzle-orm";

import { files } from "#db";
import { db } from "#db/connection.server";
import { resolveApprovedBspPalette } from "./bsp-assets.server.ts";
import {
  getFilePath,
  getOrCreateFolder,
  ingestFile,
  sanitizeFilename,
} from "./files.server.ts";
import { extractTexturesFromBsp, isBspFile } from "./game-textures.server.ts";

export interface BspTextureExtractionInput {
  buffer: Buffer;
  fileName: string;
  parentFolderSlug: string;
  parentFolderId: string;
  uploaderId?: string | null;
}

export interface BspTextureExtractionResult {
  textureCount: number;
  folderId: string | null;
  errors: string[];
}

export async function extractBspTextures(
  input: BspTextureExtractionInput,
): Promise<BspTextureExtractionResult> {
  const extension = extname(input.fileName).toLowerCase();
  if (extension !== ".bsp" || !isBspFile(input.buffer)) {
    return { textureCount: 0, folderId: null, errors: [] };
  }

  const bspPath = `${input.parentFolderSlug}/${input.fileName}`;
  const paletteAsset = await resolveApprovedBspPalette({ path: bspPath });
  const palette = paletteAsset
    ? new Uint8Array(await readFile(getFilePath(paletteAsset.path)))
    : undefined;
  const extracted = await extractTexturesFromBsp(input.buffer, palette);
  const errors = extracted.warnings.map((warning) => warning.message);
  if (extracted.textures.length === 0)
    return { textureCount: 0, folderId: null, errors };

  const baseName = basename(input.fileName, extension);
  const folderSlug = `${input.parentFolderSlug}/${slugifySegment(baseName)}-textures`;
  const folderId = await getOrCreateFolder(
    folderSlug,
    `${baseName} textures`,
    input.parentFolderId,
  );
  let textureCount = 0;

  for (const texture of extracted.textures) {
    const fileName = sanitizeFilename(`${texture.name}.png`);
    const path = `${folderSlug}/${fileName}`;
    const existing = await db.query.files.findFirst({
      where: eq(files.path, path),
    });
    if (existing) continue;

    const ingested = await ingestFile({
      buffer: texture.pngBuffer,
      fileName,
      folderSlug,
      folderId,
      uploaderId: input.uploaderId ?? null,
      source: "bsp-extracted",
      sourceArchive: input.fileName,
      kind: "texture",
      mimeType: "image/png",
      width: texture.width,
      height: texture.height,
    });

    if (ingested.isErr())
      errors.push(`${texture.name}: ${ingested.error.message}`);
    else textureCount += 1;
  }

  return { textureCount, folderId, errors };
}

function slugifySegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "textures"
  );
}
