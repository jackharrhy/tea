import { query } from "bitecs";
import { PLAYER_SIZE, TILE_SIZE } from "./const.shared";
import type { SharedWorld } from "./world.shared";

const CORNER_CORRECTION = 2;

// NOTE: this is a static (non-swept) AABB resolver. If `velocity * dt` exceeds
// roughly `TILE_SIZE - PLAYER_SIZE / 2`, the entity tunnels through walls in
// one step. This is currently safe because applyInputToVelocity caps velocity
// at PLAYER_SPEED (~3.3 px/tick at 60Hz), well below the tunneling threshold.
// Revisit if PLAYER_SPEED is raised or external impulses are introduced.
export const moveAndSlide = (
  world: SharedWorld,
  x: number,
  y: number,
  vx: number,
  vy: number,
  dt: number,
): { x: number; y: number } => {
  const { Position, Solid } = world.components;
  const solidEntities = query(world, [Position, Solid]);

  const HALF_TILE = TILE_SIZE / 2;
  const HALF_PLAYER = PLAYER_SIZE / 2;

  const hasCollision = (px: number, py: number): boolean => {
    for (const eid of solidEntities) {
      const tileX = Position.x[eid]!;
      const tileY = Position.y[eid]!;
      const overlapX = HALF_PLAYER + HALF_TILE - Math.abs(px - tileX);
      const overlapY = HALF_PLAYER + HALF_TILE - Math.abs(py - tileY);
      if (overlapX > 0 && overlapY > 0) return true;
    }
    return false;
  };

  let newX = x + vx * dt;
  let newY = y;

  if (vx !== 0 && hasCollision(newX, newY)) {
    for (let nudge = 1; nudge <= CORNER_CORRECTION; nudge++) {
      if (!hasCollision(newX, newY - nudge)) {
        newY -= nudge;
        break;
      }
      if (!hasCollision(newX, newY + nudge)) {
        newY += nudge;
        break;
      }
    }
  }

  for (const eid of solidEntities) {
    const tileX = Position.x[eid]!;
    const tileY = Position.y[eid]!;
    const overlapX = HALF_PLAYER + HALF_TILE - Math.abs(newX - tileX);
    const overlapY = HALF_PLAYER + HALF_TILE - Math.abs(newY - tileY);
    if (overlapX > 0 && overlapY > 0) {
      if (newX < tileX) {
        newX -= overlapX;
      } else {
        newX += overlapX;
      }
    }
  }

  newY = newY + vy * dt;

  if (vy !== 0 && hasCollision(newX, newY)) {
    for (let nudge = 1; nudge <= CORNER_CORRECTION; nudge++) {
      if (!hasCollision(newX - nudge, newY)) {
        newX -= nudge;
        break;
      }
      if (!hasCollision(newX + nudge, newY)) {
        newX += nudge;
        break;
      }
    }
  }

  for (const eid of solidEntities) {
    const tileX = Position.x[eid]!;
    const tileY = Position.y[eid]!;
    const overlapX = HALF_PLAYER + HALF_TILE - Math.abs(newX - tileX);
    const overlapY = HALF_PLAYER + HALF_TILE - Math.abs(newY - tileY);
    if (overlapX > 0 && overlapY > 0) {
      if (newY < tileY) {
        newY -= overlapY;
      } else {
        newY += overlapY;
      }
    }
  }

  // Clamp to world bounds (the "minecraft border" hard wall).
  // Skip when bounds are degenerate (w=0 or h=0) so callers without bounds
  // configured behave as before.
  let clampedX = newX;
  let clampedY = newY;
  if (world.bounds.w > 0) {
    const minX = world.bounds.x + HALF_PLAYER;
    const maxX = world.bounds.x + world.bounds.w - HALF_PLAYER;
    clampedX = Math.max(minX, Math.min(maxX, newX));
  }
  if (world.bounds.h > 0) {
    const minY = world.bounds.y + HALF_PLAYER;
    const maxY = world.bounds.y + world.bounds.h - HALF_PLAYER;
    clampedY = Math.max(minY, Math.min(maxY, newY));
  }

  return { x: clampedX, y: clampedY };
};
