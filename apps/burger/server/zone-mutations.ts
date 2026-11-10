import type { Database } from "bun:sqlite";
import { validateZoneName, validateZoneCells, type ZonesState } from "./zones";

type Bounds = { x: number; y: number; w: number; h: number };

export type CreateResult =
  | { ok: true; id: number; name: string }
  | { ok: false; error: "name_invalid" | "name_taken" };

export const createZone = (
  db: Database,
  state: ZonesState,
  rawName: unknown,
): CreateResult => {
  const v = validateZoneName(rawName);
  if (!v.ok) return { ok: false, error: "name_invalid" };
  const existing = db
    .query("SELECT id FROM zones WHERE name = ?")
    .get(v.name) as { id: number } | null;
  if (existing) return { ok: false, error: "name_taken" };
  const result = db.run("INSERT INTO zones (name, created_at) VALUES (?, ?)", [
    v.name,
    Date.now(),
  ]);
  const id = Number(result.lastInsertRowid);
  state.zones.set(id, {
    id,
    name: v.name,
    cells: new Set(),
    members: new Set(),
  });
  return { ok: true, id, name: v.name };
};

export type RenameResult =
  | { ok: true; id: number; name: string }
  | { ok: false; error: "name_invalid" | "name_taken" | "not_found" };

export const renameZone = (
  db: Database,
  state: ZonesState,
  id: number,
  rawName: unknown,
): RenameResult => {
  const zone = state.zones.get(id);
  if (!zone) return { ok: false, error: "not_found" };
  const v = validateZoneName(rawName);
  if (!v.ok) return { ok: false, error: "name_invalid" };
  if (v.name === zone.name) return { ok: true, id, name: v.name };
  const existing = db
    .query("SELECT id FROM zones WHERE name = ? AND id != ?")
    .get(v.name, id) as { id: number } | null;
  if (existing) return { ok: false, error: "name_taken" };
  db.run("UPDATE zones SET name = ? WHERE id = ?", [v.name, id]);
  zone.name = v.name;
  return { ok: true, id, name: v.name };
};

export type DeleteResult =
  | { ok: true; affectedUserIds: string[] }
  | { ok: false; error: "not_found" };

export const deleteZone = (
  db: Database,
  state: ZonesState,
  id: number,
): DeleteResult => {
  const zone = state.zones.get(id);
  if (!zone) return { ok: false, error: "not_found" };
  const affected = [...zone.members];
  const tx = db.transaction(() => {
    db.run("DELETE FROM zones WHERE id = ?", [id]);
  });
  tx();
  for (const key of zone.cells) state.cellToZone.delete(key);
  state.zones.delete(id);
  return { ok: true, affectedUserIds: affected };
};

export type CellsDiff = {
  add: unknown;
  remove: unknown;
};

export type MutateCellsResult =
  | {
      ok: true;
      added: number;
      removed: number;
      dropped: number;
      affectedUserIds: string[];
    }
  | { ok: false; error: "not_found" };

export const mutateZoneCells = (
  db: Database,
  state: ZonesState,
  id: number,
  diff: CellsDiff,
  bounds: Bounds,
): MutateCellsResult => {
  const zone = state.zones.get(id);
  if (!zone) return { ok: false, error: "not_found" };
  const addV = validateZoneCells(diff.add, bounds);
  const removeV = validateZoneCells(diff.remove, bounds);

  let added = 0;
  let removed = 0;

  const tx = db.transaction(() => {
    for (const [x, y] of removeV.cells) {
      const key = `${x},${y}`;
      if (!zone.cells.has(key)) continue;
      db.run("DELETE FROM zone_cells WHERE zone_id = ? AND x = ? AND y = ?", [
        id,
        x,
        y,
      ]);
      removed++;
    }
    for (const [x, y] of addV.cells) {
      const key = `${x},${y}`;
      // Last-write-wins overlap: if the cell is in another zone, evict it from there.
      const prev = state.cellToZone.get(key);
      if (prev !== undefined && prev !== id) {
        db.run("DELETE FROM zone_cells WHERE zone_id = ? AND x = ? AND y = ?", [
          prev,
          x,
          y,
        ]);
      }
      db.run(
        "INSERT INTO zone_cells (zone_id, x, y) VALUES (?, ?, ?) ON CONFLICT (zone_id, x, y) DO NOTHING",
        [id, x, y],
      );
      added++;
    }
  });
  tx();

  // Mirror to in-memory state after commit.
  for (const [x, y] of removeV.cells) {
    const key = `${x},${y}`;
    if (zone.cells.has(key)) {
      zone.cells.delete(key);
      state.cellToZone.delete(key);
    }
  }
  for (const [x, y] of addV.cells) {
    const key = `${x},${y}`;
    const prev = state.cellToZone.get(key);
    if (prev !== undefined && prev !== id) {
      const prevZone = state.zones.get(prev);
      prevZone?.cells.delete(key);
    }
    zone.cells.add(key);
    state.cellToZone.set(key, id);
  }

  return {
    ok: true,
    added,
    removed,
    dropped: addV.dropped + removeV.dropped,
    affectedUserIds: [...zone.members],
  };
};

export type SetMembersResult =
  | {
      ok: true;
      memberUserIds: string[];
      affectedUserIds: string[];
      dropped: number;
    }
  | { ok: false; error: "not_found" };

export const setZoneMembers = (
  db: Database,
  state: ZonesState,
  id: number,
  rawUserIds: unknown,
): SetMembersResult => {
  const zone = state.zones.get(id);
  if (!zone) return { ok: false, error: "not_found" };
  if (!Array.isArray(rawUserIds)) {
    return { ok: false, error: "not_found" };
  }

  // Filter to known users.
  const valid: string[] = [];
  let dropped = 0;
  for (const raw of rawUserIds) {
    if (typeof raw !== "string") {
      dropped++;
      continue;
    }
    const row = db.query("SELECT id FROM users WHERE id = ?").get(raw) as {
      id: string;
    } | null;
    if (row) valid.push(raw);
    else dropped++;
  }

  const newSet = new Set(valid);
  const oldSet = new Set(zone.members);
  const affected = new Set<string>();
  for (const u of newSet) if (!oldSet.has(u)) affected.add(u);
  for (const u of oldSet) if (!newSet.has(u)) affected.add(u);

  const tx = db.transaction(() => {
    db.run("DELETE FROM zone_members WHERE zone_id = ?", [id]);
    for (const u of valid) {
      db.run(
        "INSERT INTO zone_members (zone_id, user_id, added_at) VALUES (?, ?, ?)",
        [id, u, Date.now()],
      );
    }
  });
  tx();

  zone.members = newSet;

  return {
    ok: true,
    memberUserIds: valid,
    affectedUserIds: [...affected],
    dropped,
  };
};
