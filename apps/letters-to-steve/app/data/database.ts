import path from "node:path";
import { mkdir } from "node:fs/promises";

import {
  createSqliteDatabase,
  type SqliteDatabase,
} from "remix/data-table/sqlite";
import { loadMigrations } from "remix/data-table/migrations/node";

const migrationsDirectory = path.resolve(
  import.meta.dirname,
  "../../db/migrations",
);

export async function createLettersDatabase(
  filename?: string,
): Promise<SqliteDatabase> {
  let resolvedFilename =
    filename ?? process.env.DATABASE_PATH ?? "./db/letters.sqlite";

  if (resolvedFilename !== ":memory:") {
    resolvedFilename = path.resolve(resolvedFilename);
    await mkdir(path.dirname(resolvedFilename), { recursive: true });
  }

  let database = createSqliteDatabase({
    filename: resolvedFilename,
    foreignKeys: true,
  });

  let migrations = await loadMigrations(migrationsDirectory);
  await database.migrate(migrations);

  return database;
}
