/**
 * Migration script to add fileCount column and populate it
 *
 * Run with: node --import remix/node-tsx scripts/add-file-counts.ts
 */

import Database from "better-sqlite3";
import { join } from "path";

const dbPath = join(process.cwd(), "artbin.db");
const db = new Database(dbPath);

console.log("Adding fileCount column to folders table...");

// Add the column if it doesn't exist
try {
  db.exec(`ALTER TABLE folders ADD COLUMN file_count INTEGER DEFAULT 0`);
  console.log("Column added.");
} catch (e: any) {
  if (e.message.includes("duplicate column")) {
    console.log("Column already exists, skipping.");
  } else {
    throw e;
  }
}

// Add indexes for better query performance
console.log("\nAdding indexes...");

const indexes = [
  // Core relationships
  ["idx_files_folder_id", "files(folder_id)"],
  ["idx_folders_parent_id", "folders(parent_id)"],

  // File queries by kind (for browse tabs)
  ["idx_files_kind", "files(kind)"],

  // File queries ordered by date (common sort)
  ["idx_files_created_at", "files(created_at DESC)"],

  // Combined index for paginated file queries by kind
  ["idx_files_kind_created", "files(kind, created_at DESC)"],

  // Jobs by status (for job runner polling)
  ["idx_jobs_status", "jobs(status)"],
];

for (const [name, def] of indexes) {
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${def}`);
    console.log(`Added index: ${name}`);
  } catch {
    console.log(`Index ${name} already exists or failed`);
  }
}

// Populate counts for all folders
console.log("\nPopulating file counts...");

const updateStmt = db.prepare(`
  UPDATE folders
  SET file_count = (
    SELECT COUNT(*) FROM files WHERE files.folder_id = folders.id
  )
`);

const result = updateStmt.run();
console.log(`Updated ${result.changes} folders with file counts.`);

// Verify
const stats = db
  .prepare(`
  SELECT
    COUNT(*) as total_folders,
    SUM(file_count) as total_files_counted,
    (SELECT COUNT(*) FROM files) as actual_files
  FROM folders
`)
  .get() as {
  total_folders: number;
  total_files_counted: number;
  actual_files: number;
};

console.log("\nVerification:");
console.log(`  Total folders: ${stats.total_folders}`);
console.log(`  Sum of file_count: ${stats.total_files_counted}`);
console.log(`  Actual files in DB: ${stats.actual_files}`);

if (stats.total_files_counted === stats.actual_files) {
  console.log("\n✓ Counts match!");
} else {
  console.log("\n⚠ Count mismatch - some files may not be in folders");
}

db.close();
console.log("\nDone!");
