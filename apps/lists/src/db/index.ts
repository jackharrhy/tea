import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Database } from "bun:sqlite";
import * as schema from "./schema";
import { seedBuiltInTemplates } from "../services/email-templates";

export function createDb(dbPath: string) {
  const sqlite = new Database(dbPath, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  seedBuiltInTemplates(db);
  return db;
}

export type Db = ReturnType<typeof createDb>;
export function closeDb(db: Db) {
  db.$client.close();
}
export { schema };
