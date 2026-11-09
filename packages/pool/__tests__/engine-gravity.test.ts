import { expect, test } from "vitest";
import { PoolPhysics } from "../src/engine";
import { createShotResult, BALL_RADIUS } from "../src/physics";
import type { Ball } from "../src/physics";
import { FELT_Y } from "../src/physical-table";

const ball = (id: number, x: number, z: number, vx = 0, vz = 0): Ball => ({
  id,
  x,
  z,
  vx,
  vz,
  pocketed: false,
});

function advance(
  engine: PoolPhysics,
  seconds: number,
  result = createShotResult(),
) {
  for (let i = 0; i < seconds * 120; i++) engine.step(1 / 120, result);
  return result;
}

test("gravity changes wake every ball, preserve shot speed, and survive reset", () => {
  const initial = [ball(0, -0.2, 0.3), ball(1, 0.2, -0.3)];
  const engine = new PoolPhysics(initial);
  const other = new PoolPhysics(initial);
  try {
    const result = advance(engine, 1);
    expect(engine.gravity).toEqual([0, -9.81, 0]);
    expect(engine.step(0, result)).toBe(false);
    engine.setGravity([0, -9.81, 0]);
    expect(engine.step(0, result)).toBe(false);

    engine.setGravity([2, 4, -3]);
    expect(engine.step(0, result)).toBe(true);
    for (let run = 0; run < 2; run++) {
      engine.step(0.1, result);
      for (const b of engine.balls) {
        expect(b.vx).toBeCloseTo(0.2, 4);
        expect(b.vy).toBeCloseTo(0.4, 4);
        expect(b.vz).toBeCloseTo(-0.3, 4);
        expect(b.y).toBeGreaterThan(FELT_Y + BALL_RADIUS + 0.01);
      }
      if (run === 0) {
        engine.reset(initial);
        expect(engine.gravity).toEqual([2, 4, -3]);
      }
    }
    engine.strike(0, 1);
    expect(engine.balls[0]!.vx).toBe(7.5);
    expect(other.gravity).toEqual([0, -9.81, 0]);
    advance(other, 1);
    expect(
      other.balls.every((b) => Math.abs(b.y - FELT_Y - BALL_RADIUS) < 0.001),
    ).toBe(true);
  } finally {
    engine.dispose();
    other.dispose();
  }
});

test("gravity configuration accepts the bounds and does not alias caller vectors", () => {
  const engine = new PoolPhysics([ball(0, 0, 0)]);
  try {
    const gravity: [number, number, number] = [-15, 0, 15];
    engine.setGravity(gravity);
    gravity[0] = 3;
    const returned = engine.gravity as [number, number, number];
    returned[2] = 4;
    engine.reset([ball(0, 0, 0)]);
    expect(engine.gravity).toEqual([-15, 0, 15]);
    engine.setGravity([0, 0, 0]);
    expect(engine.gravity).toEqual([0, 0, 0]);
  } finally {
    engine.dispose();
  }
});

test("invalid gravity is rejected without changing configuration or waking balls", () => {
  const engine = new PoolPhysics([ball(0, 0, 0)]);
  try {
    const result = advance(engine, 1);
    for (const invalid of [
      [NaN, 0, 0],
      [0, Infinity, 0],
      [0, 0, -Infinity],
      [15.001, 0, 0],
      [0, -15.001, 0],
      [0, 0, 15.001],
      [0, 0],
      [0, 0, 0, 0],
      Array(3),
      ["0", 0, 0],
      null,
    ]) {
      expect(() =>
        engine.setGravity(
          invalid as unknown as readonly [number, number, number],
        ),
      ).toThrow(RangeError);
      expect(engine.gravity).toEqual([0, -9.81, 0]);
      expect(engine.step(0, result)).toBe(false);
    }
  } finally {
    engine.dispose();
  }
  expect(() => engine.setGravity([0, 0, 0])).toThrow("disposed");
});
