import { z } from "zod";
import { sanitizeFilename } from "@tea/artbin-core/detection/filenames";
import type { Job } from "#db";

import { registerJobHandler, updateJobProgress } from "../jobs.server.ts";
import {
  downloadUrl,
  runScraper,
  type ScraperCategory,
} from "./scraper-runner.server.ts";

const LIBRARY_URL = "https://katamari.andrew-boylan.com/";
const ASSET_URL = "https://pub-13a5286ea5b347fbb60687b5ebb02b5a.r2.dev";
const games = [
  {
    slug: "katamari-damacy",
    name: "Katamari Damacy",
    manifest: "models-v3.json",
    models: "models-v3",
  },
  {
    slug: "we-love-katamari",
    name: "We Love Katamari",
    manifest: "we-love-katamari-models-v8.json",
    models: "we-love-katamari-models-v2",
  },
];
const manifestSchema = z.array(
  z.object({ status: z.string(), file: z.string() }),
);

export async function handleKatamariImport(
  job: Job,
): Promise<Record<string, unknown>> {
  await updateJobProgress(
    job.id,
    2,
    "Fetching Katamari Object Library catalogs...",
  );
  const categories: ScraperCategory[] = [];
  for (const game of games) {
    const response = await fetch(`${ASSET_URL}/${game.manifest}`, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok)
      throw new Error(
        `Could not fetch ${game.name} catalog: ${response.status}`,
      );
    const manifest = manifestSchema.parse(await response.json());
    const filenames = new Set<string>();
    const category: ScraperCategory = {
      name: game.name,
      slug: game.slug,
      files: [],
    };
    for (const model of manifest) {
      if (model.status !== "exported") continue;
      // The library's own viewer corrects this typo in some exported filenames.
      const remoteName = model.file.replace("..glb", ".glb");
      // oxlint-disable-next-line eslint/no-control-regex -- Reject control bytes in remote filenames.
      if (!remoteName.endsWith(".glb") || /[/\\\x00-\x1f]/.test(remoteName)) {
        throw new Error(`Invalid ${game.name} model filename: ${model.file}`);
      }
      const filename = sanitizeFilename(remoteName);
      if (filenames.has(filename))
        throw new Error(`Duplicate ${game.name} filename: ${filename}`);
      filenames.add(filename);
      category.files.push({
        filename,
        download: () =>
          downloadUrl(
            `${ASSET_URL}/${game.models}/${encodeURIComponent(remoteName)}`,
          ),
      });
    }
    if (category.files.length === 0)
      throw new Error(`No exported models in ${game.name} catalog`);
    categories.push(category);
  }

  return runScraper(
    job,
    {
      parentSlug: "katamari-object-library",
      parentName: "Katamari Object Library",
      parentDescription: `Textured models from Katamari Damacy and We Love Katamari, collected by Andrew Boylan: ${LIBRARY_URL}`,
      source: "katamari",
      uploaderId: job.userId,
      categoryDescription: (name) =>
        `${name} models from Andrew Boylan's Katamari Object Library: ${LIBRARY_URL}${name === "We Love Katamari" ? "we-love-katamari" : ""}`,
    },
    categories,
    5,
  );
}

registerJobHandler("katamari-import", handleKatamariImport);
