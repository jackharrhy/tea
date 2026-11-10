import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { hasComponent, query } from "bitecs";
import { runMigrations } from "../../server/db";
import {
  syncCatalog,
  seedDefaultSettings,
  readSettings,
  loadCatalog,
  initWorld,
  reconcileTileSolidity,
} from "../../server/world";

const setupDb = (): Database => {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
};

test("syncCatalog inserts catalog rows from TOML data", () => {
  const db = setupDb();
  syncCatalog(db, [
    { id: 1, type: "floor", src_x: 0, src_y: 0, label: "floor" },
    { id: 2, type: "wall", src_x: 32, src_y: 0, label: "wall" },
  ]);
  const rows = db
    .query("SELECT * FROM tile_catalog ORDER BY id")
    .all() as Array<{
    id: number;
    type: string;
    src_x: number;
    src_y: number;
    label: string;
  }>;
  expect(rows).toEqual([
    { id: 1, type: "floor", src_x: 0, src_y: 0, label: "floor" },
    { id: 2, type: "wall", src_x: 32, src_y: 0, label: "wall" },
  ]);
});

test("syncCatalog updates existing rows by id", () => {
  const db = setupDb();
  syncCatalog(db, [
    { id: 1, type: "floor", src_x: 0, src_y: 0, label: "floor" },
  ]);
  syncCatalog(db, [
    { id: 1, type: "floor", src_x: 0, src_y: 0, label: "renamed" },
  ]);
  const row = db.query("SELECT label FROM tile_catalog WHERE id = 1").get() as {
    label: string;
  };
  expect(row.label).toBe("renamed");
});

test("syncCatalog leaves DB rows not in TOML in place (warning only)", () => {
  const db = setupDb();
  db.run(
    "INSERT INTO tile_catalog (id, type, src_x, src_y, label) VALUES (?, ?, ?, ?, ?)",
    [99, "wall", 0, 0, "legacy"],
  );
  syncCatalog(db, [
    { id: 1, type: "floor", src_x: 0, src_y: 0, label: "floor" },
  ]);
  const row = db.query("SELECT * FROM tile_catalog WHERE id = 99").get();
  expect(row).not.toBeNull();
});

test("seedDefaultSettings inserts defaults when missing", () => {
  const db = setupDb();
  seedDefaultSettings(db);
  const settings = readSettings(db);
  // World 2048x2048, default spawn 128x128, centered: (2048-128)/2 = 960
  expect(settings.world_width).toBe(String(64 * 32));
  expect(settings.world_height).toBe(String(64 * 32));
  expect(settings.spawn_w).toBe("128");
  expect(settings.spawn_h).toBe("128");
  expect(settings.spawn_x).toBe("960");
  expect(settings.spawn_y).toBe("960");
});

test("seedDefaultSettings preserves existing values", () => {
  const db = setupDb();
  db.run("INSERT INTO settings (key, value) VALUES (?, ?)", [
    "world_width",
    "999",
  ]);
  seedDefaultSettings(db);
  const settings = readSettings(db);
  expect(settings.world_width).toBe("999");
});

test("seedDefaultSettings centers spawn against existing world dimensions", () => {
  const db = setupDb();
  // Pre-seed a non-default world; spawn defaults should respect it.
  db.run("INSERT INTO settings (key, value) VALUES ('world_width', '1024')");
  db.run("INSERT INTO settings (key, value) VALUES ('world_height', '512')");
  seedDefaultSettings(db);
  const settings = readSettings(db);
  // (1024 - 128) / 2 = 448, (512 - 128) / 2 = 192
  expect(settings.spawn_x).toBe("448");
  expect(settings.spawn_y).toBe("192");
});

test("loadCatalog returns rows joined into a Map by id", () => {
  const db = setupDb();
  syncCatalog(db, [
    { id: 1, type: "floor", src_x: 0, src_y: 0, label: "f" },
    { id: 2, type: "wall", src_x: 32, src_y: 0, label: "w" },
  ]);
  const cat = loadCatalog(db);
  expect(cat.get(1)?.type).toBe("floor");
  expect(cat.get(2)?.type).toBe("wall");
  expect(cat.size).toBe(2);
});

