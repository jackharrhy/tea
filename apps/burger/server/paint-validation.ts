import { TILE_SIZE } from "@tea/burger-core";

export type ValidatedPaint = {
  x: number;
  y: number;
  tileId: number | null;
};

/**
 * Validates an arbitrary JSON-decoded message into a trusted ValidatedPaint,
 * or returns null if the message is malformed or out of bounds.
 *
 * Coordinate convention: x/y are the **center** of the target tile cell.
 * The visual + physics layer treats Position as the center (sprite
 * anchor 0.5; collision math compares centers). Tile cell centers fall at
 * TILE_SIZE/2 + n*TILE_SIZE — so a valid x is e.g. 16, 48, 80, ... when
 * TILE_SIZE = 32.
 *
 * Rules:
 * - Reject non-objects, wrong type tags.
 * - Coords must be integers at a tile-cell center, inside world.bounds.
 * - tileId must be null (erase) or an integer in the catalog set.
 * - Unknown fields are dropped (only the known ones survive).
 */
export const validatePaint = (
  raw: unknown,
  world: { bounds: { x: number; y: number; w: number; h: number } },
  catalogIds: Set<number>,
): ValidatedPaint | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.type !== "paint") return null;

  if (!Number.isInteger(r.x) || !Number.isInteger(r.y)) return null;
  const x = r.x as number;
  const y = r.y as number;

  // Cell-center alignment: x ≡ TILE_SIZE/2 (mod TILE_SIZE)
  const halfTile = TILE_SIZE / 2;
  if ((((x - halfTile) % TILE_SIZE) + TILE_SIZE) % TILE_SIZE !== 0) return null;
  if ((((y - halfTile) % TILE_SIZE) + TILE_SIZE) % TILE_SIZE !== 0) return null;
  if (x < world.bounds.x || x >= world.bounds.x + world.bounds.w) return null;
  if (y < world.bounds.y || y >= world.bounds.y + world.bounds.h) return null;

  let tileId: number | null;
  if (r.tileId === null) {
    tileId = null;
  } else if (Number.isInteger(r.tileId) && catalogIds.has(r.tileId as number)) {
    tileId = r.tileId as number;
  } else {
    return null;
  }

  return { x, y, tileId };
};
