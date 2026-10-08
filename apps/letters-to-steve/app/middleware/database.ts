import { createContextKey, type Middleware } from "remix/router";
import type { SqliteDatabase } from "remix/data-table/sqlite";

export const databaseContext = createContextKey<SqliteDatabase>();

export function loadDatabase(
  database: SqliteDatabase,
): Middleware<{ key: typeof databaseContext; value: SqliteDatabase }> {
  return async (context, next) => {
    context.set(databaseContext, database);
    return next();
  };
}
