import {
  BALL_RADIUS,
  TABLE_HALF_WIDTH as W,
  TABLE_HALF_LENGTH as L,
} from "@tea/pool";
import { FELT_Y, RAIL_TOP_Y } from "@tea/pool/table";

export const CUE_CONTACT_MS = 40;
export const CUE_LENGTH = 1.45;
export const CUE_RADIUS = 0.015;
const RAIL_CLEARANCE_Y = RAIL_TOP_Y + CUE_RADIUS + 0.005;
type Point = { x: number; z: number };

export function cuePose(
  ball: Point,
  angle: number,
  pull: number,
  contact = false,
) {
  const dx = Math.cos(angle),
    dz = Math.sin(angle);
  let railDistance = Infinity;
  for (const [position, direction, limit] of [
    [ball.x, -dx, W],
    [ball.z, -dz, L],
  ]) {
    if (Math.abs(direction) > 1e-8)
      railDistance = Math.min(
        railDistance,
        ((direction > 0 ? limit : -limit) - position) / direction,
      );
  }
  const y = FELT_Y + BALL_RADIUS;
  const elevation = Math.max(
    0.11,
    Math.atan2(RAIL_CLEARANCE_Y - y, Math.max(0.005, railDistance)),
  );
  const axis: [number, number, number] = [
    dx * Math.cos(elevation),
    -Math.sin(elevation),
    dz * Math.cos(elevation),
  ];
  const distance =
    BALL_RADIUS + (contact ? 0 : 0.018) + Math.min(1, Math.max(0, pull)) * 0.25;
  return {
    position: [
      ball.x - axis[0] * distance,
      y - axis[1] * distance,
      ball.z - axis[2] * distance,
    ] as [number, number, number],
    axis,
  };
}
