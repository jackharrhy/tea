import { Database } from "bun:sqlite";
import { chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { createTeaExport, teaExportCounts } from "../src/migration/tea-export";

const [databaseArgument, outputArgument] = Bun.argv.slice(2);
if (!databaseArgument || !outputArgument) {
  throw new Error("Usage: bun run export:tea -- <lists.db> <output.json>");
}

const databasePath = resolve(databaseArgument);
const outputPath = resolve(outputArgument);
if (databasePath === outputPath)
  throw new Error("Database and export paths must differ");

const sqlite = new Database(databasePath, { readonly: true });
try {
  const bundle = createTeaExport(sqlite);
  await Bun.write(outputPath, `${JSON.stringify(bundle, null, 2)}\n`);
  await chmod(outputPath, 0o600);
  console.log(JSON.stringify({ outputPath, counts: teaExportCounts(bundle) }));
} finally {
  sqlite.close();
}
