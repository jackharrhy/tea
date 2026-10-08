import { describe, expect, it } from "vitest";
import {
  shouldExclude,
  findGameDir,
  isImportableFile,
  shouldSkipDirectory,
} from "../filters.ts";
import { DEFAULT_SCAN_SETTINGS } from "../settings.ts";

describe("shouldExclude", () => {
  const settings = DEFAULT_SCAN_SETTINGS;

  it("excludes files matching excludeFilenames (case-insensitive)", () => {
    expect(shouldExclude("some/path/locale.pak", "locale.pak", settings)).toBe(
      true,
    );
    expect(shouldExclude("some/path/LOCALE.PAK", "LOCALE.PAK", settings)).toBe(
      true,
    );
    expect(shouldExclude("some/path/Locale.Pak", "Locale.Pak", settings)).toBe(
      true,
    );
  });

  it("excludes files matching excludePathPatterns", () => {
    expect(
      shouldExclude(
        "apps/Electron Framework.framework/Resources/foo.pak",
        "foo.pak",
        settings,
      ),
    ).toBe(true);
    expect(
      shouldExclude(
        "games/TrenchBroom-2.0/test/data.txt",
        "data.txt",
        settings,
      ),
    ).toBe(true);
    expect(
      shouldExclude("Songs of Syx/assets/image.png", "image.png", settings),
    ).toBe(true);
  });

  it("does not exclude unrelated files", () => {
    expect(
      shouldExclude("games/quake/id1/pak0.pak", "pak0.pak", settings),
    ).toBe(false);
    expect(shouldExclude("textures/wall.png", "wall.png", settings)).toBe(
      false,
    );
  });
});

describe("findGameDir", () => {
  const knownDirs = DEFAULT_SCAN_SETTINGS.knownGameDirs;

  it("finds a known game directory in a path", () => {
    expect(findGameDir("games/quake/id1/maps/e1m1.bsp", knownDirs)).toBe("id1");
    expect(findGameDir("quake2/baseq2/textures/wall.wal", knownDirs)).toBe(
      "baseq2",
    );
  });

  it("returns the original-case segment", () => {
    expect(findGameDir("games/quake/ID1/maps/e1m1.bsp", knownDirs)).toBe("ID1");
    expect(findGameDir("quake2/BASEQ2/textures/wall.wal", knownDirs)).toBe(
      "BASEQ2",
    );
  });

  it("returns null when no known dir is found", () => {
    expect(findGameDir("random/path/to/file.txt", knownDirs)).toBeNull();
    expect(findGameDir("", knownDirs)).toBeNull();
  });

  it("returns the first match", () => {
    // "data" and "base" are both known; "data" comes first in the path
    expect(findGameDir("game/data/base/file.txt", knownDirs)).toBe("data");
  });
});

describe("isImportableFile", () => {
  it("recognizes image files", () => {
    expect(isImportableFile("texture.png")).toBe(true);
    expect(isImportableFile("photo.jpg")).toBe(true);
    expect(isImportableFile("wall.tga")).toBe(true);
    expect(isImportableFile("surface.wal")).toBe(true);
  });

  it("recognizes audio files", () => {
    expect(isImportableFile("sound.wav")).toBe(true);
    expect(isImportableFile("music.ogg")).toBe(true);
    expect(isImportableFile("track.flac")).toBe(true);
  });

  it("recognizes model files", () => {
    expect(isImportableFile("model.gltf")).toBe(true);
    expect(isImportableFile("player.md3")).toBe(true);
    expect(isImportableFile("weapon.mdl")).toBe(true);
  });

  it("recognizes map/config files", () => {
    expect(isImportableFile("e1m1.map")).toBe(true);
    expect(isImportableFile("autoexec.cfg")).toBe(true);
    expect(isImportableFile("materials.mtr")).toBe(true);
  });

  it("is case-insensitive on extension", () => {
    expect(isImportableFile("texture.PNG")).toBe(true);
    expect(isImportableFile("model.GLB")).toBe(true);
  });

  it("rejects non-importable files", () => {
    expect(isImportableFile("readme.txt")).toBe(false);
    expect(isImportableFile("archive.zip")).toBe(false);
    expect(isImportableFile("program.exe")).toBe(false);
    expect(isImportableFile("data.json")).toBe(false);
  });

  it("rejects files with no extension", () => {
    expect(isImportableFile("Makefile")).toBe(false);
  });
});

describe("shouldSkipDirectory", () => {
  const excludeDirs = DEFAULT_SCAN_SETTINGS.excludeDirs;

  it("skips dot-prefixed directories", () => {
    expect(shouldSkipDirectory(".hidden", excludeDirs)).toBe(true);
    expect(shouldSkipDirectory(".DS_Store", excludeDirs)).toBe(true);
  });

  it("skips node_modules", () => {
    expect(shouldSkipDirectory("node_modules", excludeDirs)).toBe(true);
  });

  it("skips __pycache__", () => {
    expect(shouldSkipDirectory("__pycache__", excludeDirs)).toBe(true);
  });

  it("skips directories in the exclude list", () => {
    expect(shouldSkipDirectory("venv", excludeDirs)).toBe(true);
    expect(shouldSkipDirectory("Battle.net", excludeDirs)).toBe(true);
    expect(shouldSkipDirectory("ToDesktop Builder", excludeDirs)).toBe(true);
  });

  it("does not skip normal directories", () => {
    expect(shouldSkipDirectory("textures", excludeDirs)).toBe(false);
    expect(shouldSkipDirectory("maps", excludeDirs)).toBe(false);
    expect(shouldSkipDirectory("sounds", excludeDirs)).toBe(false);
  });
});