test("initWorld creates ECS entities for tiles in DB", () => {
  const db = setupDb();
  // Use catalog ids in a range outside atlas.toml's reserved set so initWorld's
  // own atlas.toml sync doesn't overwrite our test fixtures.
  syncCatalog(db, [
    { id: 100, type: "floor", src_x: 0, src_y: 0, label: "f" },
    { id: 101, type: "wall", src_x: 32, src_y: 0, label: "w" },
  ]);
  db.run("INSERT INTO tiles (x, y, tile_id) VALUES (32, 64, 101)");
  db.run("INSERT INTO tiles (x, y, tile_id) VALUES (96, 64, 100)");
  seedDefaultSettings(db);

  const world = initWorld(db);
  const { Position, Tile, Solid } = world.components;
  const tiles = query(world, [Position, Tile]);
  // Two seeded tiles; atlas.toml entries don't add tiles, only catalog rows.
  expect(tiles.length).toBe(2);

  const solid = query(world, [Position, Solid]);
  expect(solid.length).toBe(1);

  expect(world.tilesAtPosition.has("32,64")).toBe(true);
  expect(world.tilesAtPosition.has("96,64")).toBe(true);
});

test("initWorld populates spawnZone and bounds from settings", () => {
  const db = setupDb();
  syncCatalog(db, [{ id: 1, type: "floor", src_x: 0, src_y: 0, label: "f" }]);
  seedDefaultSettings(db);
  const world = initWorld(db);
  expect(world.bounds.w).toBe(64 * 32);
  expect(world.bounds.h).toBe(64 * 32);
  // Default spawn centered in the default 2048x2048 world.
  expect(world.spawnZone.x).toBe(960);
  expect(world.spawnZone.y).toBe(960);
});

test("initWorld populates atlasInfo from atlas.toml meta", () => {
  const db = setupDb();
  seedDefaultSettings(db);
  const world = initWorld(db);
  expect(world.atlasInfo.width).toBe(448);
  expect(world.atlasInfo.height).toBe(448);
  // version is a non-empty cache-bust string (hash hex or boot timestamp).
  expect(typeof world.atlasInfo.version).toBe("string");
  expect(world.atlasInfo.version.length).toBeGreaterThan(0);
});

test("reconcileTileSolidity adds Solid when type flips floor → wall", () => {
  const db = setupDb();
  // Use ids outside atlas.toml's reserved range so initWorld's syncCatalog
  // doesn't overwrite our test fixtures.
  syncCatalog(db, [{ id: 100, type: "floor", src_x: 0, src_y: 0, label: "f" }]);
  db.run("INSERT INTO tiles (x, y, tile_id) VALUES (32, 32, 100)");
  seedDefaultSettings(db);
  const world = initWorld(db);
  const { Position, Solid } = world.components;

  expect(query(world, [Position, Solid])).toHaveLength(0);

  // Admin flips id=100 from floor to wall (e.g. via the atlas tool).
  world.catalog.set(100, {
    id: 100,
    type: "wall",
    src_x: 0,
    src_y: 0,
    label: "f",
  });
  reconcileTileSolidity(world);

  expect(query(world, [Position, Solid])).toHaveLength(1);
});

test("reconcileTileSolidity removes Solid when type flips wall → floor", () => {
  const db = setupDb();
  syncCatalog(db, [{ id: 101, type: "wall", src_x: 0, src_y: 0, label: "w" }]);
  db.run("INSERT INTO tiles (x, y, tile_id) VALUES (32, 32, 101)");
  seedDefaultSettings(db);
  const world = initWorld(db);
  const { Position, Tile, Solid } = world.components;

  // Sanity: the wall got the Solid component at boot.
  expect(query(world, [Position, Solid])).toHaveLength(1);

  // Admin flips id=101 from wall to floor.
  world.catalog.set(101, {
    id: 101,
    type: "floor",
    src_x: 0,
    src_y: 0,
    label: "w",
  });
  reconcileTileSolidity(world);

  expect(query(world, [Position, Solid])).toHaveLength(0);
  // The Tile entity itself still exists, just without Solid.
  expect(query(world, [Position, Tile])).toHaveLength(1);
});

