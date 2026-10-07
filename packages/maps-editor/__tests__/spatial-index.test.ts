import { describe, expect, it } from "vitest";

import { BoundsSpatialIndex } from "../src/core/index.js";
import { boundsVisible } from "../src/render/scene-visibility.js";

describe("bounds spatial index", () => {
  const index = new BoundsSpatialIndex(
    Array.from({ length: 100 }, (_, value) => ({
      bounds: { min: [value * 16, 0, 0], max: [value * 16 + 8, 8, 8] },
      value,
    })),
    4,
  );

  it("returns ray candidates in broad-phase distance order", () => {
    expect(index.queryRay([-10, 4, 4], [1, 0, 0]).slice(0, 4)).toEqual([
      { distance: 10, value: 0 },
      { distance: 26, value: 1 },
      { distance: 42, value: 2 },
      { distance: 58, value: 3 },
    ]);
    expect(index.queryRay([-10, 20, 4], [1, 0, 0])).toEqual([]);
  });

  it("queries overlapping regions without scanning semantics leaking to callers", () => {
    expect(
      index.queryBounds({ min: [30, -1, -1], max: [50, 9, 9] }).toSorted(),
    ).toEqual([2, 3]);
  });

  it("rejects invalid entries and handles an empty index", () => {
    expect(new BoundsSpatialIndex([]).queryRay([0, 0, 0], [1, 0, 0])).toEqual(
      [],
    );
    expect(
      () =>
        new BoundsSpatialIndex([
          { bounds: { min: [1, 0, 0], max: [0, 1, 1] }, value: "invalid" },
        ]),
    ).toThrow(/finite and ordered/);
  });
});

describe("scene batch visibility", () => {
  const identity = new Float32Array([
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
  ]);

  it("rejects a batch wholly outside one homogeneous clip plane", () => {
    expect(
      boundsVisible(identity, { min: [-0.5, -0.5, 0.1], max: [0.5, 0.5, 0.9] }),
    ).toBe(true);
    expect(
      boundsVisible(identity, { min: [2, -0.5, 0.1], max: [3, 0.5, 0.9] }),
    ).toBe(false);
  });
});
