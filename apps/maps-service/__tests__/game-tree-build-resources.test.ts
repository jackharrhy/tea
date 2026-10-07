import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { describe, expect, test } from "vitest";
import {
  createStarterDocument,
  materialUsageInDocument,
  parseMap,
  serializeMap,
} from "@tea/maps-editor/core";
import type { HostedResourceMount } from "@tea/maps-protocol";
import { prepareGameTreeBuildResources } from "../src/game-tree-build-resources.js";
import { hostedBuildProfile } from "../src/hosted-game-profiles.js";
import { createWorldPackage } from "../src/world-package.js";

const profile = hostedBuildProfile("gower");
if (profile.resourceLayout !== "game-tree")
  throw new Error("Expected a game-tree profile");

const source = serializeMap(createStarterDocument())
  .replace("{", '{\n"sky" "nightsky"')
  .replaceAll("DEV_FLOOR", "game/deck");

function mount(name: string, bytes: Uint8Array): HostedResourceMount {
  return {
    id: name,
    ordinal: 0,
    provider: "upload",
    providerAssetId: name,
    expectedSha256: createHash("sha256").update(bytes).digest("hex"),
    kind: name.split(".").at(-1) ?? "",
    displayName: name,
    size: bytes.length,
    createdAt: 0,
  };
}

describe("game-tree build resources", () => {
  test("selects referenced materials and sky faces for a portable package", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const materials = new Set(
      materialUsageInDocument(parseMap(source)).map(({ material }) =>
        material.toLowerCase(),
      ),
    );
    const names = [
      ...[...materials].flatMap((material) => [
        `textures/${material}.png`,
        `textures/${material}.wal_json`,
      ]),
      ...["rt", "lf", "ft", "bk", "up", "dn"].map(
        (face) => `env/nightsky${face}.tga`,
      ),
    ];
    const mounts = [...names, "textures/unused.png"].map((name) =>
      mount(name, bytes),
    );
    const result = await prepareGameTreeBuildResources(
      source,
      mounts,
      { get: async () => bytes },
      profile,
    );
    expect(result.assets.map(({ name }) => name).toSorted()).toEqual(
      names.toSorted(),
    );
    const packageFiles = unzipSync(
      createWorldPackage("test.bsp", bytes, result.assets),
    );
    expect(Object.keys(packageFiles).toSorted()).toEqual(
      ["maps/test.bsp", ...names].toSorted(),
    );
    expect(packageFiles["maps/test.bsp"]).toEqual(bytes);
  });

  test("rejects missing metadata and unsafe package paths", async () => {
    await expect(
      prepareGameTreeBuildResources(
        source,
        [],
        { get: async () => null },
        profile,
      ),
    ).rejects.toThrow(/missing an image/);
    expect(() =>
      createWorldPackage("test.bsp", new Uint8Array(), [
        { name: "textures/../secret.png", bytes: new Uint8Array() },
      ]),
    ).toThrow(/contained/);
  });
});
