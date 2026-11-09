import type { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";
export { migrateDatabase } from "./migrations";
export * from "./schema";

export function database(sqlite: Database) {
  return drizzle(sqlite, { schema });
}
export type AppDatabase = ReturnType<typeof database>;
