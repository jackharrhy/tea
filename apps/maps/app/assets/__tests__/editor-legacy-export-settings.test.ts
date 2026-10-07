import "fake-indexeddb/auto";
import { deleteDB, openDB } from "idb";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  countLegacyExportSettings,
  importLegacyExportSettings,
} from "../editor-legacy-export-settings.ts";
import {
  loadExportSettings,
  saveExportSettings,
} from "../editor-export-settings.ts";
import {
  exportLegacyLocalArchive,
  importLegacyLocalArchive,
} from "../editor-legacy-local.ts";

beforeEach(async () => {
  await deleteDB("worldview-editor");
  await deleteDB("tea-maps-export-settings");
});

afterEach(async () => {
  await deleteDB("worldview-editor");
  await deleteDB("tea-maps-export-settings");
});

it("imports Worldview export preferences without replacing Tea preferences or the source", async () => {
  const legacy = await openDB("worldview-editor", 1, {
    upgrade(database) {
      database.createObjectStore("build-exports", { keyPath: "scopeId" });
    },
  });
  const source = {
    scopeId: "project-a",
    quality: "final",
    includeSource: true,
    afterBuild: true,
    directory: null,
  };
  await legacy.put("build-exports", source);
  await legacy.put("build-exports", {
    ...source,
    scopeId: "project-b",
  });
  legacy.close();
  await saveExportSettings({
    scopeId: "project-b",
    includeSource: false,
    afterBuild: false,
    directory: null,
  });

  expect(await countLegacyExportSettings()).toBe(2);
  expect(await importLegacyExportSettings()).toEqual({
    imported: 1,
    existing: 1,
  });
  expect(await loadExportSettings("project-a")).toMatchObject({
    includeSource: true,
    afterBuild: true,
  });
  expect(await loadExportSettings("project-b")).toMatchObject({
    includeSource: false,
    afterBuild: false,
  });
  expect(await importLegacyExportSettings()).toEqual({
    imported: 0,
    existing: 2,
  });
  const sourceDatabase = await openDB("worldview-editor");
  expect(await sourceDatabase.get("build-exports", "project-a")).toEqual(
    source,
  );
  sourceDatabase.close();
});

it("carries portable export choices across origins without a folder handle", async () => {
  const sourceDatabase = await openDB("worldview-editor", 1, {
    upgrade(database) {
      database.createObjectStore("build-exports", { keyPath: "scopeId" });
    },
  });
  await sourceDatabase.put("build-exports", {
    scopeId: "project-a",
    quality: "final",
    includeSource: true,
    afterBuild: true,
    directory: null,
  });
  sourceDatabase.close();

  const archive = await exportLegacyLocalArchive();
  expect(JSON.parse(await archive.text())).toMatchObject({
    version: 4,
    exports: [{ scopeId: "project-a", includeSource: true, afterBuild: true }],
  });
  await deleteDB("worldview-editor");
  expect(
    await importLegacyLocalArchive(new File([archive], "worldview-local.json")),
  ).toMatchObject({ exports: { imported: 1, existing: 0 } });
  expect(await loadExportSettings("project-a")).toEqual({
    scopeId: "project-a",
    includeSource: true,
    afterBuild: true,
    directory: null,
  });
});
