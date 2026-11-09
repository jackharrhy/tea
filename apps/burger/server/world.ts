import { existsSync, readFileSync } from "node:fs";
import { addComponent, addEntity, hasComponent, removeComponent } from "bitecs";
import type { Database } from "bun:sqlite";
import { createSharedWorld, TILE_SIZE } from "@tea/burger-core";
import atlas from "../atlas.toml";
import { loadZones, type ZoneRuntime } from "./zones";

export type CatalogEntry = {
  id: number;
  type: string;
  src_x: number;
  src_y: number;
  label: string;
};

// Whether a catalog type implies tile entities of this type should have the
// Solid component. Wall and counter block player movement; floor doesn't.
export const isSolid = (type: string): boolean =>
  type === "wall" || type === "counter";

export type WorldExtras = {
  catalog: Map<number, CatalogEntry>;
  catalogIds: Set<number>;
  tilesAtPosition: Map<string, number>;
  spawnZone: { x: number; y: number; w: number; h: number };
  typeIdToAtlasSrc: Record<number, [number, number]>;
  atlasInfo: { width: number; height: number; version: string };
  zones: Map<number, ZoneRuntime>;
  cellToZone: Map<string, number>;
};

// Try a couple of well-known locations for atlas.png and hash whichever we
// find. The path differs between dev (sibling client package) and prod
// (copied into burger-server's public dir by `pnpm copy-frontend`).
const ATLAS_CANDIDATE_PATHS = [
  "./public/assets/atlas.png", // prod (copy-frontend output)
  "../burger-client/public/assets/atlas.png", // dev (sibling package)
];

const computeAtlasVersion = (): string => {
  for (const path of ATLAS_CANDIDATE_PATHS) {
    if (!existsSync(path)) continue;
    try {
      const bytes = readFileSync(path);
      // Bun.hash returns a non-crypto 64-bit hash as bigint — plenty for cache
      // busting and faster than SHA. Encode as hex for a stable URL-safe token.
      return Bun.hash(bytes).toString(16);
    } catch {
      // Fall through to next candidate.
    }
  }
  // Neither path exists (atypical — neither dev nor prod). Use boot time
  // so at least each server restart cycles the version.
  console.warn(
    "atlas.png not found in known paths; using boot timestamp as cache-bust version",
  );
  return Date.now().toString(16);
};

const DEFAULT_WORLD_WIDTH = TILE_SIZE * 64; // 2048px
const DEFAULT_WORLD_HEIGHT = TILE_SIZE * 64;
const DEFAULT_SPAWN_W = TILE_SIZE * 4; // 128px
const DEFAULT_SPAWN_H = TILE_SIZE * 4;

// Spawn defaults are derived from world size so a fresh DB centers the
// spawn zone instead of pinning it to (0, 0). If world_width/height already
// exist in the settings table (e.g. an admin set them earlier), we read
// those values and center against them.
const computeDefaultSettings = (db: Database): Record<string, string> => {
  const existing = db
    .query(
      "SELECT key, value FROM settings WHERE key IN ('world_width','world_height')",
    )
    .all() as { key: string; value: string }[];
  const byKey = Object.fromEntries(existing.map((r) => [r.key, r.value]));
  const worldW = parseInt(byKey.world_width ?? String(DEFAULT_WORLD_WIDTH), 10);
  const worldH = parseInt(
    byKey.world_height ?? String(DEFAULT_WORLD_HEIGHT),
    10,
  );
  return {
    spawn_x: String(Math.round((worldW - DEFAULT_SPAWN_W) / 2)),
    spawn_y: String(Math.round((worldH - DEFAULT_SPAWN_H) / 2)),
    spawn_w: String(DEFAULT_SPAWN_W),
    spawn_h: String(DEFAULT_SPAWN_H),
    world_width: String(worldW),
    world_height: String(worldH),
  };
};

export const syncCatalog = (db: Database, tiles: CatalogEntry[]): void => {
  const stmt = db.prepare(
    "INSERT INTO tile_catalog (id, type, src_x, src_y, label) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET type = excluded.type, src_x = excluded.src_x, src_y = excluded.src_y, label = excluded.label",
  );
  const tomlIds = new Set(tiles.map((t) => t.id));
  const dbRows = db.query("SELECT id FROM tile_catalog").all() as {
    id: number;
  }[];
  for (const row of dbRows) {
    if (!tomlIds.has(row.id)) {
      console.warn(
        `tile_catalog row ${row.id} is in DB but not in atlas.toml; leaving in place`,
      );
    }
  }
  for (const t of tiles) {
    stmt.run(t.id, t.type, t.src_x, t.src_y, t.label);
  }
};

