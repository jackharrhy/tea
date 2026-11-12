import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, realpath } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { coreTables } from "../app/data/schema.ts";

function sourceStats(paths) {
  const metadata = spawnSync(
    process.env.FOURM_MIGRATION_PYTHON ?? "python3",
    ["-B", fileURLToPath(new URL("./parity/media_stat.py", import.meta.url))],
    {
      input: JSON.stringify(paths),
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30000,
    },
  );
  if (metadata.status !== 0)
    throw new Error("Source file metadata inspection failed");
  return JSON.parse(metadata.stdout);
}
export const tableNames = coreTables;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function exportSource({ database, uploads, output }) {
  process.umask(0o077);
  const directory = resolve(output);
  await mkdir(directory, { mode: 0o700 });
  await mkdir(join(directory, "objects"), { mode: 0o700 });
  const root = await realpath(uploads);
  const sqlite = new DatabaseSync(resolve(database), { readOnly: true });
  const tables = {};
  try {
    sqlite.exec("BEGIN");
    if (
      sqlite.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" ||
      sqlite.prepare("PRAGMA foreign_key_check").all().length
    )
      throw new Error("Source SQLite integrity or ownership check failed");
    for (const table of tableNames) {
      tables[table] = sqlite.prepare(`SELECT * FROM "${table}"`).all();
      if (table === "users")
        for (const user of tables[table]) user.password_hash = "";
    }
    sqlite.exec("COMMIT");
  } finally {
    sqlite.close();
  }
  const objects = [],
    paths = [];
  for (const media of tables.media) {
    const name = media.storage_path;
    if (
      typeof name !== "string" ||
      name.startsWith("/") ||
      name.split(/[\\/]/).some((part) => !part || part === "." || part === "..")
    )
      throw new Error("Unsafe source media path");
    const path = await realpath(resolve(root, name));
    if (!path.startsWith(root + sep))
      throw new Error("Source media escapes its upload directory");
    paths.push(path);
  }
  const stats = sourceStats(paths);
  for (const [index, media] of tables.media.entries()) {
    const name = media.storage_path,
      source = paths[index];
    const bytes = await readFile(source);
    if (
      bytes.length !== media.size_bytes ||
      stats[index].size_bytes !== bytes.length
    )
      throw new Error("Source media size differs from metadata");
    const sha256 = digest(bytes),
      file = `objects/${sha256}`;
    await writeFile(join(directory, file), bytes, { mode: 0o600 });
    objects.push({
      storage_path: name,
      sha256,
      size_bytes: bytes.length,
      mime_type: media.mime_type,
      ...stats[index],
      file,
    });
  }
  if (JSON.stringify(sourceStats(paths)) !== JSON.stringify(stats))
    throw new Error(
      "Source file metadata changed during export; retry a consistent copy",
    );
  const archive = { version: 1, tables, objects };
  await writeFile(join(directory, "archive.json"), JSON.stringify(archive), {
    mode: 0o600,
    flag: "wx",
  });
  return {
    members: tables.users.length,
    pages: tables.pages.length,
    media: objects.length,
    tables: tableNames.length,
    legacyCredentialsIncluded: false,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [database, uploads, output] = process.argv.slice(2);
  if (!database || !uploads || !output)
    throw new Error(
      "Usage: node scripts/export-source.mjs OFFLINE_SQLITE_COPY UPLOAD_DIRECTORY NEW_ARCHIVE_DIRECTORY",
    );
  console.log(
    JSON.stringify(await exportSource({ database, uploads, output })),
  );
}
