import { afterEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";

import { files, folders, jobs } from "#db";
import { setDbForTesting } from "#db/connection.server";

import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "./db.ts";

const generateBspDerivatives = vi.fn(async () => ({
  png: Buffer.from("overview-png"),
  walkabilityJson: '{"format":"tea-maps-walkability"}',
  usedWalkability: true,
  warnings: [],
}));
const createBspThumbnail = vi.fn(async () => Buffer.from("overview-thumbnail"));
const writeFile = vi.fn(async () => {});
const rename = vi.fn(async () => {});
const unlink = vi.fn(async () => {});
const readFile = vi.fn(async () => Buffer.from("bsp"));
const generatedPreview = { isErr: () => false, isOk: () => true, value: true };
const generateModelPreview = vi.fn(async () => generatedPreview);
const generatePreview = vi.fn(async () => generatedPreview);
const deleteFolderPreview = vi.fn(async () => {});
const generateFolderPreview = vi.fn(async () => null as string | null);
const clearWADPreviewCache = vi.fn(async () => {});
const emptyAssetPlan = {
  palette: null,
  wads: [],
  textures: [],
  skybox: null,
  sprites: [],
  sounds: [],
};

vi.mock("#lib/bsp-overview-renderer.server", () => ({
  generateBspDerivatives,
}));
vi.mock("#lib/folder-preview.server", () => ({
  deleteFolderPreview,
  generateFolderPreview,
}));
vi.mock("../src/lib/files.server.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/files.server.ts")>()),
  generateModelPreview,
  generatePreview,
}));
vi.mock("../src/lib/wad-assets.server.ts", () => ({ clearWADPreviewCache }));
vi.mock("../src/lib/bsp-derivatives.server.ts", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/lib/bsp-derivatives.server.ts")
  >()),
  createBspThumbnail,
  writeBspDependencyManifest: vi.fn(async () => ({
    format: "quake-bsp29",
    version: 29,
    warnings: [],
    assets: emptyAssetPlan,
  })),
}));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  existsSync: vi.fn(() => true),
}));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  rename,
  readFile,
  unlink,
  writeFile,
}));
vi.mock("fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("fs/promises")>()),
  rename,
  readFile,
  unlink,
  writeFile,
}));

const { handleRegeneratePreviews } =
  await import("../src/lib/jobs/regenerate-previews-job.server.ts");
const { createJob, processJob } = await import("#lib/jobs.server");

let currentDb: TestDatabase | undefined;

afterEach(() => {
  currentDb?.close();
  currentDb = undefined;
  vi.clearAllMocks();
});

function setupDatabase() {
  currentDb = createTestDatabase();
  applyMigrations(currentDb.sqlite);
  setDbForTesting(currentDb.db);
  return currentDb.db;
}

