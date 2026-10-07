import type { Vec3Tuple } from "./types.js";

/** Unit forward vector for Quake-family yaw and pitch angles expressed in radians. */
export function perspectiveForward(yaw: number, pitch: number): Vec3Tuple {
  const horizontal = Math.cos(pitch);
  return [
    Math.cos(yaw) * horizontal,
    Math.sin(yaw) * horizontal,
    Math.sin(pitch),
  ];
}

/** Horizontal right vector for Quake-family yaw angles expressed in radians. */
export function cameraRight(yaw: number): Vec3Tuple {
  return [Math.sin(yaw), -Math.cos(yaw), 0];
}
