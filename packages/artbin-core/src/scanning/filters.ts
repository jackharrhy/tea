import { extname } from "path";
import type { ScanSettings } from "./settings.ts";
import { IMPORTABLE_EXTENSIONS } from "./settings.ts";

/**
 * Check if a file should be excluded from scanning based on filename and path patterns.
 * Filename matching is case-insensitive. Path patterns are compiled as case-insensitive RegExp.
 */
export function shouldExclude(
  filePath: string,
  filename: string,
  settings: Pick<ScanSettings, "excludeFilenames" | "excludePathPatterns">,
): boolean {
  const lowerFilename = filename.toLowerCase();

  for (const excluded of settings.excludeFilenames) {
    if (lowerFilename === excluded.toLowerCase()) {
      return true;
    }
  }

  for (const pattern of settings.excludePathPatterns) {
    const re = new RegExp(pattern, "i");
    if (re.test(filePath)) {
      return true;
    }
  }

  return false;
}

/**
 * Find a known game directory in a file path.
 * Returns the original-case path segment if found, or null.
 */
export function findGameDir(
  filePath: string,
  knownGameDirs: string[],
): string | null {
  const segments = filePath.split("/");
  const lowerKnown = knownGameDirs.map((d) => d.toLowerCase());

  for (const segment of segments) {
    const idx = lowerKnown.indexOf(segment.toLowerCase());
    if (idx !== -1) {
      return segment;
    }
  }

  return null;
}

/**
 * Check if a file has an importable extension (game asset).
 */
export function isImportableFile(filename: string): boolean {
  const ext = extname(filename).toLowerCase().slice(1);
  return IMPORTABLE_EXTENSIONS.has(ext);
}

/**
 * Check if a directory should be skipped during scanning.
 * Skips dot-prefixed dirs, node_modules, __pycache__, and anything in excludeDirs.
 */
export function shouldSkipDirectory(
  dirName: string,
  excludeDirs: string[],
): boolean {
  if (dirName.startsWith(".")) {
    return true;
  }
  if (dirName === "node_modules" || dirName === "__pycache__") {
    return true;
  }
  return excludeDirs.includes(dirName);
}
