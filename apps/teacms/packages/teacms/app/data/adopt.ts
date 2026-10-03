import { DatabaseSync, backup } from "node:sqlite";
import { mkdtemp, mkdir, cp, rm, lstat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "./database.ts";
import { safeUploadPath } from "./upload-path.ts";
import { transaction } from "./transaction.ts";

const tables = [
  "users",
  "media",
  "site",
  "site_preferences",
  "sidebar",
  "homepage",
  "pages",
  "adornments",
  "content_history",
  "page_drafts",
  "media_folders",
  "media_details",
];
const skippedTables = new Set([
  "sessions",
  "sqlite_sequence",
  "data_table_migrations",
]);
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';

function copyContent(source: DatabaseSync, target: DatabaseSync) {
  const sourceTables = new Set(
    source
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => String(row.name)),
  );
  for (const table of sourceTables) {
    if (!tables.includes(table) && !skippedTables.has(table))
      throw new Error(
        `Unrecognized table: ${table}. Review its migration before adopting.`,
      );
  }
  for (const table of tables) {
    if (table !== "adornments" && !sourceTables.has(table))
      throw new Error(`Missing TeaCMS table: ${table}`);
  }
  return transaction(target, () => {
    target.exec("PRAGMA defer_foreign_keys=ON");
    const counts: Record<string, number> = {};
    for (const table of tables) {
      if (!sourceTables.has(table)) continue;
      const columns = source
        .prepare(`PRAGMA table_info(${quote(table)})`)
        .all()
        .map((row) => String(row.name));
      const targetColumns = new Set(
        target
          .prepare(`PRAGMA table_info(${quote(table)})`)
          .all()
          .map((row) => String(row.name)),
      );
      if (columns.some((column) => !targetColumns.has(column)))
        throw new Error(
          `Unrecognized columns in ${table}; refusing a lossy copy.`,
        );
      target.exec(`DELETE FROM ${quote(table)}`);
      const insert = target.prepare(
        `INSERT INTO ${quote(table)} (${columns.map(quote).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
      );
      const rows = source.prepare(`SELECT * FROM ${quote(table)}`).all();
      for (const row of rows)
        insert.run(...columns.map((column) => row[column]));
      counts[table] = rows.length;
    }
    if (target.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("Source has broken database references.");
    return counts;
  });
}

async function rebuildDatabase(
  snapshot: string,
  destination: string,
  uploads: string,
) {
  const source = new DatabaseSync(snapshot, { readOnly: true });
  try {
    const { sqlite: target } = await openDatabase(destination);
    try {
      const counts = copyContent(source, target);
      if (
        target.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok"
      )
        throw new Error("Adopted database failed integrity check.");
      for (const row of target.prepare("SELECT path FROM media").all()) {
        const path = safeUploadPath(uploads, String(row.path));
        if (!path || !(await lstat(path)).isFile())
          throw new Error(`Missing or unsafe media file: ${row.path}`);
      }
      target.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      return counts;
    } finally {
      target.close();
    }
  } finally {
    source.close();
  }
}

export async function adoptSite(sourceDir: string, targetDir: string) {
  const source = resolve(sourceDir),
    target = resolve(targetDir);
  if (
    source === target ||
    target.startsWith(source + sep) ||
    source.startsWith(target + sep)
  )
    throw new Error("Source and destination must be independent directories.");
  if (existsSync(target))
    throw new Error(
      "Destination already exists; adoption never overwrites data.",
    );
  if (!existsSync(join(source, "tea.db")))
    throw new Error("Source must contain a TeaCMS tea.db backup.");
  const scratch = await mkdtemp(join(tmpdir(), "teacms-adopt-"));
  try {
    const original = new DatabaseSync(join(source, "tea.db"), {
      readOnly: true,
    });
    try {
      await backup(original, join(scratch, "source.db"));
    } finally {
      original.close();
    }
    const counts = await rebuildDatabase(
      join(scratch, "source.db"),
      join(scratch, "tea.db"),
      join(source, "uploads"),
    );
    await mkdir(dirname(target), { recursive: true });
    await mkdir(target);
    try {
      await cp(join(scratch, "tea.db"), join(target, "tea.db"), {
        errorOnExist: true,
        force: false,
      });
      if (existsSync(join(source, "uploads")))
        await cp(join(source, "uploads"), join(target, "uploads"), {
          recursive: true,
          errorOnExist: true,
          force: false,
        });
      return counts;
    } catch (error) {
      await rm(target, { recursive: true, force: true });
      throw error;
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
