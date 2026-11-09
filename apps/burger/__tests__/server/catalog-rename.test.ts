import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../server/db";
import { renameCatalogId } from "../../server/catalog-rename";

const setupDb = (): Database => {
  const db = new Database(":memory:");
  runMigrations(db);
  // seed catalog
  db.run(
    "INSERT INTO tile_catalog (id, type, src_x, src_y, label) VALUES (1, 'floor', 0, 0, 'floor')",
  );
  db.run(
    "INSERT INTO tile_catalog (id, type, src_x, src_y, label) VALUES (2, 'wall', 32, 0, 'wall')",
  );
  // seed user (for tile_edits FK)
  db.run(
    "INSERT INTO users (id, fourm_id, username, is_admin, created_at) VALUES ('u1', 'fid', 'u', 0, 0)",
  );
  // seed tiles + edits referencing id=1
  db.run("INSERT INTO tiles (x, y, tile_id) VALUES (16, 16, 1)");
  db.run("INSERT INTO tiles (x, y, tile_id) VALUES (48, 16, 1)");
  db.run(
    "INSERT INTO tile_edits (x, y, old_tile_id, new_tile_id, user_id, edited_at) VALUES (16, 16, NULL, 1, 'u1', 0)",
  );
  db.run(
    "INSERT INTO tile_edits (x, y, old_tile_id, new_tile_id, user_id, edited_at) VALUES (48, 16, 1, 2, 'u1', 0)",
  );
  return db;
};

test("renameCatalogId moves catalog row and cascades to tiles + tile_edits", () => {
  const db = setupDb();
  const result = renameCatalogId(db, { from: 1, to: 99 });
  expect(result.ok).toBe(true);

  const cat = db.query("SELECT id FROM tile_catalog ORDER BY id").all();
  expect(cat).toEqual([{ id: 2 }, { id: 99 }]);

  const tiles = db.query("SELECT tile_id FROM tiles ORDER BY x").all();
  expect(tiles).toEqual([{ tile_id: 99 }, { tile_id: 99 }]);

  const edits = db
    .query("SELECT old_tile_id, new_tile_id FROM tile_edits ORDER BY x")
    .all();
  expect(edits).toEqual([
    { old_tile_id: null, new_tile_id: 99 },
    { old_tile_id: 99, new_tile_id: 2 },
  ]);
});

test("renameCatalogId rejects rename to an id that already exists", () => {
  const db = setupDb();
  const result = renameCatalogId(db, { from: 1, to: 2 });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors[0]?.field).toContain("to");
  // nothing changed
  const cat = db.query("SELECT id FROM tile_catalog ORDER BY id").all();
  expect(cat).toEqual([{ id: 1 }, { id: 2 }]);
});

test("renameCatalogId rejects when source id doesn't exist", () => {
  const db = setupDb();
  const result = renameCatalogId(db, { from: 999, to: 100 });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors[0]?.field).toContain("from");
});

test("renameCatalogId rejects identical from and to", () => {
  const db = setupDb();
  const result = renameCatalogId(db, { from: 1, to: 1 });
  expect(result.ok).toBe(false);
});
