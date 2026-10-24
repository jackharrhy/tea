import { describe, expect, it } from "vitest";

import {
  buildLightmapPage,
  createGoldSrcMovementState,
  moveGoldSrcPlayer,
  parseBsp,
  traceWorldSegment,
  tracePlayerHull,
  MapsError,
} from "../src/core/index.js";
import { selectEnvSoundRoom } from "../src/viewer/audio.js";

import { surfaceTextureBelow } from "../src/viewer/surface.js";
import { goldSrcTextureScrollSpeed } from "../src/render/renderer.js";

import { makeBsp } from "./fixtures.js";

describe("BSP", () => {
  it.each([29, 30] as const)(
    "parses a deterministic BSP%s scene",
    (version) => {
      const world = parseBsp(makeBsp({ version }));
      expect({
        format: world.format,
        skyName: world.skyName,
        vertices: world.vertices.length,
        indices: [...world.indices],
        faces: world.faces.length,
        batches: world.batches.length,
        pages: world.lightmapPages.map((page) => [page.width, page.height]),
        bytesPerTexel: world.lightmapBytesPerTexel,
      }).toEqual({
        format: version === 29 ? "quake-bsp29" : "goldsrc-bsp30",
        skyName: null,
        vertices: 28,
        indices: [0, 1, 2, 0, 2, 3],
        faces: 1,
        batches: 1,
        pages: [[2, 2]],
        bytesPerTexel: version === 29 ? 1 : 3,
      });
      expect(
        buildLightmapPage(world.lightmapPages[0]!, world.lightmapBytesPerTexel),
      ).toEqual(
        new Uint8Array([
          128, 128, 128, 255, 128, 128, 128, 255, 128, 128, 128, 255, 128, 128,
          128, 255,
        ]),
      );
    },
  );

  it("handles negative surfedges by using the edge endpoint", () => {
    const world = parseBsp(makeBsp({ firstSurfedge: -1 }));
    expect(world.vertices.slice(0, 3)).toEqual(new Float32Array([16, 16, 0]));
  });

  it("merges compatible draw batches while retaining each face boundary", () => {
    const world = parseBsp(makeBsp({ faceCopies: 2 }));
    expect(world.batches).toHaveLength(1);
    expect(world.batches[0]).toMatchObject({
      indexCount: 12,
      faceIndices: [0, 1],
    });
    expect(
      world.faces.map((face) => [
        face.sourceIndex,
        face.firstIndex,
        face.indexCount,
      ]),
    ).toEqual([
      [0, 0, 6],
      [1, 6, 6],
    ]);
  });

  it("retains static brush render state for the renderer", () => {
    const world = parseBsp(
      makeBsp({
        brushEntity:
          '"classname" "func_illusionary"\n"rendermode" "2"\n"renderamt" "128"\n"rendercolor" "12 34 56"',
      }),
    );
    expect(world.models[1]).toMatchObject({
      visible: true,
      entityIndex: 1,
      classname: "func_illusionary",
      collidable: false,
      renderMode: 2,
      renderAmount: 128,
      renderColor: [12, 34, 56],
      textureScrollSpeed: -547.5,
    });
  });

  it("retains GoldSrc scrolling-texture speed and scopes it to scroll materials", () => {
    const scrolling = parseBsp(
      makeBsp({
        textureName: "scroll_fixture",
        brushEntity: '"classname" "func_conveyor"\n"speed" "512"',
      }),
    );
    const worldBatch = scrolling.batches.find(
      (batch) => batch.modelIndex === 0,
    )!;
    const conveyorBatch = scrolling.batches.find(
      (batch) => batch.modelIndex === 1,
    )!;
    expect(scrolling.models[1]).toMatchObject({ textureScrollSpeed: 512 });
    expect(goldSrcTextureScrollSpeed(scrolling, worldBatch)).toBe(0);
    expect(goldSrcTextureScrollSpeed(scrolling, conveyorBatch)).toBe(512);

    const ordinary = parseBsp(
      makeBsp({
        textureName: "ordinary",
        brushEntity: '"classname" "func_conveyor"\n"speed" "512"',
      }),
    );
    expect(
      goldSrcTextureScrollSpeed(
        ordinary,
        ordinary.batches.find((batch) => batch.modelIndex === 1)!,
      ),
    ).toBe(0);
  });

  it("decodes the render-color scroll speed used by other GoldSrc brush entities", () => {
    const world = parseBsp(
      makeBsp({
        textureName: "scroll_fixture",
        brushEntity: '"classname" "func_wall"\n"rendercolor" "1 4 0"',
      }),
    );
    const batch = world.batches.find(
      (candidate) => candidate.modelIndex === 1,
    )!;
    expect(world.models[1]).toMatchObject({ textureScrollSpeed: -64 });
    expect(goldSrcTextureScrollSpeed(world, batch)).toBe(-64);
  });

  it("marks supported static solid brush models as player collision", () => {
    const world = parseBsp(
      makeBsp({
        collision: true,
        brushEntity: '"classname" "func_wall"',
      }),
    );
    expect(world.models[0]).toMatchObject({ collidable: true });
    expect(world.models[1]).toMatchObject({
      classname: "func_wall",
      collidable: true,
    });
  });

  it("hides moving func_water brush models from static exhibits", () => {
    const world = parseBsp(
      makeBsp({
        brushEntity:
          '"classname" "func_water"\n"rendermode" "0"\n"spawnflags" "1"',
      }),
    );
    expect(world.models[1]).toMatchObject({
      visible: false,
      classname: "func_water",
    });
  });

  it("rejects unsupported versions with a stable error code", () => {
    const bytes = makeBsp();
    new DataView(bytes.buffer).setUint32(0, 31, true);
    try {
      parseBsp(bytes);
      expect.fail("parseBsp should reject BSP31");
    } catch (error) {
      expect(error).toBeInstanceOf(MapsError);
      expect((error as MapsError).code).toBe("unsupported-bsp");
    }
  });

  it("rejects out-of-bounds lump ranges", () => {
    const bytes = makeBsp();
    new DataView(bytes.buffer).setUint32(4, bytes.length + 1, true);
    expect(() => parseBsp(bytes)).toThrow(/exceeds its source buffer/);
  });

  it("retains and traverses the static BSP trace tree for sound obstruction", () => {
    const world = parseBsp(makeBsp({ trace: true }));
    expect(traceWorldSegment(world.trace, [12, 0, 0], [16, 0, 0])).toEqual({
      blocked: false,
      crossesWaterBoundary: false,
    });
    expect(traceWorldSegment(world.trace, [12, 0, 0], [0, 0, 0]).blocked).toBe(
      true,
    );
  });

  it("retains and sweeps the authored standing collision hull", () => {
    const world = parseBsp(makeBsp({ collision: true }));
    expect(world.collision?.clipnodes).toEqual(new Int32Array([0, -1, -2]));
    const trace = tracePlayerHull(world, [8, 8, 50], [8, 8, 20]);
    expect(trace).toMatchObject({
      modelIndex: 0,
      startSolid: false,
      allSolid: false,
      planeNormal: [0, 0, 1],
    });
    expect(trace.fraction).toBeCloseTo(0.465_625);
    expect(trace.endPosition[2]).toBeCloseTo(36.031_25);
  });

  it("walks, jumps, and lands against a BSP standing hull at a fixed command step", () => {
    const world = parseBsp(makeBsp({ collision: true }));
    let state = createGoldSrcMovementState([8, 8, 36.031_25]);
    let result = moveGoldSrcPlayer(
      world,
      state,
      { forward: 1, side: 0, yaw: 0, jump: false },
      0.01,
    );
    state = result.state;
    expect(state.onGround).toBe(true);
    expect(state.origin[0]).toBeGreaterThan(8);

    result = moveGoldSrcPlayer(
      world,
      state,
      { forward: 1, side: 0, yaw: 0, jump: true },
      0.01,
    );
    state = result.state;
    expect(result.jumped).toBe(true);
    expect(state.onGround).toBe(false);
    expect(state.velocity[2]).toBeGreaterThan(250);

    let landed = false;
    for (let index = 0; index < 100 && !landed; index += 1) {
      result = moveGoldSrcPlayer(
        world,
        state,
        { forward: 0, side: 0, yaw: 0, jump: false },
        0.01,
      );
      state = result.state;
      landed = result.landed;
    }
    expect(landed).toBe(true);
    expect(state.onGround).toBe(true);
    expect(state.origin[2]).toBeCloseTo(36.031_25);
  });

  it("matches the stock GoldSrc ground acceleration and friction response", () => {
    const world = parseBsp(makeBsp({ collision: true }));
    let state = createGoldSrcMovementState([8, 8, 36.031_25]);
    let result = moveGoldSrcPlayer(
      world,
      state,
      { forward: 1, side: 0, yaw: 0, jump: false },
      0.01,
    );
    state = result.state;
    expect(state.velocity[0]).toBeCloseTo(32);

    result = moveGoldSrcPlayer(
      world,
      state,
      { forward: 0, side: 0, yaw: 0, jump: false },
      0.01,
    );
    expect(result.state.velocity[0]).toBeCloseTo(28);
  });

  it("finds the rendered texture below the player for footstep material selection", () => {
    const world = parseBsp(
      makeBsp({ collision: true, textureName: "court_tile" }),
    );
    expect(surfaceTextureBelow(world, [8, 8, 36])).toBe("court_tile");
  });

  it("detects open-to-liquid sound trace boundaries", () => {
    const trace = {
      planes: new Float32Array([1, 0, 0, 0]),
      nodes: new Int32Array([0, -1, -2]),
      leafContents: new Int32Array([-1, -3]),
      headNode: 0,
    };
    expect(traceWorldSegment(trace, [1, 0, 0], [-1, 0, 0])).toEqual({
      blocked: false,
      crossesWaterBoundary: true,
    });
  });

  it("selects only visible in-range env_sound entities and preserves the previous room otherwise", () => {
    const world = parseBsp(
      makeBsp({
        trace: true,
        entityText:
          '{ "classname" "worldspawn" }\n{ "classname" "env_sound" "origin" "12 0 0" "radius" "32" "roomtype" "5" }',
      }),
    );
    expect(selectEnvSoundRoom(world, [16, 0, 0], 0)).toBe(5);
    expect(selectEnvSoundRoom(world, [0, 0, 0], 3)).toBe(3);
  });
});