export const seedDefaultSettings = (db: Database): void => {
  const defaults = computeDefaultSettings(db);
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
  );
  for (const [k, v] of Object.entries(defaults)) {
    stmt.run(k, v);
  }
};

export const readSettings = (db: Database): Record<string, string> => {
  const rows = db.query("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
};

export const loadCatalog = (db: Database): Map<number, CatalogEntry> => {
  const rows = db
    .query("SELECT id, type, src_x, src_y, label FROM tile_catalog")
    .all() as CatalogEntry[];
  return new Map(rows.map((r) => [r.id, r]));
};

const loadTilesIntoEcs = (
  world: ReturnType<typeof createSharedWorld<WorldExtras>>,
  db: Database,
): void => {
  const { Position, Tile, Networked, Solid } = world.components;
  const rows = db.query("SELECT x, y, tile_id FROM tiles").all() as {
    x: number;
    y: number;
    tile_id: number;
  }[];

  for (const row of rows) {
    const cat = world.catalog.get(row.tile_id);
    if (!cat) {
      console.warn(
        `tile at (${row.x},${row.y}) references missing catalog id ${row.tile_id}; skipping`,
      );
      continue;
    }

    const eid = addEntity(world);
    addComponent(world, eid, Position);
    Position.x[eid] = row.x;
    Position.y[eid] = row.y;

    addComponent(world, eid, Tile);
    Tile.type[eid] = row.tile_id;

    if (isSolid(cat.type)) {
      addComponent(world, eid, Solid);
    }

    addComponent(world, eid, Networked);

    world.tilesAtPosition.set(`${row.x},${row.y}`, eid);
  }
};

// Walk every tile entity and reconcile its Solid component against the
// current catalog. Used after a catalog save when an admin may have flipped
// a tile's type (e.g. wall → floor) and existing tile entities need to
// gain or lose the Solid component to match. The bitecs observer stream
// announces add/remove of Solid to clients automatically.
export const reconcileTileSolidity = (
  world: ReturnType<typeof createSharedWorld<WorldExtras>>,
): void => {
  const { Tile, Solid } = world.components;
  for (const [, eid] of world.tilesAtPosition) {
    const tileId = Tile.type[eid];
    if (tileId === undefined) continue;
    const cat = world.catalog.get(tileId);
    if (!cat) continue; // orphan tile; saveCatalog blocks deleting referenced ids
    const shouldBeSolid = isSolid(cat.type);
    const currentlySolid = hasComponent(world, eid, Solid);
    if (shouldBeSolid && !currentlySolid) {
      addComponent(world, eid, Solid);
    } else if (!shouldBeSolid && currentlySolid) {
      removeComponent(world, eid, Solid);
    }
  }
};

const tomlData = atlas as {
  meta?: { width?: number; height?: number };
  tiles: CatalogEntry[];
};
const tomlTiles = tomlData.tiles;
const tomlAtlasInfo = {
  width: tomlData.meta?.width ?? 192,
  height: tomlData.meta?.height ?? 288,
  version: computeAtlasVersion(),
};

export const initWorld = (db: Database) => {
  syncCatalog(db, tomlTiles);
  seedDefaultSettings(db);

  const settings = readSettings(db);
  const catalog = loadCatalog(db);

  const spawnZone = {
    x: parseInt(settings.spawn_x ?? "0", 10),
    y: parseInt(settings.spawn_y ?? "0", 10),
    w: parseInt(settings.spawn_w ?? String(TILE_SIZE * 4), 10),
    h: parseInt(settings.spawn_h ?? String(TILE_SIZE * 4), 10),
  };

  const typeIdToAtlasSrc: Record<number, [number, number]> = {};
  for (const [id, entry] of catalog) {
    typeIdToAtlasSrc[id] = [entry.src_x, entry.src_y];
  }

  const zonesState = loadZones(db);

  const world = createSharedWorld<WorldExtras>({
    catalog,
    catalogIds: new Set(catalog.keys()),
    tilesAtPosition: new Map<string, number>(),
    spawnZone,
    typeIdToAtlasSrc,
    atlasInfo: tomlAtlasInfo,
    zones: zonesState.zones,
    cellToZone: zonesState.cellToZone,
  });

  world.bounds = {
    x: 0,
    y: 0,
    w: parseInt(settings.world_width ?? String(TILE_SIZE * 64), 10),
    h: parseInt(settings.world_height ?? String(TILE_SIZE * 64), 10),
  };

  loadTilesIntoEcs(world, db);

  return world;
};

export type World = ReturnType<typeof initWorld>;
