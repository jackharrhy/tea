import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../server/db";
import { saveCatalog, serializeCatalog } from "../../server/catalog-save";
import type { CatalogEntry } from "../../server/catalog-validation";

const setupDb = (): Database => {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
};

const seedCatalog = (db: Database, entries: CatalogEntry[]) => {
  for (const e of entries) {
    db.run(
      "INSERT INTO tile_catalog (id, type, src_x, src_y, label) VALUES (?, ?, ?, ?, ?)",
      [e.id, e.type, e.src_x, e.src_y, e.label],
    );
  }
};

test("serializeCatalog produces TOML in id order with header", () => {
  const text = serializeCatalog([
    { id: 2, type: "floor", src_x: 32, src_y: 0, label: "floor" },
    { id: 1, type: "wall", src_x: 0, src_y: 0, label: "wall" },
  ]);
  expect(text).toContain("# Tile catalog.");
  // id=1 must come before id=2
  const idx1 = text.indexOf("id = 1");
  const idx2 = text.indexOf("id = 2");
  expect(idx1).toBeGreaterThan(0);
  expect(idx2).toBeGreaterThan(idx1);
});

test("serializeCatalog escapes double quotes in labels", () => {
  const text = serializeCatalog([
    { id: 1, type: "wall", src_x: 0, src_y: 0, label: 'wall "stone"' },
  ]);
  expect(text).toContain('label = "wall \\"stone\\""');
});

test("serializeCatalog includes [meta] block when meta provided", () => {
  const text = serializeCatalog(
    [{ id: 1, type: "wall", src_x: 0, src_y: 0, label: "wall" }],
    { width: 256, height: 384 },
  );
  expect(text).toContain("[meta]");
  expect(text).toContain("width = 256");
  expect(text).toContain("height = 384");
  // Meta block precedes the first tile block.
  expect(text.indexOf("[meta]")).toBeLessThan(text.indexOf("[[tiles]]"));
});

test("serializeCatalog omits [meta] block when meta absent", () => {
  const text = serializeCatalog([
    { id: 1, type: "wall", src_x: 0, src_y: 0, label: "wall" },
  ]);
  expect(text).not.toContain("[meta]");
});

test("saveCatalog syncs tile_catalog rows and broadcasts", async () => {
  const db = setupDb();
  let broadcasted: CatalogEntry[] | null = null;

  const result = await saveCatalog({
    db,
    entries: [
      { id: 1, type: "floor", src_x: 0, src_y: 0, label: "floor" },
      { id: 2, type: "wall", src_x: 32, src_y: 0, label: "wall" },
    ],
    broadcast: (c) => {
      broadcasted = c;
    },
  });

  expect(result.ok).toBe(true);
  const rows = db
    .query("SELECT id, type, src_x, src_y, label FROM tile_catalog ORDER BY id")
    .all();
  expect(rows).toHaveLength(2);
  expect(broadcasted).not.toBeNull();
  expect(broadcasted).toHaveLength(2);
});

test("saveCatalog removes deleted catalog rows when no tiles reference them", async () => {
  const db = setupDb();
  seedCatalog(db, [
    { id: 1, type: "floor", src_x: 0, src_y: 0, label: "floor" },
    { id: 2, type: "wall", src_x: 32, src_y: 0, label: "wall" },
  ]);

  const result = await saveCatalog({
    db,
    entries: [{ id: 1, type: "floor", src_x: 0, src_y: 0, label: "floor" }],
    broadcast: () => {},
  });

  expect(result.ok).toBe(true);
  const rows = db.query("SELECT id FROM tile_catalog ORDER BY id").all();
  expect(rows).toEqual([{ id: 1 }]);
});

test("saveCatalog rejects deletion of an id with active tiles", async () => {
  const db = setupDb();
  seedCatalog(db, [
    { id: 1, type: "floor", src_x: 0, src_y: 0, label: "floor" },
    { id: 2, type: "wall", src_x: 32, src_y: 0, label: "wall" },
  ]);
  // place a tile referencing id=2
  db.run("INSERT INTO tiles (x, y, tile_id) VALUES (16, 16, 2)");
  let broadcasted = false;

  const result = await saveCatalog({
    db,
    entries: [{ id: 1, type: "floor", src_x: 0, src_y: 0, label: "floor" }],
    broadcast: () => {
      broadcasted = true;
    },
  });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors[0]?.field).toContain("2"); // mentions the offending id
  }
  // not broadcast on failure
  expect(broadcasted).toBe(false);
});
