import { afterEach, describe, expect, test } from "vitest";
import { setDbForTesting } from "#db/connection.server";
import {
  getScanSettings,
  getSetting,
  initializeScanSettings,
  resetScanSettings,
  setSetting,
  updateScanSettings,
} from "#lib/settings.server";
import { applyMigrations, createTestDatabase, type TestDatabase } from "./db";

let currentDb: TestDatabase | undefined;

afterEach(() => {
  currentDb?.close();
  currentDb = undefined;
});

function setupDatabase() {
  currentDb = createTestDatabase();
  applyMigrations(currentDb.sqlite);
  setDbForTesting(currentDb.db);
}

describe("settings", () => {
  test("returns defaults for missing or invalid JSON settings", async () => {
    setupDatabase();

    expect(await getSetting("missing", ["fallback"])).toEqual(["fallback"]);

    await currentDb!.sqlite
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
      .run("bad", "not-json");
    expect(await getSetting("bad", ["fallback"])).toEqual(["fallback"]);
  });

  test("sets and reads a typed setting", async () => {
    setupDatabase();

    await setSetting("scan.excludeDirs", ["tmp", "cache"]);

    expect(await getSetting("scan.excludeDirs", [] as string[])).toEqual([
      "tmp",
      "cache",
    ]);
  });

  test("initializes scan settings once", async () => {
    setupDatabase();

    const initialized = await initializeScanSettings();
    expect(initialized.excludeDirs).toContain("node_modules");
    expect(initialized.knownGameDirs).toContain("id1");

    await setSetting("scan.excludeDirs", ["custom"]);
    const second = await initializeScanSettings();
    expect(second.excludeDirs).toEqual(["custom"]);
  });

  test("updates scan settings with a Result", async () => {
    setupDatabase();

    const result = await updateScanSettings({
      excludeDirs: ["tmp"],
      excludeFilenames: ["locale.pak"],
      excludePathPatterns: ["/test/"],
      knownGameDirs: ["id1"],
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      excludeDirs: ["tmp"],
      excludeFilenames: ["locale.pak"],
      excludePathPatterns: ["/test/"],
      knownGameDirs: ["id1"],
    });
  });

  test("rejects invalid regex patterns when updating scan settings", async () => {
    setupDatabase();

    const result = await updateScanSettings({
      excludePathPatterns: ["[not-valid"],
    });

    expect(result.isErr()).toBe(true);
    if (!result.isErr())
      throw new Error("Expected invalid regex update to fail");
    expect(result.error.message).toBe("Invalid regex patterns: [not-valid");
  });

  test("resets scan settings to defaults with a Result", async () => {
    setupDatabase();
    await setSetting("scan.excludeDirs", ["custom"]);

    const result = await resetScanSettings();

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().excludeDirs).toContain("node_modules");
    expect(result.unwrap().excludeDirs).not.toContain("custom");
  });

  test("getScanSettings reads stored settings", async () => {
    setupDatabase();
    await setSetting("scan.excludeDirs", ["tmp"]);
    await setSetting("scan.excludeFilenames", ["a.pak"]);
    await setSetting("scan.excludePathPatterns", ["/skip/"]);
    await setSetting("scan.knownGameDirs", ["baseq3"]);

    expect(await getScanSettings()).toEqual({
      excludeDirs: ["tmp"],
      excludeFilenames: ["a.pak"],
      excludePathPatterns: ["/skip/"],
      knownGameDirs: ["baseq3"],
    });
  });
});
