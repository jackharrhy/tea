import { expect, test } from "bun:test";
import {
  applyInputToVelocity,
  applyVelocityToPosition,
  PLAYER_SPEED,
} from "@tea/burger-core";

const noInput = { up: false, down: false, left: false, right: false };

test("applyInputToVelocity is deterministic", () => {
  const a = applyInputToVelocity(0, 0, { ...noInput, right: true }, 16);
  const b = applyInputToVelocity(0, 0, { ...noInput, right: true }, 16);
  expect(a).toEqual(b);
});

test("diagonal input is normalized", () => {
  // Apply for many steps so velocity reaches steady state at PLAYER_SPEED magnitude.
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < 2000; i++) {
    const out = applyInputToVelocity(
      vx,
      vy,
      { up: true, right: true, down: false, left: false },
      16,
    );
    vx = out.vx;
    vy = out.vy;
  }
  const target = PLAYER_SPEED / Math.SQRT2;
  expect(vx).toBeCloseTo(target, 1);
  expect(vy).toBeCloseTo(-target, 1);
});

test("friction decays velocity towards zero with no input", () => {
  let vx = PLAYER_SPEED;
  let vy = 0;
  for (let i = 0; i < 2000; i++) {
    const out = applyInputToVelocity(vx, vy, noInput, 16);
    vx = out.vx;
    vy = out.vy;
  }
  expect(Math.abs(vx)).toBeLessThan(0.001);
  expect(Math.abs(vy)).toBeLessThan(0.001);
});

test("applyVelocityToPosition advances by vx*dt, vy*dt", () => {
  expect(applyVelocityToPosition(10, 20, 0.5, -0.25, 100)).toEqual({
    x: 60,
    y: -5,
  });
});

test("applyVelocityToPosition with zero velocity does not move", () => {
  expect(applyVelocityToPosition(10, 20, 0, 0, 100)).toEqual({ x: 10, y: 20 });
});
