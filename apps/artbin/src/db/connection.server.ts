import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.ts";

export function createDb(sqlite: Database.Database) {
  return drizzle(sqlite, { schema });
}

export type AppDb = ReturnType<typeof createDb>;

const dbPath = process.env.ARTBIN_DB_PATH ?? "data/artbin.db";
mkdirSync(dirname(dbPath), { recursive: true });
const sqlite = new Database(dbPath);
export let db: AppDb = createDb(sqlite);

// Auto-run migrations on startup (drizzle/ is relative to cwd)
// Tests use in-memory databases and apply migrations manually
if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  migrate(db, { migrationsFolder: "./drizzle" });
}

export function setDbForTesting(nextDb: AppDb): void {
  if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
    throw new Error("setDbForTesting can only be used in tests");
  }

  db = nextDb;
}
