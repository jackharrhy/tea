/**
 * Migration: Fix file kinds for model formats
 *
 * Updates files with model extensions (md5mesh, md5anim, ase, lwo, etc.)
 * that were incorrectly marked as "other" to be "model"
 */

import Database from "better-sqlite3";
import { join } from "path";

const dbPath = join(process.cwd(), "artbin.db");
const db = new Database(dbPath);

// Model extensions that should have kind = "model"
const MODEL_EXTENSIONS = [
  "gltf",
  "glb",
  "obj",
  "fbx",
  "md2",
  "md3",
  "mdl",
  "md5mesh",
  "md5anim",
  "ase",
  "lwo",
  "iqm",
  "blend",
];

console.log("Fixing file kinds for model formats...\n");

// Build the SQL pattern for matching extensions

// First, show what will be updated
const countQuery = db.prepare(`
  SELECT
    LOWER(SUBSTR(name, INSTR(name, '.') + 1)) as ext,
    kind,
    COUNT(*) as count
  FROM files
  WHERE kind != 'model'
    AND (${MODEL_EXTENSIONS.map((ext) => `name LIKE '%.${ext}'`).join(" OR ")})
  GROUP BY ext, kind
  ORDER BY count DESC
`);

const toFix = countQuery.all() as {
  ext: string;
  kind: string;
  count: number;
}[];

if (toFix.length === 0) {
  console.log(
    "No files need fixing. All model files already have correct kind.",
  );
  process.exit(0);
}

console.log("Files to update:");
for (const row of toFix) {
  console.log(`  .${row.ext}: ${row.count} files (currently: ${row.kind})`);
}

const totalCount = toFix.reduce((sum, row) => sum + row.count, 0);
console.log(`\nTotal: ${totalCount} files\n`);

// Update the files
const updateStmt = db.prepare(`
  UPDATE files
  SET kind = 'model'
  WHERE kind != 'model'
    AND (${MODEL_EXTENSIONS.map((ext) => `name LIKE '%.${ext}'`).join(" OR ")})
`);

const result = updateStmt.run();
console.log(`Updated ${result.changes} files to kind = 'model'`);

// Verify the fix
const verifyQuery = db.prepare(`
  SELECT kind, COUNT(*) as count
  FROM files
  WHERE ${MODEL_EXTENSIONS.map((ext) => `name LIKE '%.${ext}'`).join(" OR ")}
  GROUP BY kind
`);

const verification = verifyQuery.all() as { kind: string; count: number }[];
console.log("\nVerification - Model files by kind:");
for (const row of verification) {
  console.log(`  ${row.kind}: ${row.count}`);
}

db.close();
console.log("\nDone!");
