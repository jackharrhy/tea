import { describe, expect, it } from "vitest";

import {
  findMipTexture,
  identifyBsp,
  identifyWad,
  parseBsp,
  parseBspTextures,
  parseWad,
  planWorldAssets,
} from "../src/core/index.js";
import {
  makeBsp,
  makeBsp2,
  makeBsp38,
  makeMipTexture,
  makeWad,
} from "./fixtures.js";

function makeTwoLumpWad(first: Uint8Array, second: Uint8Array): Uint8Array {
  const directoryOffset = 12 + first.length + second.length;
  const bytes = new Uint8Array(directoryOffset + 64);
  const view = new DataView(bytes.buffer);
  new TextEncoder().encodeInto("WAD3", bytes.subarray(0, 4));
  view.setUint32(4, 2, true);
  view.setUint32(8, directoryOffset, true);
  bytes.set(first, 12);
  bytes.set(second, 12 + first.length);
  [
    { offset: 12, texture: first, name: "broken" },
    { offset: 12 + first.length, texture: second, name: "usable" },
  ].forEach((record, index) => {
    const directory = directoryOffset + index * 32;
    view.setUint32(directory, record.offset, true);
    view.setUint32(directory + 4, record.texture.length, true);
    view.setUint32(directory + 8, record.texture.length, true);
    view.setUint8(directory + 12, 0x43);
    new TextEncoder().encodeInto(
      record.name,
      bytes.subarray(directory + 16, directory + 32),
    );
  });
  return bytes;
}

describe("format identification", () => {
  it("recognizes every supported BSP prefix without parsing the body", () => {
    expect(identifyBsp(makeBsp({ version: 29 }))).toEqual({
      format: "quake-bsp29",
      version: 29,
    });
    expect(identifyBsp(makeBsp({ version: 30 }))).toEqual({
      format: "goldsrc-bsp30",
      version: 30,
    });
    expect(identifyBsp(makeBsp2())).toEqual({
      format: "quake-bsp2",
      version: "BSP2",
    });
    expect(identifyBsp(makeBsp38())).toEqual({
      format: "quake2-bsp38",
      version: 38,
    });
    expect(identifyBsp(makeBsp38({ qbsp: true }))).toEqual({
      format: "quake2-bsp38",
      version: 38,
    });
  });

  it("returns null for unknown, truncated, and unsupported prefixes", () => {
    expect(identifyBsp(new Uint8Array())).toBeNull();
    expect(identifyBsp(new Uint8Array([29, 0, 0]))).toBeNull();
    expect(identifyBsp(new Uint8Array([31, 0, 0, 0]))).toBeNull();
    const unsupportedIbsp = makeBsp38();
    new DataView(unsupportedIbsp.buffer).setUint32(4, 46, true);
    expect(identifyBsp(unsupportedIbsp)).toBeNull();
  });

  it("identifies WAD2 and WAD3 from their prefixes", () => {
    expect(identifyWad(makeWad(2))).toEqual({ version: 2 });
    expect(identifyWad(makeWad(3))).toEqual({ version: 3 });
    expect(identifyWad(new Uint8Array([0x57, 0x41, 0x44]))).toBeNull();
    expect(identifyWad(new TextEncoder().encode("PACK"))).toBeNull();
  });
});

describe("focused BSP texture parsing", () => {
  it("returns the same embedded texture records and warnings as a full parse", () => {
    const broken = makeMipTexture(30, "broken");
    new DataView(broken.buffer).setUint32(28, 20, true);
    const bytes = makeBsp({
      textureRecords: [makeMipTexture(30, "good"), broken],
    });
    const focused = parseBspTextures(bytes);
    const world = parseBsp(bytes);

    expect(focused.identification).toEqual({
      format: "goldsrc-bsp30",
      version: 30,
    });
    expect(focused.textures).toEqual(
      world.materials.flatMap((material) =>
        material.embeddedTexture ? [material.embeddedTexture] : [],
      ),
    );
    expect(focused.warnings).toEqual(
      world.warnings.filter((warning) =>
        ["noncanonical-miptex-dimensions", "unusable-miptex"].includes(
          warning.code,
        ),
      ),
    );
    expect(focused.textures[0]).toMatchObject({
      sourceIndex: 0,
      name: "good",
      width: 16,
      height: 16,
    });
  });

  it("does not parse unrelated geometry and reports no embedded textures for BSP38", () => {
    const bytes = makeBsp();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const faceOffset = view.getUint32(4 + 7 * 8, true);
    view.setUint16(faceOffset + 8, 100, true);
    expect(() => parseBsp(bytes)).toThrow(/surfedge range/u);
    expect(parseBspTextures(bytes).textures).toHaveLength(1);
    expect(parseBspTextures(makeBsp38())).toEqual({
      identification: { format: "quake2-bsp38", version: 38 },
      textures: [],
      warnings: [],
    });
  });
});

