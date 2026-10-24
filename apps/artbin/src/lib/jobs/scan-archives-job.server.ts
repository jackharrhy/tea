/**
 * Local archive scanner job handler
 *
 * Scans the filesystem for game archives (PAK, PK3, WAD, ZIP, BSP) using fd.
 * Results are stored in job output for display in the admin UI.
 * Exclusion patterns are configurable via the settings table.
 */

import { type Job } from "#db";
import { exec } from "child_process";
import { promisify } from "util";
import { stat } from "fs/promises";
import { basename, dirname } from "path";
import { registerJobHandler, updateJobProgress } from "../jobs.server.ts";
import { getScanSettings } from "../settings.server.ts";
import { homedir } from "os";
import { createRequestLogger } from "evlog";

const execAsync = promisify(exec);

interface ScanArchivesInput {
  rootPath?: string; // Defaults to home directory
}

export interface FoundArchive {
  path: string; // Full path to file
  name: string; // Filename
  size: number; // File size in bytes
  type: string; // pak, pk3, wad, zip
  parentDir: string; // Immediate parent directory name
  gameDir: string | null; // Known game directory if found in path
}

/**
 * Find a known game directory in the file path
 */
function findGameDir(
  filePath: string,
  knownGameDirs: Set<string>,
): string | null {
  const parts = filePath.toLowerCase().split("/");
  for (const part of parts) {
    if (knownGameDirs.has(part)) {
      return part;
    }
  }
  return null;
}

/**
 * Check if a file should be excluded based on filename or path patterns
 */
function shouldExclude(
  filePath: string,
  filename: string,
  excludeFilenames: Set<string>,
  excludePathPatterns: RegExp[],
): boolean {
  // Check excluded filenames
  if (excludeFilenames.has(filename.toLowerCase())) {
    return true;
  }

  // Check path patterns
  for (const pattern of excludePathPatterns) {
    if (pattern.test(filePath)) {
      return true;
    }
  }

  return false;
}

/**
 * Get file extension without the dot, lowercase
 */
function getExtension(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return ext;
}

/**
 * Build fd command for scanning archives
 */
function buildFdCommand(rootPath: string, excludeDirs: string[]): string {
  // Build exclusion patterns
  const excludeArgs = excludeDirs.map((dir: string) => `-E "${dir}"`).join(" ");

  // Search for pak, pk3, pk4, wad, zip, bsp files
  // Use regex to match extensions (case insensitive with fd)
  const pattern = "\\.(pak|pk3|pk4|wad|zip|bsp)$";

  return `fd "${pattern}" --type f --ignore-case ${excludeArgs} "${rootPath}" 2>/dev/null`;
}

async function handleScanArchives(
  job: Job,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { rootPath: inputPath } = input as unknown as ScanArchivesInput;
  const rootPath = inputPath || homedir();

  const startTime = Date.now();

  await updateJobProgress(job.id, 2, "Loading scan settings...");

  // Load settings from database
  const scanSettings = await getScanSettings();

  // Convert settings to Sets and RegExps for efficient lookup
  const excludeFilenames = new Set(
    scanSettings.excludeFilenames.map((f) => f.toLowerCase()),
  );
  const excludePathPatterns = scanSettings.excludePathPatterns
    .map((p) => {
      try {
        return new RegExp(p, "i");
      } catch {
        return null;
      }
    })
    .filter((p): p is RegExp => p !== null);
  const knownGameDirs = new Set(
    scanSettings.knownGameDirs.map((d) => d.toLowerCase()),
  );

  await updateJobProgress(
    job.id,
    5,
    `Scanning ${rootPath} for game archives...`,
  );

  // Run fd to find archives
  const fdCommand = buildFdCommand(rootPath, scanSettings.excludeDirs);

  let stdout = "";
  try {
    const result = await execAsync(fdCommand, {
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large result sets
      timeout: 5 * 60 * 1000, // 5 minute timeout
    });
    stdout = result.stdout;
  } catch (error: any) {
    // fd returns exit code 1 if no matches found, which is fine
    if (error.stdout) {
      stdout = error.stdout;
    } else if (error.code !== 1) {
      throw new Error(`fd command failed: ${error.message}`, { cause: error });
    }
  }

  const filePaths = stdout.trim().split("\n").filter(Boolean);

  await updateJobProgress(
    job.id,
    30,
    `Found ${filePaths.length} potential archives, gathering details...`,
  );

  // Gather file details
  const archives: FoundArchive[] = [];
  let processed = 0;

  for (const filePath of filePaths) {
    try {
      const name = basename(filePath);
      const ext = getExtension(name);

      // Skip excluded files based on filename or path pattern
      if (
        shouldExclude(filePath, name, excludeFilenames, excludePathPatterns)
      ) {
        processed++;
        continue;
      }

      const stats = await stat(filePath);

      // Skip very small files (likely not real game archives)
      if (stats.size < 1024) {
        processed++;
        continue;
      }

      // For zip files, only include if in a known game directory
      if (ext === "zip") {
        const gameDir = findGameDir(filePath, knownGameDirs);
        if (!gameDir) {
          processed++;
          continue;
        }
      }

      // For BSP files, skip small pickup/ammo model BSPs (b_*.bsp)
      // These are typically under 200KB and don't have interesting textures
      if (ext === "bsp") {
        const lowerName = name.toLowerCase();
        // Skip b_*.bsp files (Quake ammo/item models)
        if (lowerName.startsWith("b_")) {
          processed++;
          continue;
        }
        // Skip very small BSPs (< 200KB, likely item models)
        if (stats.size < 200 * 1024) {
          processed++;
          continue;
        }
      }

      archives.push({
        path: filePath,
        name,
        size: stats.size,
        type: ext,
        parentDir: basename(dirname(filePath)),
        gameDir: findGameDir(filePath, knownGameDirs),
      });
    } catch (err) {
      const log = createRequestLogger();
      log.error(err instanceof Error ? err : new Error(String(err)), {
        step: "stat-archive",
        path: filePath,
      });
      log.emit();
    }

    processed++;

    // Update progress periodically
    if (processed % 100 === 0) {
      const progress = 30 + Math.floor((processed / filePaths.length) * 60);
      await updateJobProgress(
        job.id,
        progress,
        `Processing ${processed}/${filePaths.length} files...`,
      );
    }
  }

  // Sort by game directory, then by path
  archives.toSorted((a, b) => {
    // Archives with known game dirs first
    if (a.gameDir && !b.gameDir) return -1;
    if (!a.gameDir && b.gameDir) return 1;
    // Then by game dir name
    if (a.gameDir && b.gameDir && a.gameDir !== b.gameDir) {
      return a.gameDir.localeCompare(b.gameDir);
    }
    // Then by path
    return a.path.localeCompare(b.path);
  });

  const scanDuration = Date.now() - startTime;

  await updateJobProgress(job.id, 95, `Found ${archives.length} game archives`);

  return {
    archives,
    totalFound: archives.length,
    scanDuration,
    rootPath,
  };
}

// Register the job handler
registerJobHandler("scan-archives", handleScanArchives);
