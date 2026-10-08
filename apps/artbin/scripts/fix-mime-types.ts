/**
 * Fix MIME types for existing files that were incorrectly marked as application/octet-stream
 *
 * Run with: node --import remix/node-tsx scripts/fix-mime-types.ts
 */

import Database from "better-sqlite3";
import { join } from "path";
import { readFile } from "fs/promises";
import { existsSync } from "fs";

const dbPath = join(process.cwd(), "artbin.db");
const uploadsPath = join(process.cwd(), "public", "uploads");
const db = new Database(dbPath);

// Custom MIME mappings for game formats
const CUSTOM_MIME_TYPES: Record<string, string> = {
  // Text/config files
  cfg: "text/plain",
  def: "text/plain",
  mtr: "text/plain",
  script: "text/plain",
  gui: "text/plain",
  skin: "text/plain",
  sndshd: "text/plain",
  af: "text/plain",
  pda: "text/plain",
  lang: "text/plain",
  dict: "text/plain",
  fx: "text/plain",
  particle: "text/plain",
  vfp: "text/plain",
  vp: "text/plain",
  fp: "text/plain",
  glsl: "text/plain",
  vert: "text/x-glsl",
  frag: "text/x-glsl",
  map: "text/plain",
  vmf: "text/plain",

  // Models
  md5mesh: "model/x-md5mesh",
  md5anim: "model/x-md5anim",
  ase: "model/x-ase",
  iqm: "model/x-iqm",
  lwo: "model/x-lwo",

  // Compiled formats
  proc: "application/x-proc",
  cm: "application/x-cm",
  aas24: "application/x-aas",
  aas32: "application/x-aas",
  aas48: "application/x-aas",
  aas32_flybot: "application/x-aas",
  aas_cat: "application/x-aas",
  aas_mech: "application/x-aas",
  rmf: "application/x-rmf",
  roq: "video/x-roq",
  dat: "application/x-dat",
  mtl: "text/plain",
};

function looksLikeText(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;

  const sampleSize = Math.min(buffer.length, 8192);
  const sample = buffer.subarray(0, sampleSize);

  let nullCount = 0;
  let controlCount = 0;
  let printableCount = 0;

  for (let i = 0; i < sample.length; i++) {
    const byte = sample[i];

    if (byte === 0) {
      nullCount++;
      if (nullCount > 2) return false;
    } else if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      controlCount++;
    } else if ((byte >= 32 && byte < 127) || byte >= 128) {
      printableCount++;
    }
  }

  if (controlCount > sampleSize * 0.05) return false;
  if (printableCount < sampleSize * 0.7) return false;

  return true;
}

async function fixMimeTypes() {
  console.log("Finding files with application/octet-stream MIME type...\n");

  const files = db
    .prepare(`
    SELECT id, path, name, mime_type
    FROM files
    WHERE mime_type = 'application/octet-stream'
  `)
    .all() as { id: string; path: string; name: string; mime_type: string }[];

  console.log(`Found ${files.length} files to check\n`);

  const updateStmt = db.prepare(`UPDATE files SET mime_type = ? WHERE id = ?`);

  let fixed = 0;
  let stillBinary = 0;
  let errors = 0;
  const mimeChanges: Record<string, number> = {};

  for (const file of files) {
    try {
      // Get extension
      const ext = file.name.split(".").pop()?.toLowerCase() || "";

      // Check custom mappings first
      if (CUSTOM_MIME_TYPES[ext]) {
        const newMime = CUSTOM_MIME_TYPES[ext];
        updateStmt.run(newMime, file.id);
        mimeChanges[newMime] = (mimeChanges[newMime] || 0) + 1;
        fixed++;
        continue;
      }

      // Try to read file and detect if it's text
      const fullPath = join(uploadsPath, file.path);
      if (!existsSync(fullPath)) {
        errors++;
        continue;
      }

      const buffer = await readFile(fullPath);
      if (looksLikeText(buffer)) {
        updateStmt.run("text/plain", file.id);
        mimeChanges["text/plain"] = (mimeChanges["text/plain"] || 0) + 1;
        fixed++;
      } else {
        stillBinary++;
      }
    } catch {
      errors++;
    }
  }

  console.log("Results:");
  console.log(`  Fixed: ${fixed}`);
  console.log(`  Still binary: ${stillBinary}`);
  console.log(`  Errors: ${errors}`);
  console.log("\nMIME type changes:");
  for (const [mime, count] of Object.entries(mimeChanges).toSorted(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  ${mime}: ${count}`);
  }

  // Verify
  const remaining = db
    .prepare(`
    SELECT COUNT(*) as count FROM files WHERE mime_type = 'application/octet-stream'
  `)
    .get() as { count: number };

  console.log(`\nRemaining octet-stream files: ${remaining.count}`);
}

fixMimeTypes()
  .then(() => {
    db.close();
    console.log("\nDone!");
  })
  .catch((err) => {
    console.error("Error:", err);
    db.close();
    process.exit(1);
  });
