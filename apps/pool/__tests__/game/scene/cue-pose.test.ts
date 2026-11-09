import { expect, test } from "bun:test";
import {
  BALL_RADIUS,
  TABLE_HALF_WIDTH as W,
  TABLE_HALF_LENGTH as L,
} from "@tea/pool";
import {
  cuePose,
  CUE_LENGTH,
  CUE_RADIUS,
} from "../../../app/game/scene/cue-pose";
import { FELT_Y, RAIL_TOP_Y, RAIL_WIDTH } from "@tea/pool/table";

test("cue stays above the cloth and rails while aiming and pulling back near every cushion", () => {
  let clothClearance = Infinity,
    railClearance = Infinity;
  for (const ball of [
    { x: 0, z: 0 },
    { x: W - BALL_RADIUS, z: 0.5 },
    { x: -W + BALL_RADIUS, z: -0.5 },
    { x: 0.4, z: L - BALL_RADIUS },
    { x: -0.4, z: -L + BALL_RADIUS },
  ])
    for (let i = 0; i < 32; i++)
      for (const pull of [0, 0.5, 1]) {
        const pose = cuePose(ball, (i * Math.PI) / 16, pull);
        for (let s = 0; s <= CUE_LENGTH; s += 0.01) {
          const [x, y, z] = pose.position.map(
            (value, axis) => value - pose.axis[axis] * s,
          );
          clothClearance = Math.min(clothClearance, y - CUE_RADIUS - FELT_Y);
          const onRail =
            (Math.abs(x) >= W &&
              Math.abs(x) <= W + RAIL_WIDTH &&
              Math.abs(z) <= L + RAIL_WIDTH) ||
            (Math.abs(z) >= L &&
              Math.abs(z) <= L + RAIL_WIDTH &&
              Math.abs(x) <= W + RAIL_WIDTH);
          if (onRail)
            railClearance = Math.min(
              railClearance,
              y - CUE_RADIUS - RAIL_TOP_Y,
            );
        }
      }
  expect(clothClearance).toBeGreaterThan(0);
  expect(railClearance).toBeGreaterThan(0);
});
test("cue tip reaches the sphere surface at contact instead of passing through it", () => {
  const pose = cuePose({ x: 0, z: 0 }, 1.2, 0, true);
  expect(
    Math.hypot(
      pose.position[0],
      pose.position[1] - FELT_Y - BALL_RADIUS,
      pose.position[2],
    ),
  ).toBeCloseTo(BALL_RADIUS, 10);
});

test("full draw travels 25 cm along a regulation length cue", () => {
  const ready = cuePose({ x: 0, z: 0 }, 0, 0);
  const drawn = cuePose({ x: 0, z: 0 }, 0, 1);
  expect(
    Math.hypot(...drawn.position.map((v, i) => v - ready.position[i])),
  ).toBeCloseTo(0.25, 10);
  expect(CUE_LENGTH).toBe(1.45);
  expect(CUE_RADIUS * 2).toBe(0.03);
});
