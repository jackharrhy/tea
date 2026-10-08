import { afterEach, expect, test, vi } from "vitest";
import type { Job } from "#db";
import { museumFixture, museumGif } from "./fixtures/early-web-graphics.mjs";

const { runScraper } = vi.hoisted(() => ({
  runScraper: vi.fn<
    typeof import("../src/lib/jobs/scraper-runner.server.ts").runScraper
  >(async () => ({
    totalFiles: 0,
    totalFolders: 0,
    categoriesImported: [],
    errors: [],
  })),
}));
vi.mock("#lib/jobs.server", () => ({
  registerJobHandler: vi.fn(),
  updateJobProgress: vi.fn(),
}));
vi.mock("node:timers/promises", () => ({ setTimeout: async () => {} }));
vi.mock("../src/lib/jobs/scraper-runner.server.ts", () => ({ runScraper }));
import { handleEarlyWebGraphicsImport } from "../src/lib/jobs/early-web-graphics-job.server.ts";

const job = { id: "museum-test", userId: "admin" } as Job;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test("discovers sections, preserves source pages, excludes furniture and deduplicates stable asset identities", async () => {
  const fetch = vi.fn(async (url: string) => museumFixture(new URL(url))!);
  vi.stubGlobal("fetch", fetch);
  await handleEarlyWebGraphicsImport(job);
  const [, config, groups] = runScraper.mock.calls[0]!;
  expect(config.uploaderId).toBe("admin");
  expect(groups.map((group) => group.slug)).toEqual([
    "clipart",
    "gifs",
    "bars",
    "backgrounds",
  ]);
  const gallery = groups[0]!.children![0]!;
  expect(gallery.name).toBe("Dragons & Friends");
  expect(gallery.description).toContain(
    "https://andybaga.neocities.org/museum/clipart/dragons",
  );
  expect(groups[0]!.children).toHaveLength(1);
  expect(gallery.files).toHaveLength(2);
  expect(new Set(gallery.files.map((file) => file.filename)).size).toBe(2);
  expect(groups[2]!.files).toHaveLength(1);
  expect(await gallery.files[0]!.download()).toEqual(museumGif);
  expect(
    fetch.mock.calls.every(
      ([url]) => !url.includes("adult") && !url.includes("127.0.0.1"),
    ),
  ).toBe(true);
  vi.stubGlobal("fetch", async () => new Response(null, { status: 503 }));
  await expect(gallery.files[0]!.download()).rejects.toThrow("503");
});

test.each(["unavailable", "empty-gallery", "empty-index"])(
  "rejects %s discovery before mutating the library",
  async (mode) => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (mode === "unavailable") return new Response(null, { status: 503 });
      if (mode === "empty-index" || url.endsWith("/dragons"))
        return new Response("<p>Changed markup</p>");
      return museumFixture(new URL(url));
    });
    await expect(handleEarlyWebGraphicsImport(job)).rejects.toThrow();
    expect(runScraper).not.toHaveBeenCalled();
  },
);

test("reports a dead gallery link without discarding the available collection", async () => {
  vi.stubGlobal("fetch", async (url: string) => {
    const response = museumFixture(new URL(url))!;
    if (url.endsWith("/clipart"))
      return new Response(
        `${await response.text()}<a href="/museum/clipart/missing">Missing</a>`,
      );
    return response;
  });
  const result = await handleEarlyWebGraphicsImport(job);
  expect(result.errors).toEqual([
    "Museum request failed (404): https://andybaga.neocities.org/museum/clipart/missing",
  ]);
  expect(runScraper).toHaveBeenCalledOnce();
});
