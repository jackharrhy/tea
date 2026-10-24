/**
 * Sadgrl Tiled Backgrounds import job handler
 *
 * Imports tiled backgrounds from sadgrl.online archived collection.
 * Images are hosted on sadhost.neocities.org/images/tiles/
 */

import type { Job } from "#db";

import { registerJobHandler, updateJobProgress } from "../jobs.server.ts";
import {
  runScraper,
  downloadUrl,
  type ScraperCategory,
} from "./scraper-runner.server.ts";

interface SadgrlImportInput {
  userId?: string;
}

const PAGE_URL =
  "https://sadgrlonline.github.io/archived-sadgrl.online/webmastery/downloads/tiledbgs.html";

const CATEGORY_DEFS = [
  { name: "Reds", slug: "reds" },
  { name: "Yellows & Oranges", slug: "yellows-oranges" },
  { name: "Greens", slug: "greens" },
  { name: "Blues", slug: "blues" },
  { name: "Purples", slug: "purples" },
  { name: "Pinks", slug: "pinks" },
  { name: "Blacks", slug: "blacks" },
  { name: "Grays", slug: "grays" },
  { name: "Whites", slug: "whites" },
  { name: "Transparents", slug: "transparents" },
] as const;

/**
 * Parse HTML to extract image URLs organized by category
 */
function parseImagesByCategory(html: string): Map<string, string[]> {
  const result = new Map<string, string[]>();

  const categoryPattern =
    /<strong>([^<]+)<\/strong>\s*<br>\s*<br>([\s\S]*?)(?=<br>\s*<br>\s*<strong>|<\/div>)/gi;

  let match;
  while ((match = categoryPattern.exec(html)) !== null) {
    const categoryName = match[1].trim();
    const imageSection = match[2];

    const category = CATEGORY_DEFS.find(
      (c) => c.name.toLowerCase() === categoryName.toLowerCase(),
    );
    if (!category) continue;

    const imgPattern =
      /src="(https:\/\/sadhost\.neocities\.org\/images\/tiles\/[^"]+)"/gi;
    const images: string[] = [];

    let imgMatch;
    while ((imgMatch = imgPattern.exec(imageSection)) !== null) {
      const url = imgMatch[1];
      if (!images.includes(url)) {
        images.push(url);
      }
    }

    result.set(category.slug, images);
  }

  return result;
}

function getFilenameFromUrl(url: string): string {
  const parts = url.split("/");
  return parts[parts.length - 1];
}

async function handleSadgrlImport(
  job: Job,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { userId } = input as unknown as SadgrlImportInput;

  await updateJobProgress(
    job.id,
    2,
    "Fetching Sadgrl tiled backgrounds page...",
  );

  const res = await fetch(PAGE_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch page: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();

  await updateJobProgress(job.id, 5, "Parsing image categories...");

  const imagesByCategory = parseImagesByCategory(html);

  let totalFiles = 0;
  for (const images of imagesByCategory.values()) {
    totalFiles += images.length;
  }

  await updateJobProgress(
    job.id,
    10,
    `Found ${totalFiles} images in ${imagesByCategory.size} categories`,
  );

  // Build categories for the shared runner
  const categories: ScraperCategory[] = CATEGORY_DEFS.filter((def) =>
    imagesByCategory.has(def.slug),
  ).map((def) => ({
    name: def.name,
    slug: def.slug,
    files: (imagesByCategory.get(def.slug) || []).map((url) => ({
      filename: getFilenameFromUrl(url),
      download: () => downloadUrl(url),
    })),
  }));

  return runScraper(
    job,
    {
      parentSlug: "sadgrl-tiled-backgrounds",
      parentName: "Sadgrl Tiled Backgrounds",
      parentDescription: "Tiled backgrounds from sadgrl.online archive",
      source: "sadgrl",
      uploaderId: userId || null,
      categoryDescription: (name) => `${name} tiled backgrounds`,
    },
    categories,
    10,
  );
}

registerJobHandler("sadgrl-import", handleSadgrlImport);
