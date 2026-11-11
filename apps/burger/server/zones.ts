import type { Database } from "bun:sqlite";
import { TILE_SIZE } from "@harrhy/burger-core";

export type ZoneRuntime = {
  id: number;
  name: string;
  cells: Set<string>;
  members: Set<string>;
};

export type ZonesState = {
  zones: Map<number, ZoneRuntime>;
  cellToZone: Map<string, number>;
};

export const loadZones = (db: Database): ZonesState => {
  const zones = new Map<number, ZoneRuntime>();
  const cellToZone = new Map<string, number>();

  const zoneRows = db.query("SELECT id, name FROM zones").all() as {
    id: number;
    name: string;
  }[];

  for (const z of zoneRows) {
    zones.set(z.id, {
      id: z.id,
      name: z.name,
      cells: new Set(),
      members: new Set(),
    });
  }

  const cellRows = db.query("SELECT zone_id, x, y FROM zone_cells").all() as {
    zone_id: number;
    x: number;
    y: number;
  }[];

  for (const c of cellRows) {
    const zone = zones.get(c.zone_id);
    if (!zone) continue;
    const key = `${c.x},${c.y}`;
    zone.cells.add(key);
    cellToZone.set(key, c.zone_id);
  }

  const memberRows = db
    .query("SELECT zone_id, user_id FROM zone_members")
    .all() as { zone_id: number; user_id: string }[];

  for (const m of memberRows) {
    const zone = zones.get(m.zone_id);
    if (!zone) continue;
    zone.members.add(m.user_id);
  }

  return { zones, cellToZone };
};

type CanPaintState = {
  zones: Map<number, ZoneRuntime>;
  cellToZone: Map<string, number>;
};

export const canPaint = (
  state: CanPaintState,
  userId: string,
  x: number,
  y: number,
  isAdmin: boolean,
): boolean => {
  if (isAdmin) return true;
  const zoneId = state.cellToZone.get(`${x},${y}`);
  if (zoneId === undefined) return false;
  const zone = state.zones.get(zoneId);
  return zone?.members.has(userId) ?? false;
};

export type NameValidation =
  | { ok: true; name: string }
  | { ok: false; error: string };

export const validateZoneName = (raw: unknown): NameValidation => {
  if (typeof raw !== "string") return { ok: false, error: "must be a string" };
  const name = raw.trim();
  if (name.length === 0) return { ok: false, error: "must not be empty" };
  if (name.length > 32) return { ok: false, error: "max 32 chars" };
  return { ok: true, name };
};

export type CellsValidation = {
  cells: [number, number][];
  dropped: number;
};

export const validateZoneCells = (
  raw: unknown,
  bounds: { x: number; y: number; w: number; h: number },
): CellsValidation => {
  if (!Array.isArray(raw)) return { cells: [], dropped: 0 };
  const halfTile = TILE_SIZE / 2;
  const cells: [number, number][] = [];
  let dropped = 0;
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      dropped++;
      continue;
    }
    const [x, y] = entry;
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      dropped++;
      continue;
    }
    if ((((x - halfTile) % TILE_SIZE) + TILE_SIZE) % TILE_SIZE !== 0) {
      dropped++;
      continue;
    }
    if ((((y - halfTile) % TILE_SIZE) + TILE_SIZE) % TILE_SIZE !== 0) {
      dropped++;
      continue;
    }
    if (x < bounds.x || x >= bounds.x + bounds.w) {
      dropped++;
      continue;
    }
    if (y < bounds.y || y >= bounds.y + bounds.h) {
      dropped++;
      continue;
    }
    cells.push([x as number, y as number]);
  }
  return { cells, dropped };
};
