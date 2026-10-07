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
