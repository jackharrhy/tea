import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createSqliteDatabase } from "remix/data-table/sqlite";
import { loadMigrations } from "remix/data-table/migrations/node";

export async function openDatabase(
  path = resolve(process.env.TEA_DATA_DIR ?? "data", "tea.db"),
) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new DatabaseSync(path);
  try {
    sqlite.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    );
    const db = createSqliteDatabase(sqlite);
    await db.migrate(
      await loadMigrations(
        fileURLToPath(new URL("../../db/migrations", import.meta.url)),
      ),
    );
    return { db, sqlite };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

export type TeaDatabase = Awaited<ReturnType<typeof openDatabase>>;
