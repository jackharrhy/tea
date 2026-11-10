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

test("minimum tap moves gently on the real bed and settles", () => {
  const engine = new PoolPhysics([ball(0, 0, 0.25)]);
  try {
    advance(engine, 1);
    engine.strike(0, 0.05);
    expect(engine.balls[0]!.vx).toBeCloseTo(0.0754, 3);
    const result = advance(engine, 3);
    expect(engine.balls[0]!.x).toBeGreaterThan(0.001);
    expect(engine.balls[0]!.x).toBeLessThan(0.05);
    expect(result.potted).toEqual([]);
    expect(engine.step(0, result)).toBe(false);
    expect(engine.recoveryCount).toBe(0);
  } finally {
    engine.dispose();
  }
});

test("pure vertical spin settles and cannot hold a turn for five minutes", () => {
  const engine = new PoolPhysics([ball(0, 0.13, 0.27)]);
  try {
    engine.restore([{ ...engine.balls[0]!, w: [0, 0.5, 0] }]);
    const result = createShotResult();
    for (let tick = 0; tick < 300 * 60; tick++) {
      const moving = engine.step(1 / 60, result);
      if (tick >= 5 * 60) expect(moving).toBe(false);
    }
    expect(engine.balls[0]!.w).toEqual([0, 0, 0]);
    expect(engine.balls[0]!.x).toBeCloseTo(0.13, 4);
    expect(engine.balls[0]!.z).toBeCloseTo(0.27, 4);
    expect(engine.recoveryCount).toBe(0);
    expect(result.potted).toEqual([]);
  } finally {
    engine.dispose();
  }
});

test("an airborne spin remains active through its apex, then lands and settles", () => {
  const engine = new PoolPhysics([ball(0, 0.13, 0.27)]);
  try {
    engine.restore([
      {
        ...engine.balls[0]!,
        y: FELT_Y + BALL_RADIUS + 0.05,
        vy: 1,
        w: [0, 0.5, 0],
      },
    ]);
    const result = createShotResult();
    let peak = 0;
    let descending = false;
    for (let tick = 0; tick < 48; tick++) {
      const moving = engine.step(1 / 240, result);
      const b = engine.balls[0]!;
      peak = Math.max(peak, b.y);
      descending ||= b.vy < 0;
      if (b.y > FELT_Y + BALL_RADIUS + 0.005) {
        expect(moving).toBe(true);
        expect(b.w[1]).toBeCloseTo(0.5, 4);
        expect(engine.events).toEqual([]);
      }
    }
    expect(peak).toBeGreaterThan(FELT_Y + BALL_RADIUS + 0.09);
    expect(descending).toBe(true);
    advance(engine, 5, result);
    expect(engine.step(0, result)).toBe(false);
    expect(engine.recoveryCount).toBe(0);
    expect(result.potted).toEqual([]);
  } finally {
    engine.dispose();
  }
});