describe("preview regeneration job", () => {
  test("a move during rendering fails the target instead of marking a stale preview ready", async () => {
    const db = setupDatabase();
    await db
      .insert(folders)
      .values({ id: "assets", name: "Assets", slug: "assets" });
    await db.insert(files).values({
      id: "texture",
      path: "assets/texture.tga",
      name: "texture.tga",
      mimeType: "image/x-tga",
      size: 64,
      kind: "texture",
      folderId: "assets",
      status: "approved",
    });
    generatePreview.mockImplementationOnce(async () => {
      await db
        .update(files)
        .set({ path: "moved/texture.tga" })
        .where(eq(files.id, "texture"));
      return generatedPreview;
    });
    const input = { userId: "admin", target: { scope: "all" as const } };
    const job = await createJob({ type: "regenerate-previews", input });
    await expect(handleRegeneratePreviews(job, input)).rejects.toThrow(
      "Asset moved or was removed",
    );
    expect(
      await db.query.files.findFirst({ where: eq(files.id, "texture") }),
    ).toMatchObject({
      path: "moved/texture.tga",
      hasPreview: false,
    });
  });

  test("does not treat editable map sources as BSP previews", async () => {
    const db = setupDatabase();
    await db.insert(folders).values({ id: "maps", name: "Maps", slug: "maps" });
    await db.insert(files).values({
      id: "source",
      path: "maps/plane.map",
      name: "plane.map",
      mimeType: "text/plain",
      size: 64,
      kind: "map",
      folderId: "maps",
      status: "approved",
    });
    const input = { userId: "admin", target: { scope: "all" as const } };
    const job = await createJob({ type: "regenerate-previews", input });
    const result = await handleRegeneratePreviews(job, input);
    expect(result.mapPreviews).toBe(0);
    expect(generateBspDerivatives).not.toHaveBeenCalled();
    expect(deleteFolderPreview).toHaveBeenCalledWith("maps");
  });
  test("replaces every generated file preview during a full refresh", async () => {
    const db = setupDatabase();
    await db
      .insert(folders)
      .values({ id: "assets", name: "Assets", slug: "assets" });
    await db.insert(files).values([
      {
        id: "model",
        path: "assets/model.glb",
        name: "model.glb",
        mimeType: "model/gltf-binary",
        size: 64,
        kind: "model",
        folderId: "assets",
        status: "approved",
        hasPreview: true,
      },
      {
        id: "texture",
        path: "assets/texture.tga",
        name: "texture.tga",
        mimeType: "image/x-tga",
        size: 64,
        kind: "texture",
        folderId: "assets",
        status: "approved",
        hasPreview: true,
      },
    ]);
    const input = { userId: "admin", target: { scope: "all" as const } };
    const job = await createJob({ type: "regenerate-previews", input });

    const result = await handleRegeneratePreviews(job, input);

    expect(clearWADPreviewCache).toHaveBeenCalledOnce();
    expect(unlink).toHaveBeenCalledWith(
      expect.stringMatching(/model\.glb\.preview\.png$/),
    );
    expect(unlink).toHaveBeenCalledWith(
      expect.stringMatching(/texture\.tga\.preview\.png$/),
    );
    expect(generateModelPreview).toHaveBeenCalledOnce();
    expect(generatePreview).toHaveBeenCalledOnce();
    expect(deleteFolderPreview).toHaveBeenCalledWith("assets");
    expect(result).toMatchObject({ modelPreviews: 1, imagePreviews: 1 });
    expect(
      (await db.query.files.findMany()).every((file) => file.hasPreview),
    ).toBe(true);
  });

  test("renders an approved BSP before refreshing folder previews", async () => {
    const db = setupDatabase();
    await db.insert(folders).values({ id: "maps", name: "Maps", slug: "maps" });
    await db.insert(files).values({
      id: "map",
      path: "maps/example.bsp",
      name: "example.bsp",
      mimeType: "application/octet-stream",
      size: 64,
      kind: "map",
      folderId: "maps",
      status: "approved",
      hasPreview: true,
    });
    await db.insert(files).values({
      id: "other-map",
      path: "maps/other.bsp",
      name: "other.bsp",
      mimeType: "application/octet-stream",
      size: 64,
      kind: "map",
      folderId: "maps",
      status: "approved",
      hasPreview: false,
    });
    const target = { scope: "file" as const, fileId: "map" };
    const input = {
      userId: "admin",
      target,
    };
    const job = await createJob({ type: "regenerate-previews", input });

    const result = await handleRegeneratePreviews(job, input);

    expect(generateBspDerivatives).toHaveBeenCalledOnce();
    expect(generateBspDerivatives).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: expect.objectContaining({ format: "quake-bsp29" }),
        width: 2_048,
        height: 2_048,
      }),
    );
    expect(unlink).toHaveBeenCalledWith(
      expect.stringMatching(/example\.bsp\.preview\.png$/),
    );
    expect(unlink).toHaveBeenCalledWith(
      expect.stringMatching(/example\.bsp\.thumbnail\.webp$/),
    );
    expect(unlink).toHaveBeenCalledWith(
      expect.stringMatching(/example\.tea-maps-walkability\.json$/),
    );
    expect(unlink).toHaveBeenCalledWith(
      expect.stringMatching(/example\.artbin-bsp\.json$/),
    );
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/\.preview\.png\.tmp-.+$/),
      Buffer.from("overview-png"),
    );
    expect(rename).toHaveBeenCalledWith(
      expect.stringMatching(/\.preview\.png\.tmp-.+$/),
      expect.stringMatching(/example\.bsp\.preview\.png$/),
    );
    expect(createBspThumbnail).toHaveBeenCalledWith(
      Buffer.from("overview-png"),
    );
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/example\.bsp\.thumbnail\.webp\.tmp-.+$/),
      Buffer.from("overview-thumbnail"),
    );
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/example\.tea-maps-walkability\.json\.tmp-.+$/),
      '{"format":"tea-maps-walkability"}',
    );
    expect(result.mapPreviews).toBe(1);
    const updated = await db.query.files.findFirst({
      where: eq(files.id, "map"),
    });
    expect(updated?.hasPreview).toBe(true);
    const untouched = await db.query.files.findFirst({
      where: eq(files.id, "other-map"),
    });
    expect(untouched?.hasPreview).toBe(false);
  });

  test("fails with the target path when a BSP preview cannot be generated", async () => {
    const db = setupDatabase();
    await db.insert(folders).values({ id: "maps", name: "Maps", slug: "maps" });
    await db.insert(files).values({
      id: "map",
      path: "maps/broken.bsp",
      name: "broken.bsp",
      mimeType: "application/octet-stream",
      size: 64,
      kind: "map",
      folderId: "maps",
      status: "approved",
      hasPreview: true,
    });
    generateBspDerivatives.mockRejectedValueOnce(
      new Error("renderer unavailable"),
    );
    const input = {
      userId: "admin",
      target: { scope: "file" as const, fileId: "map" },
    };
    const job = await createJob({ type: "regenerate-previews", input });

    const result = await processJob(job);

    expect(result.isErr()).toBe(true);
    const failedJob = await db.query.jobs.findFirst({
      where: eq(jobs.id, job.id),
    });
    expect(failedJob).toMatchObject({
      status: "failed",
      error: expect.stringContaining(
        "map maps/broken.bsp: renderer unavailable",
      ),
    });
    const unchanged = await db.query.files.findFirst({
      where: eq(files.id, "map"),
    });
    expect(unchanged?.hasPreview).toBe(false);
  });

  test("reports a folder renderer failure after invalidating its stale preview", async () => {
    const db = setupDatabase();
    await db.insert(folders).values({
      id: "broken-folder",
      name: "Broken",
      slug: "broken",
      previewPath: "broken/_folder-preview.png",
    });
    generateFolderPreview.mockRejectedValueOnce(
      new Error("compositor unavailable"),
    );
    const input = {
      userId: "admin",
      target: { scope: "folder" as const, folderId: "broken-folder" },
    };
    const job = await createJob({ type: "regenerate-previews", input });

    const result = await processJob(job);

    expect(result.isErr()).toBe(true);
    expect(deleteFolderPreview).toHaveBeenCalledWith("broken-folder");
    const failedJob = await db.query.jobs.findFirst({
      where: eq(jobs.id, job.id),
    });
    expect(failedJob?.error).toContain("folder broken: compositor unavailable");
  });
});
