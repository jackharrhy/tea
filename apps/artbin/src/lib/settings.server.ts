import { db } from "#db/connection.server";
import { settings } from "#db";
import { eq } from "drizzle-orm";
import { Result } from "better-result";
import {
  DEFAULT_EXCLUDE_DIRS,
  DEFAULT_EXCLUDE_FILENAMES,
  DEFAULT_EXCLUDE_PATH_PATTERNS,
  DEFAULT_KNOWN_GAME_DIRS,
  type ScanSettings,
} from "@artbin/core/scanning/settings";

export type { ScanSettings };

export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const row = await db.query.settings.findFirst({
    where: eq(settings.key, key),
  });

  if (!row) {
    return defaultValue;
  }

  try {
    return JSON.parse(row.value) as T;
  } catch {
    return defaultValue;
  }
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  const jsonValue = JSON.stringify(value);
  const now = new Date();

  await db
    .insert(settings)
    .values({
      key,
      value: jsonValue,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        value: jsonValue,
        updatedAt: now,
      },
    });
}

export async function getScanSettings(): Promise<ScanSettings> {
  const [excludeDirs, excludeFilenames, excludePathPatterns, knownGameDirs] =
    await Promise.all([
      getSetting("scan.excludeDirs", DEFAULT_EXCLUDE_DIRS),
      getSetting("scan.excludeFilenames", DEFAULT_EXCLUDE_FILENAMES),
      getSetting("scan.excludePathPatterns", DEFAULT_EXCLUDE_PATH_PATTERNS),
      getSetting("scan.knownGameDirs", DEFAULT_KNOWN_GAME_DIRS),
    ]);

  return {
    excludeDirs,
    excludeFilenames,
    excludePathPatterns,
    knownGameDirs,
  };
}

export async function initializeScanSettings(): Promise<ScanSettings> {
  // Check if any scan settings exist
  const existing = await db.query.settings.findFirst({
    where: eq(settings.key, "scan.excludeDirs"),
  });

  if (!existing) {
    // Initialize all settings with defaults
    await Promise.all([
      setSetting("scan.excludeDirs", DEFAULT_EXCLUDE_DIRS),
      setSetting("scan.excludeFilenames", DEFAULT_EXCLUDE_FILENAMES),
      setSetting("scan.excludePathPatterns", DEFAULT_EXCLUDE_PATH_PATTERNS),
      setSetting("scan.knownGameDirs", DEFAULT_KNOWN_GAME_DIRS),
    ]);
  }

  return getScanSettings();
}

export async function updateScanSettings(updates: Partial<ScanSettings>) {
  const invalidPatterns = (updates.excludePathPatterns ?? []).filter(
    (pattern) => {
      try {
        RegExp(pattern);
        return false;
      } catch {
        return true;
      }
    },
  );

  if (invalidPatterns.length > 0) {
    return Result.err(
      new Error(`Invalid regex patterns: ${invalidPatterns.join(", ")}`),
    );
  }

  const promises: Promise<void>[] = [];

  if (updates.excludeDirs !== undefined) {
    promises.push(setSetting("scan.excludeDirs", updates.excludeDirs));
  }
  if (updates.excludeFilenames !== undefined) {
    promises.push(
      setSetting("scan.excludeFilenames", updates.excludeFilenames),
    );
  }
  if (updates.excludePathPatterns !== undefined) {
    promises.push(
      setSetting("scan.excludePathPatterns", updates.excludePathPatterns),
    );
  }
  if (updates.knownGameDirs !== undefined) {
    promises.push(setSetting("scan.knownGameDirs", updates.knownGameDirs));
  }

  await Promise.all(promises);

  return Result.ok(await getScanSettings());
}

export async function resetScanSettings() {
  await Promise.all([
    setSetting("scan.excludeDirs", DEFAULT_EXCLUDE_DIRS),
    setSetting("scan.excludeFilenames", DEFAULT_EXCLUDE_FILENAMES),
    setSetting("scan.excludePathPatterns", DEFAULT_EXCLUDE_PATH_PATTERNS),
    setSetting("scan.knownGameDirs", DEFAULT_KNOWN_GAME_DIRS),
  ]);

  return Result.ok(await getScanSettings());
}
