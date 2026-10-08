import type { WorldAssetPlan } from "@jackharrhy/worldview/core";
import { afterEach, describe, expect, test } from "vitest";

import { files, folders } from "#db";
import { setDbForTesting } from "#db/connection.server";
import {
  resolveApprovedBspAssetPlan,
  resolveApprovedWalPalette,
  selectBspAsset,
} from "../src/lib/bsp-assets.server.ts";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "./db.ts";

let currentDb: TestDatabase | undefined;

afterEach(() => {
  currentDb?.close();
  currentDb = undefined;
});

function setupDatabase() {
  currentDb = createTestDatabase();
  applyMigrations(currentDb.sqlite);
  setDbForTesting(currentDb.db);
  return currentDb.db;
}

const emptyPlan: WorldAssetPlan = {
  palette: null,
  wads: [],
  textures: [],
  skybox: null,
  sprites: [],
  sounds: [],
};

describe("BSP asset selection", () => {
  test("WAL palettes prefer sibling archives and exclude pending or unrelated files", async () => {
    const db = setupDatabase();
    await db.insert(folders).values({ id: "root", name: "Root", slug: "root" });
    for (const [id, path, status] of [
      ["sibling", "game/pak0/pics/colormap.pcx", "approved"],
      ["pending", "game/pak2/pics/colormap.pcx", "pending"],
      ["other", "other/pak0/pics/colormap.pcx", "approved"],
    ] as const) {
      await db.insert(files).values({
        id,
        path,
        status,
        name: "colormap.pcx",
        mimeType: "image/x-pcx",
        size: 100,
        kind: "texture",
        folderId: "root",
      });
    }
    expect(
      (await resolveApprovedWalPalette("game/pak2/textures/wall.wal"))?.id,
    ).toBe("sibling");
    expect(
      await resolveApprovedWalPalette("unrelated/textures/wall.wal"),
    ).toBeNull();
  });
  test("prefers the nearest matching game asset over the provided fallback", () => {
    const nearby = { path: "collection/mod/textures.wad" };
    const provided = { path: "_provided/goldsrc/textures.wad" };
    expect(
      selectBspAsset("collection/mod/maps/example.bsp", [provided, nearby]),
    ).toBe(nearby);
  });

  test("uses curated provided assets but ignores unrelated uploads", () => {
    const unrelated = { path: "another-upload/halflife.wad" };
    const provided = { path: "_provided/goldsrc/halflife.wad" };
    expect(
      selectBspAsset("collection/mod/maps/example.bsp", [unrelated, provided]),
    ).toBe(provided);
    expect(
      selectBspAsset("collection/mod/maps/example.bsp", [unrelated]),
    ).toBeNull();
  });

  test("prefers the curated asset matching a recognizable game directory", () => {
    const goldsrc = { path: "_provided/goldsrc/decals.wad" };
    const cstrike = { path: "_provided/cstrike/decals.wad" };
    expect(
      selectBspAsset("collection/cstrike/maps/example.bsp", [goldsrc, cstrike]),
    ).toBe(cstrike);
  });

  test("prefers Quake II curated assets for baseq2 maps", () => {
    const quake = { path: "_provided/quake/colormap.pcx" };
    const quake2 = { path: "_provided/quake2/colormap.pcx" };
    expect(
      selectBspAsset("collection/baseq2/maps/example.bsp", [quake, quake2]),
    ).toBe(quake2);
  });

  test("resolves canonical candidates only from approved contained collections", async () => {
    const db = setupDatabase();
    await db.insert(folders).values([
      { id: "collection", name: "Collection", slug: "collection" },
      { id: "other", name: "Other", slug: "other" },
      { id: "provided", name: "Provided", slug: "_provided" },
    ]);
    await db.insert(files).values([
      {
        id: "nearby",
        path: "collection/baseq2/pics/colormap.pcx",
        name: "colormap.pcx",
        mimeType: "application/octet-stream",
        size: 1,
        kind: "other",
        folderId: "collection",
        status: "approved",
      },
      {
        id: "pending",
        path: "collection/baseq2/textures/wall.wal",
        name: "wall.wal",
        mimeType: "application/octet-stream",
        size: 1,
        kind: "other",
        folderId: "collection",
        status: "pending",
      },
      {
        id: "unrelated",
        path: "other/baseq2/textures/wall.wal",
        name: "wall.wal",
        mimeType: "application/octet-stream",
        size: 1,
        kind: "other",
        folderId: "other",
        status: "approved",
      },
      {
        id: "fallback",
        path: "_provided/quake2/textures/wall.wal",
        name: "wall.wal",
        mimeType: "application/octet-stream",
        size: 1,
        kind: "other",
        folderId: "provided",
        status: "approved",
      },
    ]);
    const plan: WorldAssetPlan = {
      ...emptyPlan,
      palette: { kind: "palette", candidates: ["pics/colormap.pcx"] },
      textures: [
        {
          kind: "texture",
          name: "wall",
          materialIndices: [0],
          imageCandidates: [],
          walCandidates: ["textures/wall.wal"],
        },
      ],
    };

    const resolved = await resolveApprovedBspAssetPlan(
      {
        path: "collection/baseq2/maps/example.bsp",
      } as typeof files.$inferSelect,
      plan,
    );

    expect(resolved.palette?.id).toBe("nearby");
    expect(resolved.gameAssets["textures/wall.wal"]?.id).toBe("fallback");
  });
});
