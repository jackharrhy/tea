import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  createDeveloperMaterial,
  createDevelopmentMaterials,
  createCompilerToolMaterials,
  createDiagnosticQuakePalette,
  createStarterDocument,
  encodeQuakeWad2,
  parseMap,
  serializeMap,
} from "@tea/maps-editor/core";
import type { HostedResourceMount } from "@tea/maps-protocol";
import { prepareWadBuildResources } from "../src/wad-build-resources.js";
import {
  createQuakePalette,
  parseWad,
  decodeMipTexture,
} from "@tea/maps-renderer/core";

const source = serializeMap(createStarterDocument());
const palette = createDiagnosticQuakePalette();
function pack(name: string, bytes: Uint8Array): HostedResourceMount {
  return {
    id: "pack",
    ordinal: 0,
    provider: "artbin",
    providerAssetId: "asset",
    expectedSha256: createHash("sha256").update(bytes).digest("hex"),
    kind: "wad",
    displayName: name,
    size: bytes.byteLength,
    createdAt: 0,
  };
}
function store(bytes: Uint8Array | null) {
  return {
    get: async () => bytes,
    put: async () => {
      throw new Error("Builds must not mutate resources");
    },
  };
}
const paletteMount: HostedResourceMount = {
  ...pack("palette.lmp", palette),
  kind: "palette",
};

describe("hosted build textures", () => {
  test("uses a pinned palette for generated development textures", async () => {
    const customPalette = new Uint8Array(768).fill(120);
    const result = await prepareWadBuildResources(
      source,
      "quake",
      [{ ...pack("palette.lmp", customPalette), kind: "palette" }],
      store(customPalette),
    );
    const expected = encodeQuakeWad2(
      [...createDevelopmentMaterials(), ...createCompilerToolMaterials()],
      customPalette,
    );
    expect(result.assets[0]?.bytes).toEqual(new Uint8Array(expected));
  });
  test("includes the shared development pack without changing canonical source", async () => {
    const result = await prepareWadBuildResources(
      source,
      "goldsrc",
      [],
      store(null),
    );
    expect(result.assets.map(({ name }) => name)).toEqual(["tea_maps_dev.wad"]);
    const document = parseMap(result.mapText);
    expect(document.entities[0]?.properties.wad).toBe("tea_maps_dev.wad");
    expect(result.mapText).toContain("DEV_FLOOR");
    expect(parseMap(source).entities[0]?.properties.wad).toBeUndefined();
    const wad = parseWad(result.assets[0]!.bytes);
    expect(wad.version).toBe(3);
    const orange = decodeMipTexture(
      wad.lumps.find(({ name }) => name === "DEV_FLOOR")!.data,
    );
    expect(orange.levels[0]!.rgba).toEqual(
      createDevelopmentMaterials()[0]!.rgba,
    );
  });

  test("builds Quake with the standard palette when no custom palette is pinned", async () => {
    const result = await prepareWadBuildResources(
      source,
      "quake",
      [],
      store(null),
    );
    const wad = parseWad(result.assets[0]!.bytes);
    expect(wad.version).toBe(2);
    const floor = decodeMipTexture(
      wad.lumps.find(({ name }) => name === "DEV_FLOOR")!.data,
      createQuakePalette(),
    );
    expect(
      floor.levels[0]!.rgba.slice(
        (32 * floor.width + 32) * 4,
        (32 * floor.width + 32) * 4 + 4,
      ),
    ).toEqual(new Uint8Array([175, 103, 35, 255]));
  });

  test("sends only used pinned textures in the native compiler last-pack-wins order", async () => {
    const bytes = new Uint8Array(
      encodeQuakeWad2(
        [
          createDeveloperMaterial("CUSTOM", [80, 40, 20]),
          createDeveloperMaterial("DEV_FLOOR", [30, 50, 70]),
        ],
        palette,
      ),
    );
    const result = await prepareWadBuildResources(
      source.replaceAll("DEV_FLOOR", "CUSTOM"),
      "quake",
      [paletteMount, pack("../custom pack.wad", bytes)],
      {
        ...store(bytes),
        get: async (sha256: string) =>
          sha256 === paletteMount.expectedSha256 ? palette : bytes,
      },
    );
    const sent = parseWad(result.assets[1]!.bytes);
    expect(sent.lumps.map(({ name }) => name)).toEqual(["CUSTOM"]);
    expect(result.assets[1]!.bytes.byteLength).toBeLessThan(bytes.byteLength);
    expect(parseMap(result.mapText).entities[0]?.properties.wad).toBe(
      "tea_maps_dev.wad;project_1.wad",
    );
  });

  test("rejects missing or changed pinned bytes before compiling", async () => {
    const bytes = new Uint8Array(
      encodeQuakeWad2(
        [createDeveloperMaterial("CUSTOM", [80, 40, 20])],
        palette,
      ),
    );
    const mounts = [pack("custom.wad", bytes)];
    await expect(
      prepareWadBuildResources(source, "quake", mounts, store(null)),
    ).rejects.toThrow("custom.wad is unavailable");
    await expect(
      prepareWadBuildResources(
        source,
        "quake",
        mounts,
        store(new Uint8Array([1])),
      ),
    ).rejects.toThrow("does not match its pinned content");
  });

  test("names unresolved map textures and does not require artwork for skip faces", async () => {
    await expect(
      prepareWadBuildResources(
        source.replaceAll("DEV_FLOOR", "MISSING"),
        "quake",
        [paletteMount],
        store(palette),
      ),
    ).rejects.toThrow("Missing build textures: MISSING");
    await expect(
      prepareWadBuildResources(
        source.replaceAll("DEV_FLOOR", "skip"),
        "quake",
        [paletteMount],
        store(palette),
      ),
    ).resolves.toHaveProperty("assets");
  });
});
