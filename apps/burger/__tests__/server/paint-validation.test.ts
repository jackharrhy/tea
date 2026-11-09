import { expect, test } from "bun:test";
import { validatePaint } from "../../server/paint-validation";
import { TILE_SIZE } from "@tea/burger-core";

const world = {
  bounds: { x: 0, y: 0, w: TILE_SIZE * 10, h: TILE_SIZE * 10 },
};
const catalog = new Set([1, 2, 3]);

// Cell-center convention: valid x is HALF + n*TILE_SIZE = 16, 48, 80, ...
const HALF = TILE_SIZE / 2;
const CENTER_A = HALF; // first cell center
const CENTER_B = HALF + TILE_SIZE; // second cell center

test("valid paint passes (cell-center coords)", () => {
  const out = validatePaint(
    { type: "paint", x: CENTER_A, y: CENTER_B, tileId: 2 },
    world,
    catalog,
  );
  expect(out).toEqual({ x: CENTER_A, y: CENTER_B, tileId: 2 });
});

test("erase (tileId null) passes", () => {
  const out = validatePaint(
    { type: "paint", x: CENTER_A, y: CENTER_B, tileId: null },
    world,
    catalog,
  );
  expect(out).toEqual({ x: CENTER_A, y: CENTER_B, tileId: null });
});

test("rejects non-object", () => {
  expect(validatePaint(null, world, catalog)).toBeNull();
  expect(validatePaint("hi", world, catalog)).toBeNull();
  expect(validatePaint(42, world, catalog)).toBeNull();
});

test("rejects wrong type tag", () => {
  expect(
    validatePaint(
      { type: "input", x: CENTER_A, y: CENTER_B, tileId: 1 },
      world,
      catalog,
    ),
  ).toBeNull();
});

test("rejects non-integer coords", () => {
  expect(
    validatePaint(
      { type: "paint", x: 16.5, y: CENTER_B, tileId: 1 },
      world,
      catalog,
    ),
  ).toBeNull();
  expect(
    validatePaint(
      { type: "paint", x: CENTER_A, y: "48", tileId: 1 },
      world,
      catalog,
    ),
  ).toBeNull();
});

test("rejects coords not aligned to cell centers", () => {
  // Top-left of a cell (multiple of TILE_SIZE) is no longer valid.
  expect(
    validatePaint(
      { type: "paint", x: 0, y: CENTER_B, tileId: 1 },
      world,
      catalog,
    ),
  ).toBeNull();
  expect(
    validatePaint(
      { type: "paint", x: TILE_SIZE, y: CENTER_B, tileId: 1 },
      world,
      catalog,
    ),
  ).toBeNull();
  // Off-grid
  expect(
    validatePaint(
      { type: "paint", x: 17, y: CENTER_B, tileId: 1 },
      world,
      catalog,
    ),
  ).toBeNull();
});

test("rejects coords outside bounds (each edge)", () => {
  // Below x bound
  expect(
    validatePaint(
      { type: "paint", x: -HALF, y: CENTER_A, tileId: 1 },
      world,
      catalog,
    ),
  ).toBeNull();
  // Below y bound
  expect(
    validatePaint(
      { type: "paint", x: CENTER_A, y: -HALF, tileId: 1 },
      world,
      catalog,
    ),
  ).toBeNull();
  // At/past right bound (bounds.w = TILE_SIZE * 10; last valid center = HALF + 9*TILE_SIZE)
  expect(
    validatePaint(
      {
        type: "paint",
        x: HALF + TILE_SIZE * 10,
        y: CENTER_A,
        tileId: 1,
      },
      world,
      catalog,
    ),
  ).toBeNull();
  // At/past bottom bound
  expect(
    validatePaint(
      {
        type: "paint",
        x: CENTER_A,
        y: HALF + TILE_SIZE * 10,
        tileId: 1,
      },
      world,
      catalog,
    ),
  ).toBeNull();
});

test("accepts coords at the inside edge", () => {
  const last = HALF + TILE_SIZE * 9;
  expect(
    validatePaint(
      { type: "paint", x: last, y: last, tileId: 1 },
      world,
      catalog,
    ),
  ).toEqual({ x: last, y: last, tileId: 1 });
});

test("rejects unknown tileId", () => {
  expect(
    validatePaint(
      { type: "paint", x: CENTER_A, y: CENTER_A, tileId: 999 },
      world,
      catalog,
    ),
  ).toBeNull();
});

test("rejects non-integer tileId", () => {
  expect(
    validatePaint(
      { type: "paint", x: CENTER_A, y: CENTER_A, tileId: 1.5 },
      world,
      catalog,
    ),
  ).toBeNull();
  expect(
    validatePaint(
      { type: "paint", x: CENTER_A, y: CENTER_A, tileId: "1" },
      world,
      catalog,
    ),
  ).toBeNull();
});

test("drops unknown fields", () => {
  const out = validatePaint(
    {
      type: "paint",
      x: CENTER_A,
      y: CENTER_B,
      tileId: 1,
      malicious: "data",
    },
    world,
    catalog,
  );
  expect(out).toEqual({ x: CENTER_A, y: CENTER_B, tileId: 1 });
});
