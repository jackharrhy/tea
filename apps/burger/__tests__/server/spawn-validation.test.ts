import { expect, test } from "bun:test";
import { validateSpawn } from "../../server/spawn-validation";

const WORLD = { x: 0, y: 0, w: 2048, h: 2048 };

const ok = (
  overrides: Partial<{ x: number; y: number; w: number; h: number }> = {},
) => ({
  x: 64,
  y: 64,
  w: 128,
  h: 128,
  ...overrides,
});

test("valid zone passes", () => {
  const r = validateSpawn(ok(), WORLD);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.zone).toEqual({ x: 64, y: 64, w: 128, h: 128 });
});

test("rejects non-object input", () => {
  expect(validateSpawn(null, WORLD).ok).toBe(false);
  expect(validateSpawn(42 as unknown, WORLD).ok).toBe(false);
});

test("rejects non-integer fields", () => {
  expect(validateSpawn(ok({ x: 1.5 }), WORLD).ok).toBe(false);
  expect(validateSpawn(ok({ y: Number.NaN }), WORLD).ok).toBe(false);
  expect(validateSpawn(ok({ w: "100" as unknown as number }), WORLD).ok).toBe(
    false,
  );
});

test("rejects zero or negative w/h", () => {
  expect(validateSpawn(ok({ w: 0 }), WORLD).ok).toBe(false);
  expect(validateSpawn(ok({ h: -1 }), WORLD).ok).toBe(false);
});

test("rejects zone extending past world bounds (x+w > world.w)", () => {
  const r = validateSpawn(ok({ x: 2000, w: 100 }), WORLD);
  expect(r.ok).toBe(false);
});

test("rejects zone extending past world bounds (y+h > world.h)", () => {
  const r = validateSpawn(ok({ y: 2000, h: 100 }), WORLD);
  expect(r.ok).toBe(false);
});

test("rejects zone with x or y outside world", () => {
  expect(validateSpawn(ok({ x: -1 }), WORLD).ok).toBe(false);
  expect(validateSpawn(ok({ y: -1 }), WORLD).ok).toBe(false);
});

test("zone exactly at the edge is valid", () => {
  const r = validateSpawn(ok({ x: 0, y: 0, w: WORLD.w, h: WORLD.h }), WORLD);
  expect(r.ok).toBe(true);
});
