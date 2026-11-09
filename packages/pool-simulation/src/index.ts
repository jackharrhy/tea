import { createWorld, addEntity, addComponent, removeEntity } from "bitecs";

import { moveAvatar } from "./navigation";
export { TABLES, STOOLS, HALL, WALK_SPEED, walkable } from "./geometry";
export { findPath, tableApproach } from "./navigation";
export type { Point } from "./navigation";
import { WALK_SPEED, HALL_SPAWN } from "./geometry";
export function createMovementWorld() {
  return createWorld({
    components: { Position: { x: [] as number[], z: [] as number[] } },
  });
}
export type MovementWorld = ReturnType<typeof createMovementWorld>;
export function addAvatar(
  world: MovementWorld,
  x = HALL_SPAWN.x,
  z = HALL_SPAWN.z,
) {
  const eid = addEntity(world);
  addComponent(world, eid, world.components.Position);
  world.components.Position.x[eid] = x;
  world.components.Position.z[eid] = z;
  return eid;
}
export function removeAvatar(world: MovementWorld, eid: number) {
  removeEntity(world, eid);
}
export function stepAvatar(
  world: MovementWorld,
  eid: number,
  dx: number,
  dz: number,
  dt: number,
) {
  const p = world.components.Position;
  const length = Math.hypot(dx, dz);
  const scale = (WALK_SPEED * Math.min(dt, 0.1)) / Math.max(1, length);
  const next = moveAvatar(
    { x: p.x[eid], z: p.z[eid] },
    { x: dx * scale, z: dz * scale },
  );
  p.x[eid] = next.x;
  p.z[eid] = next.z;
  return next;
}
