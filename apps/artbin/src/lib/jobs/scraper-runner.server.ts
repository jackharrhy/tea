/**
 * Shared scraper runner for remote catalog import jobs.
 *
 * Each scraper defines source-specific discovery (HTML parsing, manifest fetching)
 * and a download function. This module handles the common loop: folder creation,
 * duplicate detection, download, ingest, progress reporting, and finalization.
 */

import { db } from "#db/connection.server";
import { files, type Job } from "#db";
import { eq } from "drizzle-orm";
import { createRequestLogger } from "evlog";

import { updateJobProgress } from "../jobs.server.ts";
import {
  ingestFile,
  getOrCreateFolder,
  ROOT_FOLDER,
  finalizeFolders,
} from "../files.server.ts";

export interface ScraperCategory {
  description?: string;
  children?: ScraperCategory[];
  /** Display name for the category folder */
  name: string;
  /** Slug segment (will be nested under parent: `parentSlug/categorySlug`) */
  slug: string;
  /** Files to import in this category */
  files: Array<{
    /** Filename as it will be stored */
    filename: string;
    /** Download this file and return its buffer */
    download: () => Promise<Buffer>;
  }>;
}

export interface ScraperConfig {
  /** Parent folder slug (e.g. "sadgrl-tiled-backgrounds") */
  parentSlug: string;
  /** Parent folder display name */
  parentName: string;
  /** Description for the parent folder */
  parentDescription: string;
  /** Source label passed to ingestFile (e.g. "sadgrl", "texturetown") */
  source: string;
  /** Uploader user ID, if any */
  uploaderId: string | null;
  /** Description template for category folders. Receives category name. */
  categoryDescription: (categoryName: string) => string;
}

export interface ScraperResult {
  totalFiles: number;
  totalFolders: number;
  categoriesImported: string[];
  errors: string[];
}

function countFiles(items: ScraperCategory[]): number {
  return items.reduce(
    (sum, cat) => sum + cat.files.length + countFiles(cat.children ?? []),
    0,
  );
}

/**
 * Download a remote file to a Buffer. Throws on non-OK responses.
 */
export async function downloadUrl(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Run the shared scraper import loop.
 *
 * Call this after source-specific discovery (fetching manifests, parsing HTML)
 * has produced the list of categories and files.
 */
export async function runScraper(
  job: Job,
  config: ScraperConfig,
  categories: ScraperCategory[],
  /** Progress range start (0-100). Discovery phase uses 0..progressStart. */
  progressStart = 10,
): Promise<ScraperResult & Record<string, unknown>> {
  const log = createRequestLogger();
  log.set({ job: { id: job.id, type: job.type } });

  // Create parent folder
  const parentFolderId = await getOrCreateFolder(
    config.parentSlug,
    config.parentName,
    ROOT_FOLDER,
    config.parentDescription,
  );
  const createdFolderIds: string[] = [parentFolderId];

  const totalFiles = countFiles(categories);
  let processedFiles = 0;
  let importedFiles = 0;
  const errors: string[] = [];
  const categoriesImported: string[] = [];

  async function importCategory(
    category: ScraperCategory,
    parentId: string,
    parentSlug: string,
  ) {
    if (countFiles([category]) === 0) return;

    const folderSlug = `${parentSlug}/${category.slug}`;
    const folderId = await getOrCreateFolder(
      folderSlug,
      category.name,
      parentId,
      category.description ?? config.categoryDescription(category.name),
    );
    createdFolderIds.push(folderId);
    categoriesImported.push(category.name);

    for (const file of category.files) {
      try {
        // Skip already-imported files
        const filePath = `${folderSlug}/${file.filename}`;
        const existing = await db.query.files.findFirst({
          where: eq(files.path, filePath),
        });

        if (existing) {
          processedFiles++;
          continue;
        }

        // Download and ingest
        const buffer = await file.download();
        const ingested = await ingestFile({
          buffer,
          fileName: file.filename,
          folderSlug,
          folderId,
          source: config.source,
          uploaderId: config.uploaderId,
        });
        if (ingested.isErr()) throw ingested.error;

        importedFiles++;
      } catch (error) {
        const msg = `${category.slug}/${file.filename}: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(msg);
        log.error(error instanceof Error ? error : new Error(String(error)), {
          step: "import-file",
          file: file.filename,
          category: category.slug,
        });
      }

      processedFiles++;

      if (processedFiles % 10 === 0 || processedFiles === totalFiles) {
        const progress =
          progressStart +
          Math.floor((processedFiles / totalFiles) * (95 - progressStart));
        await updateJobProgress(
          job.id,
          progress,
          `Imported ${importedFiles}/${processedFiles} files (${category.name})...`,
        );
      }
    }
    for (const child of category.children ?? []) {
      await importCategory(child, folderId, folderSlug);
    }
  }
  for (const category of categories) {
    await importCategory(category, parentFolderId, config.parentSlug);
  }

  // Finalize: recalculate folder counts and generate previews
  await updateJobProgress(job.id, 95, "Finalizing folders...");
  await finalizeFolders(createdFolderIds, (err, fId) =>
    log.error(err, { step: "generate-preview", folderId: fId }),
  );

  log.emit();

  return {
    totalFiles: importedFiles,
    totalFolders: categoriesImported.length,
    categoriesImported,
    errors: errors.slice(0, 50),
  };
}
