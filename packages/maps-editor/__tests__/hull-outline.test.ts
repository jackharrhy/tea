import { expect, it } from "vitest";
import { planarHullOutline } from "../src/render/hull-outline.js";

it("keeps only the convex perimeter of unordered planar points", () => {
  const outline = planarHullOutline([
    [4, 4, 5],
    [0, 0, 5],
    [2, 2, 5],
    [4, 0, 5],
    [0, 4, 5],
  ]);
  expect(outline).toEqual([
    [0, 0, 5],
    [4, 0, 5],
    [4, 4, 5],
    [0, 4, 5],
  ]);
});
it("handles vertical polygons and leaves volume edges to the brush renderer", () => {
  expect(
    planarHullOutline([
      [5, 0, 0],
      [5, 4, 0],
      [5, 4, 4],
      [5, 0, 4],
    ]),
  ).toHaveLength(4);
  expect(
    planarHullOutline([
      [0, 0, 0],
      [4, 0, 0],
      [0, 4, 0],
      [0, 0, 4],
    ]),
  ).toEqual([]);
});

it("targets only the interior of a projected polygon, including reversed winding", async () => {
  const { containsProjectedHull } =
    await import("../src/render/hull-overlay.js");
  const triangle = [
    [0, 0],
    [100, 0],
    [50, 100],
  ] as const;
  expect(containsProjectedHull(triangle, [50, 40])).toBe(true);
  expect(containsProjectedHull(triangle.toReversed(), [50, 40])).toBe(true);
  expect(containsProjectedHull(triangle, [90, 90])).toBe(false);
  expect(
    containsProjectedHull([triangle[0], null, triangle[2]], [50, 40]),
  ).toBe(false);
  expect(
    containsProjectedHull(
      [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      [1, 0],
    ),
  ).toBe(false);
});
