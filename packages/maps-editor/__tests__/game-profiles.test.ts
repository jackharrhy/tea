import { describe, expect, it } from "vitest";
import {
  decodeSurfaceAttributes,
  orderAssetMounts,
  mapsGameProfile,
} from "../src/core/index.js";

describe("game profiles and asset mounts", () => {
  it("constrains GoldSrc to Valve 220 while Quake retains classic syntax", () => {
    expect(mapsGameProfile("goldsrc").supportedFaceSyntaxes).toEqual([
      "valve-220",
    ]);
    expect(mapsGameProfile("quake").supportedFaceSyntaxes).toContain("quake");
  });

  it("defines Quake II as classic syntax with WAL materials and named surface metadata", () => {
    const profile = mapsGameProfile("quake2");

    expect(profile).toMatchObject({
      defaultFaceSyntax: "quake",
      supportedFaceSyntaxes: ["quake"],
      materialFormat: "wal",
      wadVersions: [],
    });
    expect(profile.surfaceSemantics).toBeDefined();
    const decoded = decodeSurfaceAttributes(
      { contents: 0x08000021, flags: 0x45, value: 300 },
      profile.surfaceSemantics!,
    );
    expect(decoded.contents.active.map(({ name }) => name)).toEqual([
      "solid",
      "water",
      "detail",
    ]);
    expect(decoded.flags.active.map(({ name }) => name)).toEqual([
      "light",
      "sky",
      "flowing",
    ]);
    expect(decoded).toMatchObject({
      contents: { unknownBits: 0 },
      flags: { unknownBits: 0 },
      value: 300,
    });
  });

  it("retains unknown Quake II surface bits for mod compatibility", () => {
    const semantics = mapsGameProfile("quake2").surfaceSemantics!;
    const decoded = decodeSurfaceAttributes(
      { contents: 0x40000001, flags: 0x101 },
      semantics,
    );

    expect(decoded.contents.active.map(({ name }) => name)).toEqual(["solid"]);
    expect(decoded.contents.unknownBits).toBe(0x40000000);
    expect(decoded.flags.active.map(({ name }) => name)).toEqual(["light"]);
    expect(decoded.flags.unknownBits).toBe(0x100);
  });

  it("orders mounts deterministically by priority then identity", () => {
    const mounts = orderAssetMounts([
      {
        id: "z",
        kind: "browser-wad",
        label: "Z",
        priority: 2,
        profile: "quake",
        sourceName: "z.wad",
        contentFingerprint: "test-z",
      },
      { id: "b", kind: "builtin", label: "B", priority: 1, profile: "quake" },
      { id: "a", kind: "builtin", label: "A", priority: 1, profile: "quake" },
    ]);
    expect(mounts.map(({ id }) => id)).toEqual(["a", "b", "z"]);
  });
});
