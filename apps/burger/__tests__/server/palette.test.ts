import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../../server/db";
import {
  getPalette,
  setPalette,
  validatePaletteIds,
} from "../../server/palette";

const setupDb = (): Database => {
  const db = new Database(":memory:");
  runMigrations(db);
  db.run(
    "INSERT INTO users (id, fourm_id, username, is_admin, created_at) VALUES ('u1', 'fid', 'u', 1, 0)",
  );
  // Catalog rows so palette ids resolve.
  db.run(
    "INSERT INTO tile_catalog (id, type, src_x, src_y, label) VALUES (1, 'floor', 0, 0, 'a')",
  );
  db.run(
    "INSERT INTO tile_catalog (id, type, src_x, src_y, label) VALUES (2, 'wall', 32, 0, 'b')",
  );
  return db;
};

test("getPalette returns empty array when no row exists", () => {
  const db = setupDb();
  expect(getPalette(db, "u1")).toEqual([]);
});

test("setPalette persists ids and getPalette reads them", () => {
  const db = setupDb();
  setPalette(db, "u1", [1, 2]);
  expect(getPalette(db, "u1")).toEqual([1, 2]);
});

test("setPalette overwrites existing palette", () => {
  const db = setupDb();
  setPalette(db, "u1", [1, 2]);
  setPalette(db, "u1", [2]);
  expect(getPalette(db, "u1")).toEqual([2]);
});

test("validatePaletteIds rejects non-array", () => {
  const r = validatePaletteIds("nope");
  expect(r.ok).toBe(false);
});

test("validatePaletteIds rejects non-integer entries", () => {
  const r = validatePaletteIds([1, "two", 3]);
  expect(r.ok).toBe(false);
});

test("validatePaletteIds rejects more than 9 entries", () => {
  const r = validatePaletteIds([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  expect(r.ok).toBe(false);
});

test("validatePaletteIds rejects duplicate entries", () => {
  const r = validatePaletteIds([1, 2, 1]);
  expect(r.ok).toBe(false);
});

test("validatePaletteIds accepts empty array", () => {
  const r = validatePaletteIds([]);
  expect(r.ok).toBe(true);
});

test("validatePaletteIds accepts up to 9 unique integers", () => {
  const r = validatePaletteIds([1, 2, 3]);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.ids).toEqual([1, 2, 3]);
});
