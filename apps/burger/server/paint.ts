import { addComponent, addEntity, removeEntity } from "bitecs";
import type { Database } from "bun:sqlite";
import { isSolid, type World } from "./world";
import type { ValidatedPaint } from "./paint-validation";
import { markEntityDirty } from "./network.server";

/**
 * Apply a validated paint command:
 * - DB: INSERT/REPLACE/DELETE in `tiles`, append to `tile_edits`.
 * - ECS: replace the tile entity at (x, y) entirely.
 *
 * For paint-over-existing we remove the old entity and create a new one
 * (rather than mutating Tile.type in place) so the bitecs observer
 * serializer emits RemoveEntity + AddEntity wire events. Field-level
 * mutations are not part of the observer protocol; only component
 * adds/removes and entity adds/removes are.
 *
 * Caller is responsible for validation, admin gating, and rate limiting.
 */
export const applyPaint = (
  world: World,
  db: Database,
  cmd: ValidatedPaint,
  userId: string,
): void => {
  const { Position, Tile, Networked, Solid } = world.components;
  const { x, y, tileId } = cmd;
  const key = `${x},${y}`;
  const existingEid = world.tilesAtPosition.get(key);
  const oldTileId =
    existingEid !== undefined ? (Tile.type[existingEid] ?? null) : null;

  const tx = db.transaction(() => {
    if (tileId === null) {
      db.run("DELETE FROM tiles WHERE x = ? AND y = ?", [x, y]);
    } else {
      db.run(
        "INSERT INTO tiles (x, y, tile_id) VALUES (?, ?, ?) ON CONFLICT(x, y) DO UPDATE SET tile_id = excluded.tile_id",
        [x, y, tileId],
      );
    }
    db.run(
      "INSERT INTO tile_edits (x, y, old_tile_id, new_tile_id, user_id, edited_at) VALUES (?, ?, ?, ?, ?, ?)",
      [x, y, oldTileId, tileId, userId, Date.now()],
    );
  });
  tx();

  // Always remove the existing entity (if any) so erase-and-replace are both
  // expressed as observer-visible RemoveEntity events.
  if (existingEid !== undefined) {
    removeEntity(world, existingEid);
    world.tilesAtPosition.delete(key);
  }

  if (tileId === null) return;

  const cat = world.catalog.get(tileId);
  if (!cat) {
    // Should never happen — validator confirms catalog membership.
    return;
  }

  const eid = addEntity(world);
  addComponent(world, eid, Position);
  Position.x[eid] = x;
  Position.y[eid] = y;
  addComponent(world, eid, Tile);
  Tile.type[eid] = tileId;
  if (isSolid(cat.type)) addComponent(world, eid, Solid);
  addComponent(world, eid, Networked);
  world.tilesAtPosition.set(key, eid);

  // The bitecs OBSERVER stream announces this entity's existence but won't
  // carry its Position/Tile field values. Mark the entity dirty so the next
  // broadcastGameState includes a SoA payload with the actual data.
  markEntityDirty(eid);
};
