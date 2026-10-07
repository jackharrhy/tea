import { describe, expect, it } from "vitest";

import {
  bspPlayerProfile,
  planOverview,
  parseBsp,
  visibleWorldFaceMask,
} from "../src/core/index.js";

import { makeBsp, makeBsp38 } from "./fixtures.js";

describe("overview planning", () => {
  it("fits renderable geometry with deterministic padding", () => {
    const world = parseBsp(makeBsp());
    const overview = planOverview(world, {
      width: 200,
      height: 100,
      padding: 0.1,
    });
    expect(overview.bounds).toEqual({ min: [0, 0, 0], max: [16, 16, 0] });
    expect(overview.rotation).toBe(0);
    expect(overview.origin).toEqual([8, 8, 0]);
    expect(overview.worldUnitsPerPixel).toBeCloseTo(0.2);
    expect(overview.viewWidth).toBeCloseTo(40);
    expect(overview.viewHeight).toBeCloseTo(20);
  });

  it("rotates rectangular geometry when it improves the requested fit", () => {
    const world = parseBsp(makeBsp());
    const vertices = world.vertices.slice();
    for (let index = 0; index < vertices.length; index += 7)
      vertices[index]! *= 4;
    const overview = planOverview(
      { ...world, vertices },
      { width: 100, height: 200 },
    );
    expect(overview.rotation).toBe(90);
  });

  it("rejects inverted height slices", () => {
    const world = parseBsp(makeBsp());
    expect(() => planOverview(world, { zMin: 10, zMax: -10 })).toThrow(/zMin/);
    expect(() => planOverview(world, { width: 16_384 })).toThrow(
      /between 1 and 8192/,
    );
  });
});

describe("BSP player profiles", () => {
  it("keeps format-owned spawn and eye-height behavior explicit", () => {
    expect(bspPlayerProfile("quake-bsp29").eyeHeight).toBe(22);
    expect(bspPlayerProfile("quake-bsp2")).toEqual(
      bspPlayerProfile("quake-bsp29"),
    );
    expect(bspPlayerProfile("quake2-bsp38").eyeHeight).toBe(22);
    expect(bspPlayerProfile("goldsrc-bsp30").eyeHeight).toBe(28);
    expect(
      bspPlayerProfile("goldsrc-bsp30").spawnClasses.has(
        "info_player_counterterrorist",
      ),
    ).toBe(true);
    expect(
      bspPlayerProfile("quake2-bsp38").spawnClasses.has(
        "info_player_counterterrorist",
      ),
    ).toBe(false);
  });
});

describe("BSP visibility", () => {
  it("marks only faces referenced by leaves in the camera PVS", () => {
    const world = parseBsp(makeBsp({ faceCopies: 2, visibility: true }));
    expect(
      visibleWorldFaceMask(world.trace, world.visibility, [12, 0, 0]),
    ).toEqual(new Uint8Array([1, 0]));
  });

  it("falls back to drawing everything when the camera is in the solid leaf", () => {
    const world = parseBsp(makeBsp({ visibility: true }));
    expect(
      visibleWorldFaceMask(world.trace, world.visibility, [0, 0, 0]),
    ).toBeNull();
  });
});

describe("Quake II BSP38", () => {
  it("parses IBSP geometry, RGB lightmaps, entities, and material identity", () => {
    const world = parseBsp(makeBsp38({ surfaceValue: -12 }));

    expect(world).toMatchObject({
      format: "quake2-bsp38",
      version: 38,
      skyName: "unit1_",
      lightmapBytesPerTexel: 3,
      trace: null,
      visibility: null,
      collision: null,
    });
    expect(world.vertices).toHaveLength(28);
    expect(world.indices).toEqual(new Uint32Array([0, 1, 2, 0, 2, 3]));
    expect(world.materials).toMatchObject([
      {
        name: "e1u1/fixture",
        kind: "opaque",
        opacity: 1,
        scrollSpeed: 0,
        nextMaterialIndex: null,
        surfaceFlags: 0,
        surfaceValue: -12,
      },
    ]);
    expect(world.lightmapPages).toHaveLength(1);
    expect(world.lightmapPages[0]?.lightmaps[0]?.samples).toHaveLength(12);
  });

  it("uses Quake II surface flags for render classification", () => {
    expect(parseBsp(makeBsp38({ surfaceFlags: 0x04 })).materials[0]?.kind).toBe(
      "sky",
    );
    expect(parseBsp(makeBsp38({ surfaceFlags: 0x08 })).materials[0]?.kind).toBe(
      "water",
    );
    expect(
      parseBsp(makeBsp38({ surfaceFlags: 0x10 })).materials[0],
    ).toMatchObject({
      kind: "opaque",
      opacity: 0.33,
    });
    expect(
      parseBsp(makeBsp38({ surfaceFlags: 0x20 })).materials[0],
    ).toMatchObject({
      kind: "opaque",
      opacity: 0.66,
    });
    expect(
      parseBsp(makeBsp38({ surfaceFlags: 0x40 })).materials[0]?.scrollSpeed,
    ).toBe(1.6);
    expect(
      parseBsp(makeBsp38({ surfaceFlags: 0x48 })).materials[0]?.scrollSpeed,
    ).toBe(32);
    expect(parseBsp(makeBsp38({ surfaceFlags: 0x80 })).materials[0]?.kind).toBe(
      "tool",
    );
  });

  it("omits lightmaps from Quake II sky, warp, translucent, and nodraw surfaces", () => {
    for (const surfaceFlags of [0x04, 0x08, 0x10, 0x20, 0x80]) {
      const world = parseBsp(makeBsp38({ surfaceFlags }));
      expect(world.faces[0]?.lightmap).toMatchObject({
        pageIndex: -1,
        samples: null,
      });
    }
  });

  it("rejects invalid IBSP versions and truncated lightmaps", () => {
    const unsupported = makeBsp38();
    new DataView(unsupported.buffer).setUint32(4, 46, true);
    expect(() => parseBsp(unsupported)).toThrow(/IBSP and QBSP version 38/);
    expect(() => parseBsp(makeBsp38({ lightOffset: 8 }))).toThrow(
      /light samples/,
    );
  });
});
