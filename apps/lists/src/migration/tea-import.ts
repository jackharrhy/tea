import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import {
  domainTables,
  TEA_EXPORT_FORMAT,
  TEA_EXPORT_VERSION,
  type TeaExportBundle,
} from "./tea-export.ts";

export type UserSubjectMapping = {
  users: Array<{ id: number; subject: string }>;
};

function assertBundle(value: unknown): asserts value is TeaExportBundle {
  if (!value || typeof value !== "object")
    throw new Error("Invalid Lists export bundle");
  const bundle = value as Partial<TeaExportBundle>;
  if (
    bundle.format !== TEA_EXPORT_FORMAT ||
    bundle.version !== TEA_EXPORT_VERSION
  ) {
    throw new Error("Unsupported Lists export format");
  }
  for (const table of domainTables) {
    if (!Array.isArray(bundle.tables?.[table]))
      throw new Error(`Missing export table: ${table}`);
  }
}

function readSubjects(mapping: UserSubjectMapping, userIds: number[]) {
  if (!Array.isArray(mapping?.users))
    throw new Error("User subject mapping is required");
  const subjects = new Map<number, string>();
  for (const entry of mapping.users) {
    if (
      !Number.isSafeInteger(entry.id) ||
      typeof entry.subject !== "string" ||
      !entry.subject.trim()
    ) {
      throw new Error("Invalid user subject mapping");
    }
    if (subjects.has(entry.id)) throw new Error("Duplicate mapped user ID");
    subjects.set(entry.id, entry.subject);
  }
  if (
    subjects.size !== userIds.length ||
    new Set(subjects.values()).size !== subjects.size
  ) {
    throw new Error("User subject mapping must be one-to-one and complete");
  }
  for (const id of userIds)
    if (!subjects.has(id)) throw new Error("Missing mapped user ID");
  return subjects;
}

function sqlValue(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error("Export contains a non-scalar SQLite value");
}

export function importTeaBundle(
  sqlite: Database,
  rawBundle: unknown,
  mapping: UserSubjectMapping,
) {
  assertBundle(rawBundle);
  const bundle = rawBundle;
  const userIds = bundle.tables.users.map((row) => {
    if (!Number.isSafeInteger(row.id))
      throw new Error("Invalid exported user ID");
    return row.id as number;
  });
  if (new Set(userIds).size !== userIds.length)
    throw new Error("Duplicate exported user ID");
  const subjects = readSubjects(mapping, userIds);

  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    for (const table of domainTables) {
      const count = sqlite
        .query(`SELECT count(*) AS count FROM ${table}`)
        .get() as { count: number };
      if (count.count !== 0)
        throw new Error(`Destination table is not empty: ${table}`);
    }

    for (const table of domainTables) {
      const columns = new Set(
        (
          sqlite.query(`PRAGMA table_info(${table})`).all() as Array<{
            name: string;
          }>
        ).map((column) => column.name),
      );
      for (const sourceRow of bundle.tables[table]) {
        if (
          !sourceRow ||
          typeof sourceRow !== "object" ||
          Array.isArray(sourceRow)
        ) {
          throw new Error(`Invalid row in ${table}`);
        }
        const row =
          table === "users"
            ? {
                ...sourceRow,
                auth_subject: subjects.get(sourceRow.id as number),
                password_hash: "disabled:tea-migration",
              }
            : sourceRow;
        const names = Object.keys(row);
        if (names.length === 0 || names.some((name) => !columns.has(name))) {
          throw new Error(`Unexpected column in ${table}`);
        }
        const placeholders = names.map(() => "?").join(", ");
        const statement = sqlite.query(
          `INSERT INTO ${table} (${names.map((name) => `"${name}"`).join(", ")}) VALUES (${placeholders})`,
        );
        statement.run(...names.map((name) => sqlValue(row[name] ?? null)));
      }
    }

    const foreignKeys = sqlite.query("PRAGMA foreign_key_check").all();
    if (foreignKeys.length > 0)
      throw new Error(
        `Imported database has ${foreignKeys.length} foreign-key errors`,
      );
    const integrity = sqlite.query("PRAGMA integrity_check").get() as {
      integrity_check: string;
    };
    if (integrity.integrity_check !== "ok")
      throw new Error("Imported database failed SQLite integrity check");
    sqlite.exec("COMMIT");
    return Object.fromEntries(
      domainTables.map((table) => [table, bundle.tables[table].length]),
    );
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }
}

export function createEmptyTeaDatabase(path: string) {
  const sqlite = new Database(path, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA busy_timeout = 5000");
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  return sqlite;
}
