import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  defaultExportSettings,
  loadExportSettings,
  saveExportSettings,
  writeBuildExport,
  type ExportDirectory,
} from "../editor-export-settings.ts";

const databaseName = "tea-maps-export-settings";

beforeEach(() => deleteDB(databaseName));
afterEach(() => deleteDB(databaseName));

it("keeps export preferences in their project scope", async () => {
  await saveExportSettings({
    ...defaultExportSettings("project-a"),
    includeSource: true,
    afterBuild: true,
  });

  expect(await loadExportSettings("project-a")).toMatchObject({
    includeSource: true,
    afterBuild: true,
  });
  expect(await loadExportSettings("project-b")).toEqual(
    defaultExportSettings("project-b"),
  );
});

it("checks folder permission before replacing an export", async () => {
  let permission: PermissionState = "denied";
  let written: Blob | null = null;
  const directory: ExportDirectory = {
    kind: "directory",
    name: "exports",
    async queryPermission() {
      return permission;
    },
    async getFileHandle() {
      return {
        async createWritable() {
          return {
            async write(data: Blob) {
              written = data;
            },
            async close() {},
          };
        },
      };
    },
  };
  const file = {
    name: "map.bsp",
    data: Uint8Array.of(1, 2, 3).buffer,
    mediaType: "application/x-quake-bsp",
  };

  await expect(writeBuildExport(directory, file)).rejects.toThrow(
    /permission expired/,
  );
  expect(written).toBeNull();

  permission = "granted";
  await writeBuildExport(directory, file);
  expect(new Uint8Array(await written!.arrayBuffer())).toEqual(
    Uint8Array.of(1, 2, 3),
  );
});