test("reconcileTileSolidity is a no-op when types haven't changed", () => {
  const db = setupDb();
  syncCatalog(db, [
    { id: 102, type: "wall", src_x: 0, src_y: 0, label: "w" },
    { id: 103, type: "floor", src_x: 32, src_y: 0, label: "f" },
  ]);
  db.run("INSERT INTO tiles (x, y, tile_id) VALUES (32, 32, 102)");
  db.run("INSERT INTO tiles (x, y, tile_id) VALUES (96, 32, 103)");
  seedDefaultSettings(db);
  const world = initWorld(db);
  const { Position, Solid, Tile } = world.components;

  // Capture eids; should be the same after reconcile (no entity churn).
  const wallEidBefore = world.tilesAtPosition.get("32,32");
  const floorEidBefore = world.tilesAtPosition.get("96,32");

  reconcileTileSolidity(world);

  expect(world.tilesAtPosition.get("32,32")).toBe(wallEidBefore);
  expect(world.tilesAtPosition.get("96,32")).toBe(floorEidBefore);
  // Wall still solid, floor still not.
  expect(hasComponent(world, wallEidBefore!, Solid)).toBe(true);
  expect(hasComponent(world, floorEidBefore!, Solid)).toBe(false);
  // Both still have Tile.
  expect(query(world, [Position, Tile])).toHaveLength(2);
});

test("zones, zone_cells, zone_members tables exist after migration", () => {
  const db = setupDb();
  const tables = db
    .query("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as { name: string }[];
  const names = tables.map((t) => t.name);
  expect(names).toContain("zones");
  expect(names).toContain("zone_cells");
  expect(names).toContain("zone_members");
});

test("initWorld populates empty zones and cellToZone when DB has no rows", () => {
  const db = setupDb();
  const world = initWorld(db);
  expect(world.zones).toBeInstanceOf(Map);
  expect(world.zones.size).toBe(0);
  expect(world.cellToZone).toBeInstanceOf(Map);
  expect(world.cellToZone.size).toBe(0);
});

test("initWorld loads zone rows into world.zones and world.cellToZone", () => {
  const db = setupDb();
  db.run("INSERT INTO zones (id, name, created_at) VALUES (1, 'kitchen', 0)");
  db.run("INSERT INTO zones (id, name, created_at) VALUES (2, 'bar', 0)");
  db.run(
    "INSERT INTO users (id, fourm_id, username, is_admin, created_at) VALUES ('u1', 'fid-u1', 'u1', 0, 0)",
  );
  db.run("INSERT INTO zone_cells (zone_id, x, y) VALUES (1, 16, 16)");
  db.run("INSERT INTO zone_cells (zone_id, x, y) VALUES (1, 48, 16)");
  db.run("INSERT INTO zone_cells (zone_id, x, y) VALUES (2, 80, 16)");
  db.run(
    "INSERT INTO zone_members (zone_id, user_id, added_at) VALUES (1, 'u1', 0)",
  );

  const world = initWorld(db);

  expect(world.zones.size).toBe(2);
  const kitchen = world.zones.get(1)!;
  expect(kitchen.name).toBe("kitchen");
  expect(kitchen.cells.has("16,16")).toBe(true);
  expect(kitchen.cells.has("48,16")).toBe(true);
  expect(kitchen.members.has("u1")).toBe(true);

  expect(world.cellToZone.get("16,16")).toBe(1);
  expect(world.cellToZone.get("48,16")).toBe(1);
  expect(world.cellToZone.get("80,16")).toBe(2);
});
