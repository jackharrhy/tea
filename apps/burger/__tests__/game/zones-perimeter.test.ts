import { expect, test, describe } from "bun:test";
import { computePerimeterSegments } from "../../app/game/zones-perimeter";
import { TILE_SIZE } from "@harrhy/burger-core";

const H = TILE_SIZE / 2;
const T = TILE_SIZE;

describe("computePerimeterSegments", () => {
  test("single cell has 4 edges", () => {
    const cells = new Set([`${H},${H}`]);
    const segments = computePerimeterSegments(cells);
    expect(segments.length).toBe(4);
  });

  test("two adjacent cells share an edge — 6 edges total", () => {
    // Cells at (H, H) and (H + T, H) are horizontally adjacent.
    const cells = new Set([`${H},${H}`, `${H + T},${H}`]);
    const segments = computePerimeterSegments(cells);
    // Each cell would have 4 edges; shared edge removed from both: 4 + 4 - 2 = 6.
    expect(segments.length).toBe(6);
  });

  test("2x2 block has 8 perimeter edges", () => {
    const cells = new Set([
      `${H},${H}`,
      `${H + T},${H}`,
      `${H},${H + T}`,
      `${H + T},${H + T}`,
    ]);
    const segments = computePerimeterSegments(cells);
    expect(segments.length).toBe(8);
  });

  test("empty cell set returns no segments", () => {
    expect(computePerimeterSegments(new Set())).toEqual([]);
  });
});
