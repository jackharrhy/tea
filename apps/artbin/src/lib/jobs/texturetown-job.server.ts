/**
 * TextureTown import job handler
 *
 * Imports textures from TextureTown (textures.neocities.org) into artbin.
 * Creates folders for each category and downloads all textures.
 */

import type { Job } from "#db";

import { registerJobHandler, updateJobProgress } from "../jobs.server.ts";
import {
  runScraper,
  downloadUrl,
  type ScraperCategory,
} from "./scraper-runner.server.ts";

interface TextureTownManifest {
  info: {
    base_url: string;
    textures_folder: string;
    texture_count: number;
  };
  catalogue: Array<{
    name: string;
    niceName: string;
    files: string[];
  }>;
}

export interface TextureTownImportInput {
  categories?: string[];
  userId?: string;
}

export interface TextureTownImportOutput {
  totalFiles: number;
  totalFolders: number;
  categoriesImported: string[];
  errors: string[];
}

const TEXTURETOWN_MANIFEST_URL = "https://textures.neocities.org/manifest.json";

async function fetchManifest(): Promise<TextureTownManifest> {
  const res = await fetch(TEXTURETOWN_MANIFEST_URL);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch manifest: ${res.status} ${res.statusText}`,
    );
  }
  return res.json();
}

function categoryToSlug(categoryName: string): string {
  return categoryName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function handleTextureTownImport(
  job: Job,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { categories: requestedCategories, userId } =
    input as unknown as TextureTownImportInput;

  await updateJobProgress(job.id, 2, "Fetching TextureTown manifest...");

  const manifest = await fetchManifest();
  const { base_url, textures_folder } = manifest.info;

  let catalogue = manifest.catalogue;
  if (requestedCategories && requestedCategories.length > 0) {
    catalogue = manifest.catalogue.filter((cat) =>
      requestedCategories.includes(cat.name),
    );
  }

  if (catalogue.length === 0) {
    throw new Error("No categories to import");
  }

  const totalFiles = catalogue.reduce((sum, cat) => sum + cat.files.length, 0);
  await updateJobProgress(
    job.id,
    5,
    `Found ${totalFiles} textures in ${catalogue.length} categories`,
  );

  // Build categories for the shared runner
  const categories: ScraperCategory[] = catalogue.map((cat) => ({
    name: cat.niceName,
    slug: categoryToSlug(cat.name),
    files: cat.files.map((fileName) => ({
      filename: fileName,
      download: () =>
        downloadUrl(`${base_url}/${textures_folder}/${cat.name}/${fileName}`),
    })),
  }));

  return runScraper(
    job,
    {
      parentSlug: "texturetown",
      parentName: "TextureTown",
      parentDescription: "Textures imported from textures.neocities.org",
      source: "texturetown",
      uploaderId: userId || null,
      categoryDescription: (name) => `${name} textures from TextureTown`,
    },
    categories,
    5,
  );
}

registerJobHandler("texturetown-import", handleTextureTownImport);

export { handleTextureTownImport };
