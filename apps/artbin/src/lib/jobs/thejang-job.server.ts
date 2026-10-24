/**
 * Texture Station (TheJang) import job handler
 *
 * Imports textures from thejang.com/textures/ into artbin.
 * Scrapes HTML pages to find texture images, creates folders for each category.
 */

import type { Job } from "#db";
import { createRequestLogger } from "evlog";

import { registerJobHandler, updateJobProgress } from "../jobs.server.ts";
import {
  runScraper,
  downloadUrl,
  type ScraperCategory,
} from "./scraper-runner.server.ts";

interface CategoryDef {
  page: string;
  name: string;
  slug: string;
}

interface TextureStationImportInput {
  categories?: string[];
  userId?: string;
}

const BASE_URL = "https://thejang.com/textures";

const CATEGORY_DEFS: CategoryDef[] = [
  { page: "backgrounds_blue.htm", name: "Blue (Dark)", slug: "blue-dark" },
  { page: "backgrounds_lt_blue.htm", name: "Blue (Light)", slug: "blue-light" },
  { page: "backgrounds_cyan.htm", name: "Cyan", slug: "cyan" },
  { page: "backgrounds_dk_gray.htm", name: "Gray (Dark)", slug: "gray-dark" },
  { page: "backgrounds_lt_gray.htm", name: "Gray (Light)", slug: "gray-light" },
  { page: "backgrounds_green.htm", name: "Green", slug: "green" },
  { page: "backgrounds_purple.htm", name: "Purples", slug: "purples" },
  {
    page: "backgrounds_red_yellow.htm",
    name: "Reds & Yellows",
    slug: "reds-yellows",
  },
  { page: "backgrounds_brown.htm", name: "Browns & Tans", slug: "browns-tans" },
  {
    page: "backgrounds_multicolor.htm",
    name: "MultiColor",
    slug: "multicolor",
  },
  {
    page: "backgrounds_miscrock.htm",
    name: "Stones & Rocks",
    slug: "stones-rocks",
  },
  { page: "backgrounds_wood.htm", name: "Wood", slug: "wood" },
  { page: "backgrounds_other.htm", name: "Other", slug: "other" },
];

/**
 * Parse HTML page to extract texture image filenames from i2/ directory
 */
function parseTextureImages(html: string): string[] {
  const images: string[] = [];
  const imgRegex = /SRC="(i2\/Texture_[^"]+\.(?:jpg|gif))"/gi;

  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    const filename = match[1].replace("i2/", "");
    if (!images.includes(filename)) {
      images.push(filename);
    }
  }

  return images;
}

async function fetchCategoryTextures(page: string): Promise<string[]> {
  const url = `${BASE_URL}/${page}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  return parseTextureImages(html);
}

async function handleTextureStationImport(
  job: Job,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const log = createRequestLogger();
  const { categories: requestedCategories, userId } =
    input as unknown as TextureStationImportInput;

  await updateJobProgress(job.id, 2, "Scanning Texture Station categories...");

  let defsToImport = CATEGORY_DEFS;
  if (requestedCategories && requestedCategories.length > 0) {
    defsToImport = CATEGORY_DEFS.filter((cat) =>
      requestedCategories.includes(cat.slug),
    );
  }

  if (defsToImport.length === 0) {
    throw new Error("No categories to import");
  }

  // Discovery phase: fetch all category pages to find texture filenames
  await updateJobProgress(job.id, 5, "Fetching category pages...");

  const categories: ScraperCategory[] = [];
  for (const def of defsToImport) {
    try {
      const textures = await fetchCategoryTextures(def.page);
      categories.push({
        name: def.name,
        slug: def.slug,
        files: textures.map((filename) => ({
          filename,
          download: () => downloadUrl(`${BASE_URL}/i2/${filename}`),
        })),
      });
    } catch (error) {
      log.error(error instanceof Error ? error : new Error(String(error)), {
        step: "fetch-category",
        page: def.page,
      });
      // Skip this category but continue with others
    }
  }

  const totalFiles = categories.reduce((sum, cat) => sum + cat.files.length, 0);
  await updateJobProgress(
    job.id,
    10,
    `Found ${totalFiles} textures in ${categories.length} categories`,
  );

  return runScraper(
    job,
    {
      parentSlug: "texture-station",
      parentName: "Texture Station",
      parentDescription:
        "Textures imported from thejang.com/textures (Texture Station)",
      source: "texture-station",
      uploaderId: userId || null,
      categoryDescription: (name) => `${name} textures from Texture Station`,
    },
    categories,
    10,
  );
}

registerJobHandler("texture-station-import", handleTextureStationImport);
