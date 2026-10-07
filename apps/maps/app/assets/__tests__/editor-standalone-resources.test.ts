import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { beforeEach, describe, expect, it } from "vitest";
import { developmentTexturePack } from "@tea/maps-editor/core";
import {
  addStandaloneWad,
  emptyStandaloneResources,
  loadStandaloneResources,
  saveStandaloneResources,
  setStandalonePalette,
  standaloneMaterials,
} from "../editor-standalone-resources.ts";

beforeEach(async () => {
  await deleteDB("tea-maps-standalone-resources");
});

describe("standalone map resources", () => {
  it("restores WADs and a palette only for their map and game", async () => {
    const wad = developmentTexturePack("quake")!.wad;
    const palette = new Uint8Array(768).fill(120);
    const withWad = addStandaloneWad(
      emptyStandaloneResources(),
      { name: "custom.wad", data: wad },
      "quake",
    );
    const resources = setStandalonePalette(withWad, palette, "quake");
    await saveStandaloneResources("map-one", "quake", resources);

    const restored = await loadStandaloneResources("map-one", "quake");
    expect(restored.wads.map(({ name }) => name)).toEqual(["custom.wad"]);
    expect(restored.palette).toEqual(palette);
    expect(standaloneMaterials(restored, "quake").length).toBeGreaterThan(0);
    expect((await loadStandaloneResources("map-two", "quake")).wads).toEqual(
      [],
    );
    expect((await loadStandaloneResources("map-one", "goldsrc")).wads).toEqual(
      [],
    );
  });

  it("rejects incompatible WADs and palettes before saving", () => {
    const wad = developmentTexturePack("quake")!.wad;
    expect(() =>
      addStandaloneWad(
        emptyStandaloneResources(),
        { name: "wrong.wad", data: wad },
        "goldsrc",
      ),
    ).toThrow(/cannot use/);
    expect(() =>
      setStandalonePalette(
        emptyStandaloneResources(),
        new Uint8Array(767),
        "quake",
      ),
    ).toThrow(/768 bytes/);
    expect(() =>
      setStandalonePalette(
        emptyStandaloneResources(),
        new Uint8Array(768),
        "goldsrc",
      ),
    ).toThrow(/require Quake/);
  });
});
