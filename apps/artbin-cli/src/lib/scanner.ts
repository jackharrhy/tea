import { readdir, stat, readFile } from "fs/promises";
import { join, extname, relative } from "path";
import {
  DEFAULT_SCAN_SETTINGS,
  type ScanSettings,
} from "@tea/artbin-core/scanning/settings";
import {
  shouldExclude,
  findGameDir,
  isImportableFile,
  shouldSkipDirectory,
} from "@tea/artbin-core/scanning/filters";
import {
  parseArchive,
  getFileEntries,
  detectArchiveType,
  type ArchiveEntry,
} from "@tea/artbin-core/parsers/archives";

const ARCHIVE_EXTENSIONS = new Set(["pak", "pk3", "pk4", "zip", "bsp"]);

export interface ScannedArchive {
  path: string;
  relativePath: string; // path relative to scan root (e.g. "AVIAOZIN3/id1/maps/myhouse.bsp")
  name: string;
  size: number;
  type: string;
  gameDir: string | null;
  entries: ArchiveEntry[];
}

export interface ScannedFile {
  path: string;
  relativePath: string; // path relative to scan root
  name: string;
  size: number;
  gameDir: string | null;
}

export interface ScanResult {
  archives: ScannedArchive[];
  looseFiles: ScannedFile[];
  totalFileCount: number;
  totalSize: number;
}

function getExt(filename: string): string {
  return extname(filename).toLowerCase().slice(1);
}

function isArchiveFile(filename: string): boolean {
  return ARCHIVE_EXTENSIONS.has(getExt(filename));
}

export async function scanDirectory(
  rootPath: string,
  settings: ScanSettings = DEFAULT_SCAN_SETTINGS,
  onProgress?: (message: string) => void,
): Promise<ScanResult> {
  const archives: ScannedArchive[] = [];
  const looseFiles: ScannedFile[] = [];

  async function walk(currentPath: string) {
    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry.name, settings.excludeDirs)) continue;
        await walk(fullPath);
      } else if (entry.isFile()) {
        if (shouldExclude(fullPath, entry.name, settings)) continue;

        let stats;
        try {
          stats = await stat(fullPath);
        } catch {
          continue;
        }

        if (stats.size < 1024) continue;

        const ext = getExt(entry.name);
        const gameDir = findGameDir(fullPath, settings.knownGameDirs);

        if (isArchiveFile(entry.name)) {
          if (ext === "zip" && !gameDir) continue;
          if (ext === "bsp") {
            if (entry.name.toLowerCase().startsWith("b_")) continue;
            if (stats.size < 200 * 1024) continue;
          }

          onProgress?.(`Found: ${entry.name}`);

          try {
            const buffer = await readFile(fullPath);
            const archiveType = detectArchiveType(buffer);

            const relPath = relative(rootPath, fullPath);
            if (archiveType !== "unknown") {
              const parsed = parseArchive(buffer);
              const fileEntries = getFileEntries(parsed.entries);
              archives.push({
                path: fullPath,
                relativePath: relPath,
                name: entry.name,
                size: stats.size,
                type: ext,
                gameDir,
                entries: fileEntries,
              });
            } else if (ext === "bsp") {
              archives.push({
                path: fullPath,
                relativePath: relPath,
                name: entry.name,
                size: stats.size,
                type: "bsp",
                gameDir,
                entries: [],
              });
            }
          } catch {
            // Skip unparseable archives
          }
        } else if (isImportableFile(entry.name)) {
          looseFiles.push({
            path: fullPath,
            relativePath: relative(rootPath, fullPath),
            name: entry.name,
            size: stats.size,
            gameDir,
          });
        }
      }
    }
  }

  await walk(rootPath);

  archives.toSorted((a, b) => {
    if (a.gameDir && !b.gameDir) return -1;
    if (!a.gameDir && b.gameDir) return 1;
    return a.path.localeCompare(b.path);
  });

  let totalSize = 0;
  let totalFileCount = 0;
  for (const a of archives) {
    totalSize += a.size;
    totalFileCount += a.entries.length || 1;
  }
  for (const f of looseFiles) {
    totalSize += f.size;
    totalFileCount++;
  }

  return { archives, looseFiles, totalFileCount, totalSize };
}
