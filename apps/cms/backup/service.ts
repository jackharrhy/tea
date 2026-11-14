import { DatabaseSync } from "node:sqlite";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  lstat,
  open,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  atomicJson,
  captureSnapshot,
  separateRoots,
  validateSnapshot,
  reserveSpace,
} from "./snapshot.ts";
import type { Dataset } from "./snapshot.ts";

export interface BackupStatus {
  enabled: boolean;
  running: boolean;
  lastSuccess?: string;
  nextDue?: string;
  lastError?: string;
  completed: number;
  bytes: number;
  retention: number;
  intervalSeconds: number;
  localOnly: true;
}
export interface BackupConfig {
  directory: string;
  intervalSeconds: number;
  retention: number;
  reserveBytes: number;
}
export function backupConfig(env = process.env): BackupConfig | undefined {
  if (!env.TEA_BACKUP_DIR) return undefined;
  const integer = (key: string, fallback: number, minimum: number) => {
    const value = env[key] === undefined ? fallback : Number(env[key]);
    if (!Number.isSafeInteger(value) || value < minimum)
      throw new Error(`Invalid ${key}`);
    return value;
  };
  return {
    directory: resolve(env.TEA_BACKUP_DIR),
    intervalSeconds: integer("TEA_BACKUP_INTERVAL_SECONDS", 86400, 60),
    retention: integer("TEA_BACKUP_KEEP", 7, 1),
    reserveBytes: integer("TEA_BACKUP_RESERVE_BYTES", 268435456, 1048576),
  };
}
const generationPattern =
  /^snapshot-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9-]{36}$/;
export function createBackupService(
  dataRoot: string,
  datasets: Dataset[],
  config?: BackupConfig,
  revision = process.env.APP_REVISION ?? "unknown",
) {
  const data = resolve(dataRoot);
  let status: BackupStatus = {
    enabled: !!config,
    running: false,
    completed: 0,
    bytes: 0,
    retention: config?.retention ?? 7,
    intervalSeconds: config?.intervalSeconds ?? 86400,
    localOnly: true,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> | undefined;
  let stopped = false;
  async function catalogue() {
    const records = [];
    for (const entry of await readdir(config!.directory, {
      withFileTypes: true,
    })) {
      if (!generationPattern.test(entry.name)) continue; // Never adopt/prune legacy/manual archives.
      if (!entry.isDirectory()) throw new Error("Invalid snapshot generation");
      const manifest = await validateSnapshot(
        join(config!.directory, entry.name),
      );
      records.push({
        name: entry.name,
        createdAt: manifest.createdAt,
        bytes: manifest.files.reduce((total, file) => total + file.size, 0),
      });
    }
    return records.toSorted(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name),
    );
  }
  async function persist() {
    await atomicJson(join(config!.directory, "status.json"), status);
  }
  async function perform(force: boolean) {
    if (!config) return;
    let lock: DatabaseSync | undefined;
    try {
      await mkdir(config.directory, { recursive: true, mode: 0o700 });
      await separateRoots(data, config.directory);
      const lockPath = join(config.directory, ".lease.sqlite");
      const existing = await lstat(lockPath).catch(
        (e: NodeJS.ErrnoException) => {
          if (e.code === "ENOENT") return null;
          throw e;
        },
      );
      if (existing && !existing.isFile())
        throw new Error("Invalid backup lease file");
      lock = new DatabaseSync(lockPath);
      // SQLite holds the lease across awaits and releases it on process exit.
      lock.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE");
      const records = await catalogue();
      const latest = records[0];
      status = {
        ...status,
        running: false,
        completed: records.length,
        bytes: records.reduce((n, r) => n + r.bytes, 0),
        lastSuccess: latest?.createdAt,
        nextDue: latest
          ? new Date(
              Date.parse(latest.createdAt) + config.intervalSeconds * 1000,
            ).toISOString()
          : undefined,
      };
      if (!force && latest && Date.parse(status.nextDue!) > Date.now()) {
        await persist();
        return;
      }
      await reserveSpace(config.directory, config.reserveBytes);
      status = { ...status, running: true, lastError: undefined };
      await persist();
      const name = `snapshot-${new Date().toISOString().replaceAll(":", "-").replace(".", "-")}-${randomUUID()}`;
      const staging = join(config.directory, `.partial-${randomUUID()}`);
      await mkdir(staging, { mode: 0o700 });
      await captureSnapshot(
        data,
        staging,
        datasets,
        config.reserveBytes,
        revision,
      );
      await rename(staging, join(config.directory, name));
      const directory = await open(config.directory, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      const completed = await catalogue();
      for (const record of completed.slice(config.retention)) {
        // A crash during recursive removal must not leave a corrupt completed generation.
        const retired = join(config.directory, `.retired-${record.name}`);
        await rename(join(config.directory, record.name), retired);
        await rm(retired, { recursive: true });
      }
      const kept = completed.slice(0, config.retention);
      status = {
        ...status,
        running: false,
        lastSuccess: kept[0]!.createdAt,
        nextDue: new Date(
          Date.parse(kept[0]!.createdAt) + config.intervalSeconds * 1000,
        ).toISOString(),
        completed: kept.length,
        bytes: kept.reduce((n, r) => n + r.bytes, 0),
        lastError: undefined,
      };
      await persist();
    } catch (error) {
      // Paths, raw database errors, and content never enter operator status/logs.
      const busy =
        error instanceof Error &&
        "code" in error &&
        error.code === "ERR_SQLITE_ERROR" &&
        error.message.includes("locked");
      status = {
        ...status,
        running: false,
        lastError: busy
          ? "Another backup process holds the lease; retry scheduled."
          : "Backup failed verification, configuration, or available-space checks. Previous snapshots retained; inspect storage and configuration.",
      };
      // A failed lease acquisition must not overwrite the active owner's receipt.
      if (lock?.isTransaction) await persist().catch(() => {});
      console.error("TeaCMS backup:", status.lastError);
    } finally {
      if (lock) {
        if (lock.isTransaction) lock.exec("ROLLBACK");
        lock.close();
      }
    }
  }
  function run(force = false): Promise<void> {
    if (active) return active;
    active = perform(force).finally(() => {
      active = undefined;
    });
    return active;
  }
  function schedule() {
    if (stopped || !config) return;
    const delay = status.lastError
      ? Math.min(300000, config.intervalSeconds * 1000)
      : Math.max(1000, Date.parse(status.nextDue ?? "") - Date.now() || 1000);
    timer = setTimeout(
      () => {
        void run().finally(schedule);
      },
      Math.min(delay, 2147483647),
    );
    timer.unref();
  }
  return {
    status: () => ({ ...status }),
    run,
    async start() {
      if (!config) return;
      try {
        const previous = JSON.parse(
          await readFile(join(config.directory, "status.json"), "utf8"),
        ) as BackupStatus;
        if (previous.lastSuccess) status.lastSuccess = previous.lastSuccess;
      } catch {
        /* Catalogue verification remains authoritative. */
      }
      await run();
      schedule();
    },
    async close() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await active;
    },
  };
}
