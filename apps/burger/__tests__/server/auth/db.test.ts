import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../../server/db";

test("runMigrations creates the current schema and is idempotent", () => {
  const db = new Database(":memory:");
  runMigrations(db);
  runMigrations(db);
  const tables = db
    .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all();
  const names = tables.map((t: any) => t.name);
  expect(names).toEqual(
    expect.arrayContaining([
      "users",
      "sessions",
      "tile_catalog",
      "tiles",
      "tile_edits",
      "settings",
    ]),
  );
});

test("runMigrations enables foreign keys", () => {
  const db = new Database(":memory:");
  runMigrations(db);
  const row = db.query("PRAGMA foreign_keys").get() as { foreign_keys: number };
  expect(row.foreign_keys).toBe(1);
});
