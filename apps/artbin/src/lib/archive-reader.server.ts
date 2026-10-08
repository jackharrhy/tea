import { execFile } from "node:child_process";
import { access, chmod } from "node:fs/promises";
import { constants } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sevenZipBinaries = require("7zip-bin-full") as {
  path7z: string;
  path7zzs: string;
};
const sevenZipPath =
  process.platform === "linux"
    ? sevenZipBinaries.path7zzs
    : sevenZipBinaries.path7z;

export const REMOTE_ARCHIVE_LIMITS = {
  maxEntries: 20_000,
  maxEntryBytes: 256 * 1024 * 1024,
  maxExpandedBytes: 2 * 1024 * 1024 * 1024,
} as const;

export interface SafeArchiveEntry {
  path: string;
  size: number;
}

function comparableArchiveName(value: string): string {
  return value
    .replace(/\.(?:zip|7z|rar|pk3|pk4|pak)$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Return a single archive wrapper directory only when every file is beneath it
 * and its name matches the import title or downloaded archive name.
 */
export function findRedundantArchiveRoot(
  entries: SafeArchiveEntry[],
  importTitle: string,
  archiveName: string,
): string | null {
  if (entries.length === 0) return null;
  const firstSegments = entries.map((entry) => entry.path.split("/"));
  if (firstSegments.some((segments) => segments.length < 2)) return null;

  const root = firstSegments[0][0];
  if (firstSegments.some((segments) => segments[0] !== root)) return null;

  const rootKey = comparableArchiveName(root);
  const matchesTitle = rootKey === comparableArchiveName(importTitle);
  const matchesArchive = rootKey === comparableArchiveName(archiveName);
  return matchesTitle || matchesArchive ? root : null;
}

export function stripArchiveRoot(path: string, root: string | null): string {
  return root && path.startsWith(`${root}/`)
    ? path.slice(root.length + 1)
    : path;
}

interface SevenZipRecord {
  [key: string]: string;
}

let executableReady: Promise<void> | undefined;

async function ensureSevenZipExecutable(): Promise<void> {
  if (process.platform === "win32") return;
  executableReady ??= (async () => {
    try {
      await access(sevenZipPath, constants.X_OK);
    } catch {
      await chmod(sevenZipPath, 0o755);
    }
  })();
  return executableReady;
}

function runSevenZip(
  args: string[],
  options: { maxBuffer: number; timeout: number },
): Promise<{ stdout: Buffer; stderr: Buffer }> {
  return new Promise((resolve, reject) => {
    execFile(
      sevenZipPath,
      args,
      {
        encoding: "buffer",
        maxBuffer: options.maxBuffer,
        timeout: options.timeout,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = Buffer.from(stderr || "")
            .toString("utf8")
            .trim()
            .slice(0, 500);
          reject(
            new Error(
              detail ? `Archive command failed: ${detail}` : error.message,
            ),
          );
          return;
        }
        resolve({
          stdout: Buffer.from(stdout || ""),
          stderr: Buffer.from(stderr || ""),
        });
      },
    );
  });
}

export function normalizeArchiveEntryPath(input: string): string | null {
  if (!input || input.includes("\0")) return null;

  const normalized = input.replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.startsWith("//")) return null;
  if (/^[a-zA-Z]:/.test(normalized)) return null;

  const segments = normalized.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..")
  )
    return null;

  return segments.join("/");
}

function parseSevenZipRecords(output: string): SevenZipRecord[] {
  return output
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const record: SevenZipRecord = {};
      for (const line of block.split(/\r?\n/)) {
        const separator = line.indexOf(" = ");
        if (separator === -1) continue;
        record[line.slice(0, separator)] = line.slice(separator + 3);
      }
      return record;
    })
    .filter((record) => Object.keys(record).length > 0);
}

function isSymlink(record: SevenZipRecord): boolean {
  const attributes = record.Attributes ?? "";
  return (
    record["Symbolic Link"] !== undefined ||
    /(?:^|\s)l[rwx-]{3}/i.test(attributes)
  );
}

export async function listSafeArchiveEntries(
  archivePath: string,
): Promise<SafeArchiveEntry[]> {
  await ensureSevenZipExecutable();
  const { stdout } = await runSevenZip(
    ["l", "-slt", "-ba", "-sccUTF-8", "--", archivePath],
    {
      maxBuffer: 32 * 1024 * 1024,
      timeout: 60_000,
    },
  );
  const records = parseSevenZipRecords(stdout.toString("utf8"));
  const entries: SafeArchiveEntry[] = [];
  let expandedBytes = 0;

  for (const record of records) {
    if (record.Folder === "+") continue;
    if (record.Encrypted === "+") {
      throw new Error("Password-protected archives are not supported");
    }
    if (isSymlink(record)) continue;

    const path = normalizeArchiveEntryPath(record.Path ?? "");
    if (!path) continue;

    const size = Number(record.Size);
    if (!Number.isSafeInteger(size) || size < 0) continue;
    if (size > REMOTE_ARCHIVE_LIMITS.maxEntryBytes) {
      throw new Error(`Archive entry is too large: ${path}`);
    }

    expandedBytes += size;
    if (expandedBytes > REMOTE_ARCHIVE_LIMITS.maxExpandedBytes) {
      throw new Error("Archive expands beyond the 2 GB safety limit");
    }

    entries.push({ path, size });
    if (entries.length > REMOTE_ARCHIVE_LIMITS.maxEntries) {
      throw new Error(
        `Archive contains more than ${REMOTE_ARCHIVE_LIMITS.maxEntries} files`,
      );
    }
  }

  return entries;
}

export async function extractSafeArchiveEntry(
  archivePath: string,
  entry: SafeArchiveEntry,
): Promise<Buffer> {
  const safePath = normalizeArchiveEntryPath(entry.path);
  if (!safePath || safePath !== entry.path) {
    throw new Error("Refusing to extract an unsafe archive path");
  }
  if (entry.size > REMOTE_ARCHIVE_LIMITS.maxEntryBytes) {
    throw new Error(`Archive entry is too large: ${entry.path}`);
  }

  await ensureSevenZipExecutable();
  const { stdout } = await runSevenZip(
    ["x", "-so", "-bd", "-y", "--", archivePath, entry.path],
    {
      maxBuffer: entry.size + 1024 * 1024,
      timeout: 5 * 60_000,
    },
  );
  if (stdout.length !== entry.size) {
    throw new Error(
      `Archive entry size changed while extracting ${entry.path} (expected ${entry.size}, received ${stdout.length})`,
    );
  }
  return stdout;
}
