import { backup, DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  lstat,
  readFile,
  realpath,
  rename,
  open,
  statfs,
} from "node:fs/promises";
import { resolve, join, relative, dirname } from "node:path";

export interface Dataset {
  origin?: string;
  id: string;
  database: string;
  trees: string[];
}
export interface Manifest {
  version: 1;
  kind: "teacms-backup";
  createdAt: string;
  revision: string;
  consistency: "independent-sqlite-snapshots-retained-media";
  datasets: Dataset[];
  files: { path: string; size: number; sha256: string }[];
}
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
function safeRelative(path: string) {
  if (
    !path ||
    path.includes(String.fromCharCode(92)) ||
    path.split("/").some((p) => !p || p === "." || p === "..") ||
    path.startsWith("/")
  )
    throw new Error("Invalid backup relative path");
  return path;
}
export async function atomicJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value, null, 2));
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
  const directory = await open(dirname(path), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
async function inventory(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(path: string) {
    const info = await lstat(path);
    if (info.isSymbolicLink())
      throw new Error("Symlinks are not permitted in backup datasets");
    if (info.isDirectory())
      for (const entry of await readdir(path)) await walk(join(path, entry));
    else if (info.isFile()) files.push(relative(root, path));
    else throw new Error("Unsupported backup file type");
  }
  await walk(root);
  return files.toSorted();
}
export async function reserveSpace(
  root: string,
  reserve: number,
  required = 0,
) {
  const space = await statfs(root, { bigint: true });
  if (space.bavail * space.bsize < BigInt(reserve) + BigInt(required))
    throw new Error("Backup disk reserve would be exceeded");
}
export async function separateRoots(data: string, output: string) {
  const a = await realpath(data),
    b = await realpath(output);
  if (a === b || b.startsWith(a + "/") || a.startsWith(b + "/"))
    throw new Error("Backup and data directories must be separate");
}
export async function validateSnapshot(root: string): Promise<Manifest> {
  const manifest = JSON.parse(
    await readFile(join(root, "manifest.json"), "utf8"),
  ) as Manifest;
  if (
    manifest.version !== 1 ||
    manifest.kind !== "teacms-backup" ||
    manifest.consistency !== "independent-sqlite-snapshots-retained-media" ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    typeof manifest.revision !== "string" ||
    !Array.isArray(manifest.datasets) ||
    !manifest.datasets.length ||
    !Array.isArray(manifest.files)
  )
    throw new Error("Unsupported backup manifest");
  const names = new Set<string>();
  for (const file of manifest.files) {
    safeRelative(file.path);
    if (
      names.has(file.path) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      throw new Error("Invalid file manifest");
    names.add(file.path);
    // inventory rejects symlinks, including a replaced parent directory.
  }
  const actual = await inventory(root);
  if (
    JSON.stringify(actual) !==
    JSON.stringify([...names, "manifest.json"].toSorted())
  )
    throw new Error("Backup inventory differs from manifest");
  for (const file of manifest.files) {
    const bytes = await readFile(join(root, file.path));
    if (bytes.length !== file.size || sha256(bytes) !== file.sha256)
      throw new Error("Backup checksum mismatch");
  }
  const ids = new Set<string>();
  for (const dataset of manifest.datasets) {
    if (
      !/^[a-z][a-z0-9-]{0,63}$/.test(dataset.id) ||
      ids.has(dataset.id) ||
      !Array.isArray(dataset.trees)
    )
      throw new Error("Invalid dataset manifest");
    ids.add(dataset.id);
    if (
      dataset.origin !== undefined &&
      URL.parse(dataset.origin)?.origin !== dataset.origin
    )
      throw new Error("Invalid dataset origin");
    if (
      dataset.database !==
        `${dataset.id}/${dataset.id === "operator" ? "operator" : "tea"}.db` ||
      !names.has(dataset.database) ||
      dataset.trees.some(
        (tree) =>
          tree !== `${dataset.id}/uploads` && tree !== `${dataset.id}/public`,
      )
    )
      throw new Error("Invalid dataset paths");
    const db = new DatabaseSync(join(root, dataset.database), {
      readOnly: true,
    });
    try {
      if (db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
        throw new Error("Backup database integrity failed");
      if (dataset.id !== "operator") {
        for (const row of db.prepare("SELECT path FROM media").all()) {
          const path = String(row.path);
          if (
            path.includes("/") ||
            !names.has(`${dataset.id}/uploads/${safeRelative(path)}`)
          )
            throw new Error("Snapshot references missing media bytes");
        }
      }
    } finally {
      db.close();
    }
  }
  for (const name of names) {
    if (
      !manifest.datasets.some(
        (dataset) =>
          name === dataset.database ||
          dataset.trees.some((tree) => name.startsWith(tree + "/")),
      )
    )
      throw new Error("File outside declared backup dataset");
  }
  return manifest;
}
export async function captureSnapshot(
  data: string,
  root: string,
  datasets: Dataset[],
  reserve: number,
  revision: string,
) {
  for (const dataset of datasets) {
    if (
      !/^[a-z][a-z0-9-]{0,63}$/.test(dataset.id) ||
      dataset.database !==
        `${dataset.id}/${dataset.id === "operator" ? "operator" : "tea"}.db` ||
      dataset.trees.some(
        (tree) =>
          tree !== `${dataset.id}/uploads` && tree !== `${dataset.id}/public`,
      )
    )
      throw new Error("Invalid capture dataset");
  }
  const manifest: Manifest = {
    version: 1,
    kind: "teacms-backup",
    createdAt: new Date().toISOString(),
    revision,
    consistency: "independent-sqlite-snapshots-retained-media",
    datasets,
    files: [],
  };
  async function record(path: string) {
    const bytes = await readFile(join(root, path));
    manifest.files.push({ path, size: bytes.length, sha256: sha256(bytes) });
  }
  for (const dataset of datasets) {
    const destination = join(root, dataset.database);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const databasePath = join(data, safeRelative(dataset.database));
    const info = await lstat(databasePath);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      !(await realpath(databasePath)).startsWith((await realpath(data)) + "/")
    )
      throw new Error("Invalid source database path");
    const source = new DatabaseSync(databasePath, {
      readOnly: true,
    });
    try {
      const size =
        Number(source.prepare("PRAGMA page_count").get()?.page_count) *
        Number(source.prepare("PRAGMA page_size").get()?.page_size);
      await reserveSpace(root, reserve, size * 2);
      await backup(source, destination);
      await reserveSpace(root, reserve);
    } finally {
      source.close();
    }
    const standalone = new DatabaseSync(destination);
    try {
      standalone.exec("PRAGMA journal_mode=DELETE");
    } finally {
      standalone.close();
    }
    await record(dataset.database);
    for (const tree of dataset.trees) {
      const sourceRoot = join(data, tree);
      const exists = await lstat(sourceRoot).catch(
        (e: NodeJS.ErrnoException) => {
          if (e.code === "ENOENT") return null;
          throw e;
        },
      );
      if (!exists) continue;
      const paths = await inventory(sourceRoot);
      const observed = new Map<string, string>();
      for (const path of paths) {
        const bytes = await readFile(join(sourceRoot, path));
        await reserveSpace(root, reserve, bytes.length);
        const target = join(root, tree, path);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        const file = await open(target, "wx", 0o600);
        try {
          await file.writeFile(bytes);
          await file.sync();
        } finally {
          await file.close();
        }
        const digest = sha256(bytes);
        manifest.files.push({
          path: `${tree}/${path}`,
          size: bytes.length,
          sha256: digest,
        });
        observed.set(path, digest);
      }
      // Uploads can append during capture; original UUID bytes must never mutate or disappear.
      // Public assets are externally managed: require the entire tree to remain stable.
      const after = await inventory(sourceRoot);
      if (
        tree.endsWith("/public") &&
        JSON.stringify(paths) !== JSON.stringify(after)
      )
        throw new Error("Public files changed during backup");
      for (const [path, digest] of observed)
        if (sha256(await readFile(join(sourceRoot, path))) !== digest)
          throw new Error("Media changed during backup");
    }
  }
  manifest.files = manifest.files.toSorted((a, b) =>
    a.path.localeCompare(b.path),
  );
  await atomicJson(join(root, "manifest.json"), manifest);
  await validateSnapshot(root);
  // Ensure SQLite output is on disk before publishing a completion directory.
  for (const dataset of datasets) {
    const file = await open(join(root, dataset.database), "r+");
    try {
      await file.sync();
    } finally {
      await file.close();
    }
  }
  await syncDirectories(root);
  return manifest;
}
async function syncDirectories(root: string) {
  for (const entry of await readdir(root, { withFileTypes: true }))
    if (entry.isDirectory()) await syncDirectories(join(root, entry.name));
  const directory = await open(root, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
export async function restoreSnapshot(snapshot: string, target: string) {
  const manifest = await validateSnapshot(resolve(snapshot));
  await mkdir(resolve(target), { mode: 0o700 }); // Deliberately refuses any existing destination.
  try {
    for (const file of manifest.files) {
      const path = join(target, file.path);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const bytes = await readFile(join(snapshot, file.path));
      if (bytes.length !== file.size || sha256(bytes) !== file.sha256)
        throw new Error("Snapshot changed during restore");
      const output = await open(path, "wx", 0o600);
      try {
        await output.writeFile(bytes);
        await output.sync();
      } finally {
        await output.close();
      }
    }
    for (const dataset of manifest.datasets) {
      for (const tree of dataset.trees)
        await mkdir(join(target, tree), { recursive: true, mode: 0o700 });
      const db = new DatabaseSync(join(target, dataset.database));
      try {
        db.exec("BEGIN IMMEDIATE");
        for (const table of ["site_sessions", "tickets", "sessions"])
          if (
            db
              .prepare(
                "SELECT 1 FROM sqlite_master WHERE type=\u0027table\u0027 AND name=?",
              )
              .get(table)
          )
            db.exec(`DELETE FROM ${table}`);
        db.exec("COMMIT");
      } finally {
        db.close();
      }
    }
    await syncDirectories(target);
    await atomicJson(join(target, "restore-receipt.json"), {
      version: 1,
      sourceCreatedAt: manifest.createdAt,
      revision: manifest.revision,
      restoredAt: new Date().toISOString(),
      sessionsInvalidated: true,
    });
  } catch (error) {
    // Never delete a failed restore automatically; it is explicitly not ready to serve.
    await atomicJson(join(target, "RESTORE-FAILED.json"), { failed: true });
    throw error;
  }
}
