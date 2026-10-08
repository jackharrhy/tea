import { afterEach, expect, test, vi } from "vitest";
import type { Job } from "#db";

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
vi.mock("../src/lib/jobs/scraper-runner.server.ts", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/lib/jobs/scraper-runner.server.ts")
  >()),
  runScraper,
}));
import { handleKatamariImport } from "../src/lib/jobs/katamari-job.server.ts";

const job = { id: "katamari-test", userId: "admin" } as Job;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test("discovers both games, skips unavailable models, and downloads corrected encoded filenames", async () => {
  const fetch = vi.fn(async (url: string) =>
    url.endsWith(".json")
      ? Response.json([
          { status: "no_model", file: "" },
          { status: "exported", file: "0001_Test Model..glb" },
        ])
      : new Response("model bytes"),
  );
  vi.stubGlobal("fetch", fetch);
  await handleKatamariImport(job);
  const [, config, categories] = runScraper.mock.calls[0]!;
  expect(config.uploaderId).toBe("admin");
  expect(categories.map((category) => category.slug)).toEqual([
    "katamari-damacy",
    "we-love-katamari",
  ]);
  for (const category of categories) {
    expect(category.files).toHaveLength(1);
    expect(category.files[0]!.filename).toBe("0001_Test_Model.glb");
    expect((await category.files[0]!.download()).toString()).toBe(
      "model bytes",
    );
  }
  expect(fetch.mock.calls.map(([url]) => url).slice(2)).toEqual([
    "https://pub-13a5286ea5b347fbb60687b5ebb02b5a.r2.dev/models-v3/0001_Test%20Model.glb",
    "https://pub-13a5286ea5b347fbb60687b5ebb02b5a.r2.dev/we-love-katamari-models-v2/0001_Test%20Model.glb",
  ]);
  vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));
  await expect(categories[0]!.files[0]!.download()).rejects.toThrow("404");
});

test.each([
  [{ unexpected: "catalog shape" }],
  [{ status: "no_model", file: "" }],
  [{ status: "exported", file: "../escape.glb" }],
  [{ status: "exported", file: "not-a-model.png" }],
  [
    { status: "exported", file: "0001_A B.glb" },
    { status: "exported", file: "0001_A_B.glb" },
  ],
])(
  "rejects unusable catalogs before creating folders: %j",
  async (...entries) => {
    vi.stubGlobal("fetch", async () => Response.json(entries));
    await expect(handleKatamariImport(job)).rejects.toThrow();
    expect(runScraper).not.toHaveBeenCalled();
  },
);

test("a failed second catalog does not start a partial import", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        Response.json([{ status: "exported", file: "0001_Model.glb" }]),
      )
      .mockResolvedValueOnce(new Response(null, { status: 503 })),
  );
  await expect(handleKatamariImport(job)).rejects.toThrow(
    "We Love Katamari catalog: 503",
  );
  expect(runScraper).not.toHaveBeenCalled();
});