describe("recoverable WAD records", () => {
  it("preserves source indices when an earlier directory entry is unusable", () => {
    const bytes = makeTwoLumpWad(
      makeMipTexture(30, "broken"),
      makeMipTexture(30, "usable"),
    );
    const directory = new DataView(bytes.buffer).getUint32(8, true);
    bytes[directory + 13] = 1;
    const wad = parseWad(bytes);

    expect(wad.lumps.map(({ sourceIndex }) => sourceIndex)).toEqual([0, 1]);
    expect(wad.lumps[0]?.compression).toBe(1);
    expect(wad.warnings).toContainEqual(
      expect.objectContaining({
        code: "unsupported-wad-compression",
        lumpIndex: 0,
      }),
    );
    expect(wad.lumps[0]?.mipTexture).toBeUndefined();
    expect(wad.lumps[1]?.mipTexture).toMatchObject({
      sourceIndex: 1,
      name: "usable",
    });
    expect(findMipTexture(wad, "usable")).toBeDefined();
  });

  it("keeps unusable MIPTEX records and their source directory indices", () => {
    const bytes = makeWad(3);
    const texture = new DataView(
      bytes.buffer,
      bytes.byteOffset + 12,
      bytes.byteLength - 12,
    );
    texture.setUint32(28, 20, true);
    const wad = parseWad(bytes);

    expect(wad.lumps[0]).toMatchObject({
      sourceIndex: 0,
      name: "fixture",
      type: 0x43,
    });
    expect(wad.lumps[0]?.mipTexture).toBeUndefined();
    expect(wad.warnings).toContainEqual(
      expect.objectContaining({ code: "unusable-wad-miptex", lumpIndex: 0 }),
    );
    expect(findMipTexture(wad, "fixture")).toBeUndefined();
  });

  it("still rejects invalid directory and source ranges", () => {
    const overlappingDirectory = makeWad(3);
    new DataView(overlappingDirectory.buffer).setUint32(8, 4, true);
    expect(() => parseWad(overlappingDirectory)).toThrow(
      /directory overlaps its header/u,
    );

    const invalidDirectory = makeWad(3);
    new DataView(invalidDirectory.buffer).setUint32(
      8,
      invalidDirectory.length,
      true,
    );
    expect(() => parseWad(invalidDirectory)).toThrow(/directory exceeds/u);

    const invalidLump = makeWad(3);
    const view = new DataView(invalidLump.buffer);
    const directory = view.getUint32(8, true);
    view.setUint32(directory, invalidLump.length, true);
    expect(() => parseWad(invalidLump)).toThrow(/lump 0 exceeds/u);

    const overlappingLump = makeWad(3);
    const overlappingView = new DataView(overlappingLump.buffer);
    const overlappingLumpDirectory = overlappingView.getUint32(8, true);
    overlappingView.setUint32(overlappingLumpDirectory, 4, true);
    expect(() => parseWad(overlappingLump)).toThrow(
      /lump 0 overlaps its header/u,
    );
  });
});

describe("world asset planning", () => {
  it("keeps Quake II image replacements independent from companion WAL candidates", () => {
    const world = parseBsp(makeBsp38({ textureName: "+0E1U1/Fixture" }));
    const plan = planWorldAssets(world);

    expect(plan.palette?.candidates).toEqual(["pics/colormap.pcx"]);
    expect(plan.textures[0]).toMatchObject({
      name: "+0E1U1/Fixture",
      materialIndices: [0],
      imageCandidates: [
        "textures/+0e1u1/fixture.png",
        "textures/+0e1u1/fixture.tga",
        "textures/+0e1u1/fixture.jpg",
        "textures/+0e1u1/fixture.jpeg",
        "textures/_0e1u1/fixture.png",
        "textures/_0e1u1/fixture.tga",
        "textures/_0e1u1/fixture.jpg",
        "textures/_0e1u1/fixture.jpeg",
      ],
      walCandidates: [
        "textures/+0e1u1/fixture.wal",
        "textures/_0e1u1/fixture.wal",
      ],
    });
    expect(
      plan.skybox?.faces.find(({ suffix }) => suffix === "up")?.candidates,
    ).toEqual([
      "env/unit1_up.png",
      "env/unit1_up.tga",
      "env/unit1_up.jpg",
      "env/unit1_up.jpeg",
    ]);
  });

  it("rejects asset candidates that escape the logical game root", () => {
    const world = parseBsp(makeBsp38({ textureName: "../escape" }));
    expect(() => planWorldAssets(world)).toThrow(/unsafe game asset path/u);
  });

  it("describes map-authored assets separately from optional viewer defaults", () => {
    const world = parseBsp(
      makeBsp({
        entityText:
          '{ "classname" "worldspawn" "wad" "C:\\games\\fixture.wad" "skyname" "space_" }\n' +
          '{ "classname" "env_sprite" "model" "Sprites\\Glow.spr" }\n' +
          '{ "classname" "ambient_generic" "message" "Ambience\\Hum.wav" }\n' +
          '{ "classname" "ambient_music" "message" "Music\\Theme.mp3" }',
      }),
    );
    const mapOnly = planWorldAssets(world, { includeViewerDefaults: false });
    const complete = planWorldAssets(world);

    expect(mapOnly.wads[0]).toMatchObject({ candidates: ["fixture.wad"] });
    expect(mapOnly.skybox?.faces[0]?.candidates[0]).toBe("gfx/env/spacert.tga");
    expect(mapOnly.sprites[0]).toMatchObject({
      entityIndices: [1],
      candidates: ["sprites/glow.spr"],
    });
    expect(
      mapOnly.sounds.map(({ usage, origin, candidates }) => ({
        usage,
        origin,
        candidates,
      })),
    ).toEqual([
      {
        usage: "ambient",
        origin: "map",
        candidates: ["sound/ambience/hum.wav"],
      },
      { usage: "music", origin: "map", candidates: ["sound/music/theme.mp3"] },
    ]);
    expect(
      complete.sounds.some(({ origin }) => origin === "viewer-default"),
    ).toBe(true);
  });
});
