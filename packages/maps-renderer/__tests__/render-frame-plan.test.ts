import { describe, expect, it } from "vitest";

import {
  parseBsp,
  type DrawBatch,
  type ParsedWorld,
} from "../src/core/index.js";
import {
  createWorldBatchCenters,
  createWorldFramePlan,
  worldRequiresContinuousAnimation,
} from "../src/render/world-frame-plan.js";

import { makeBsp } from "./fixtures.js";

function plan(
  world: ParsedWorld,
  options: Partial<Parameters<typeof createWorldFramePlan>[1]> = {},
) {
  return createWorldFramePlan(world, {
    cameraPosition: [0, 0, 0],
    includeSky: true,
    worldFaceVisibility: null,
    batchCenters: createWorldBatchCenters(world),
    hasSprites: false,
    hasWalkability: false,
    ...options,
  });
}

describe("compiled-world frame planning", () => {
  it("filters world batches by face visibility before choosing passes", () => {
    const parsed = parseBsp(makeBsp({ faceCopies: 2 }));
    const source = parsed.batches[0]!;
    const hidden: DrawBatch = { ...source, faceIndices: [0] };
    const visible: DrawBatch = { ...source, faceIndices: [1] };
    const world = { ...parsed, batches: [hidden, visible] };

    const frame = plan(world, { worldFaceVisibility: new Uint8Array([0, 1]) });

    expect(frame.opaque).toEqual([visible]);
    expect(frame.sky).toEqual([]);
    expect(frame.translucent).toEqual([]);
    expect(frame).toMatchObject({
      needsSkyPass: false,
      needsWorldPass: true,
    });
  });

  it("orders translucent brushes back-to-front without GPU state", () => {
    const parsed = parseBsp(
      makeBsp({
        version: 30,
        brushEntity:
          '"classname" "func_illusionary"\n"rendermode" "2"\n"renderamt" "128"',
      }),
    );
    const source = parsed.batches.find((batch) => batch.modelIndex === 1)!;
    const near: DrawBatch = { ...source };
    const far: DrawBatch = { ...source };
    const world = { ...parsed, batches: [near, far] };
    const centers = new Map<DrawBatch, readonly [number, number, number]>([
      [near, [4, 0, 0]],
      [far, [20, 0, 0]],
    ]);

    const frame = plan(world, { batchCenters: centers });

    expect(frame.opaque).toEqual([]);
    expect(frame.translucent).toEqual([far, near]);
  });

  it("makes sky, overlay, and empty-frame pass decisions explicit", () => {
    const parsed = parseBsp(makeBsp());
    const sky: DrawBatch = { ...parsed.batches[0]!, kind: "sky" };
    const skyWorld = { ...parsed, batches: [sky] };

    expect(plan(skyWorld)).toMatchObject({
      sky: [sky],
      needsSkyPass: true,
      needsWorldPass: false,
    });
    expect(plan(skyWorld, { hasWalkability: true })).toMatchObject({
      needsSkyPass: true,
      needsWorldPass: true,
    });
    expect(plan(skyWorld, { includeSky: false })).toMatchObject({
      sky: [],
      needsSkyPass: false,
      needsWorldPass: false,
    });
  });

  it("derives stable batch centers and continuous animation from world data", () => {
    const parsed = parseBsp(makeBsp());
    expect(createWorldBatchCenters(parsed).get(parsed.batches[0]!)).toEqual([
      8, 8, 0,
    ]);
    expect(worldRequiresContinuousAnimation(parsed)).toBe(false);
    expect(
      worldRequiresContinuousAnimation({
        ...parsed,
        batches: [{ ...parsed.batches[0]!, kind: "water" }],
      }),
    ).toBe(true);
  });
});
