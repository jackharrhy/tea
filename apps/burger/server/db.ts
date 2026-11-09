import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const runMigrations = (db: Database): void => {
  db.run("PRAGMA journal_mode = WAL");

  db.run("PRAGMA foreign_keys = ON");

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      fourm_id TEXT UNIQUE,
      auth_subject TEXT UNIQUE,
      username TEXT NOT NULL,
      display_name TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      expires_at INTEGER NOT NULL
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS tile_catalog (
      id INTEGER PRIMARY KEY,
      type TEXT NOT NULL,
      src_x INTEGER NOT NULL,
      src_y INTEGER NOT NULL,
      label TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tiles (
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      tile_id INTEGER NOT NULL REFERENCES tile_catalog(id),
      PRIMARY KEY (x, y)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tile_edits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      old_tile_id INTEGER,
      new_tile_id INTEGER,
      user_id TEXT REFERENCES users(id),
      edited_at INTEGER NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS tile_edits_pos ON tile_edits(x, y)`);
  db.run(`CREATE INDEX IF NOT EXISTS tile_edits_time ON tile_edits(edited_at)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS palettes (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      tile_ids TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS zones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS zone_cells (
      zone_id INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      PRIMARY KEY (zone_id, x, y)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS zone_cells_xy ON zone_cells(x, y)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS zone_members (
      zone_id INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (zone_id, user_id)
    )
  `);
  db.run(
    `CREATE INDEX IF NOT EXISTS zone_members_user ON zone_members(user_id)`,
  );
};

export const openDatabase = (path?: string): Database => {
  const dbPath = path ?? process.env.DB_PATH ?? "./data/burger.db";

  if (dbPath !== ":memory:") {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);
  runMigrations(db);
  return db;
};

export type { Database };
