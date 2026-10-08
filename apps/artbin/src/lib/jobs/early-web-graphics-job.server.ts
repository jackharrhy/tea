import { createHash } from "node:crypto";
import { basename, extname } from "node:path";
import { setTimeout } from "node:timers/promises";
import { load } from "cheerio/slim";
import { sanitizeFilename } from "@artbin/core/detection/filenames";
import type { Job } from "#db";

import { registerJobHandler, updateJobProgress } from "../jobs.server.ts";
import { runScraper, type ScraperCategory } from "./scraper-runner.server.ts";

const MUSEUM = "https://andybaga.neocities.org/museum/";
const sections = [
  { slug: "clipart", name: "Clip Art" },
  { slug: "gifs", name: "GIFs" },
  { slug: "bars", name: "Bars" },
  { slug: "backgrounds", name: "Backgrounds" },
];

class MuseumRequestError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`Museum request failed (${status}): ${url}`);
  }
}

function assetUrl(value: string, pageUrl: string): string | null {
  const url = new URL(value, pageUrl);
  const allowed =
    (url.hostname === "andybaga.wordpress.com" &&
      url.pathname.startsWith("/wp-content/uploads/")) ||
    url.hostname === "andybaga.neocities.org";
  if (
    !allowed ||
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    !/\.(gif|png|jpe?g|webp)$/i.test(url.pathname)
  )
    return null;
  url.hash = "";
  return url.href;
}

export function museumGalleries(html: string, section: string) {
  const $ = load(html);
  const galleries = new Map<
    string,
    { slug: string; name: string; url: string }
  >();
  for (const link of $("a[href]").toArray()) {
    const url = new URL($(link).attr("href")!, `${MUSEUM}${section}`);
    const match = url.pathname.match(
      new RegExp(`^/museum/${section}/([a-z0-9_-]+)(?:\\.html)?$`),
    );
    if (url.origin !== new URL(MUSEUM).origin || !match) continue;
    const slug = match[1]!;
    const name = $(link).text().replace(/\s+/g, " ").trim() || slug;
    if (/adult/i.test(slug) || /\badult\b/i.test(name)) continue;
    galleries.set(slug, { slug, name, url: `${MUSEUM}${section}/${slug}` });
  }
  if (!galleries.size)
    throw new Error(`No museum galleries found in ${section}`);
  return [...galleries.values()];
}

export function museumImages(
  html: string,
  pageUrl: string,
  bars = false,
): string[] {
  const $ = load(html, { xml: { xmlMode: false, withStartIndices: true } });
  const start = bars ? $('a[name="animated"]').get(0)?.startIndex : undefined;
  if (bars && start == null)
    throw new Error("Museum bars section was not found");
  const urls = new Set<string>();
  for (const image of $("img[src]").toArray()) {
    if ($(image).closest("a").length) continue;
    if (bars) {
      if ((image.startIndex ?? 0) < start!) continue;
    } else {
      // Collection grids are wide, borderless tables; the header and See Also cards are not.
      const table = $(image).closest("table");
      if (
        table.attr("border") !== "0" ||
        Number(table.attr("width")) < 600 ||
        !table.attr("width")
      )
        continue;
    }
    const url = assetUrl($(image).attr("src")!, pageUrl);
    if (
      url &&
      !(bars && basename(new URL(url).pathname) === "elegantbarbl2.gif")
    )
      urls.add(url);
  }
  if (!urls.size) throw new Error(`No museum images found in ${pageUrl}`);
  return [...urls];
}

// One paced request at a time, including discovery and downloads.
async function request(url: string) {
  await setTimeout(200);
  const response = await fetch(url, {
    headers: {
      "user-agent": "Artbin (+https://github.com/jackharrhy/artbin)",
    },
    signal: AbortSignal.timeout(120_000),
    redirect: "error",
  });
  if (!response.ok) throw new MuseumRequestError(response.status, url);
  return response;
}

function category(
  name: string,
  slug: string,
  url: string,
  images: string[],
): ScraperCategory {
  return {
    name,
    slug,
    description: `${name}, curated by Andy Baga for the Museum of Early Web Graphics. Source: ${url}`,
    files: images.map((imageUrl) => {
      const original = sanitizeFilename(
        decodeURIComponent(basename(new URL(imageUrl).pathname)),
      );
      const extension = extname(original);
      // Different upload months can contain the same filename. URL identity also survives reordering.
      const id = createHash("sha256")
        .update(imageUrl)
        .digest("hex")
        .slice(0, 12);
      return {
        filename: `${original.slice(0, -extension.length).slice(0, 160)}-${id}${extension}`,
        download: async () =>
          Buffer.from(await (await request(imageUrl)).arrayBuffer()),
      };
    }),
  };
}

export async function handleEarlyWebGraphicsImport(
  job: Job,
): Promise<Record<string, unknown>> {
  const categories: ScraperCategory[] = [];
  const missingGalleries: string[] = [];
  for (const section of sections) {
    await updateJobProgress(job.id, 2, `Discovering museum ${section.name}...`);
    const url = `${MUSEUM}${section.slug}`;
    const html = await (await request(url)).text();
    const group = category(
      section.name,
      section.slug,
      url,
      section.slug === "bars" ? museumImages(html, url, true) : [],
    );
    if (section.slug !== "bars") {
      group.children = [];
      for (const gallery of museumGalleries(html, section.slug)) {
        await updateJobProgress(
          job.id,
          5,
          `Discovering ${section.name}: ${gallery.name}...`,
        );
        let page: string;
        try {
          page = await (await request(gallery.url)).text();
        } catch (error) {
          if (!(error instanceof MuseumRequestError) || error.status !== 404)
            throw error;
          missingGalleries.push(error.message);
          continue;
        }
        group.children.push(
          category(
            gallery.name,
            gallery.slug,
            gallery.url,
            museumImages(page, gallery.url),
          ),
        );
      }
      if (!group.children.length)
        throw new Error(`No available museum galleries in ${section.name}`);
    }
    categories.push(group);
  }
  const result = await runScraper(
    job,
    {
      parentSlug: "museum-of-early-web-graphics",
      parentName: "Museum of Early Web Graphics",
      parentDescription: `Early-web clip art, animated GIFs, bars, and backgrounds collected and curated by Andy Baga. Original artists retain their rights; no blanket reuse licence is claimed. Source: ${MUSEUM}main`,
      source: "early-web-graphics",
      uploaderId: job.userId,
      categoryDescription: (name) =>
        `${name} from the Museum of Early Web Graphics.`,
    },
    categories,
  );
  return {
    ...result,
    errors: [...missingGalleries, ...result.errors].slice(0, 50),
  };
}

registerJobHandler("early-web-graphics-import", handleEarlyWebGraphicsImport);
