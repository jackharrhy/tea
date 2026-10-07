import "fake-indexeddb/auto";
import { deleteDB, openDB } from "idb";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  createBoxBrush,
  createSequentialIdFactory,
  createStarterDocument,
  developmentTexturePack,
  insertBrush,
  rebaseMapSource,
  serializeMap,
} from "@tea/maps-editor/core";
import {
  deleteEditorDatabase,
  EDITOR_STORES,
  openEditorDatabase,
} from "../editor-collaboration-database.ts";
import { IndexedDbCollaborationOutbox } from "../editor-collaboration-outbox.ts";
import {
  countLegacyLocalData,
  exportLegacyLocalArchive,
  importLegacyLocalArchive,
  importLegacyLocalData,
  importLegacyLocalProjects,
  listImportedLegacyRecovery,
  loadImportedLegacyRecovery,
  countLegacyLocalProjects,
} from "../editor-legacy-local.ts";
import { recentProject } from "../editor-recent-projects.ts";
import { installLegacyRecoveryResources } from "../editor-legacy-mounts.ts";
import {
  loadStandaloneResources,
  saveStandaloneResources,
  emptyStandaloneResources,
} from "../editor-standalone-resources.ts";

async function fingerprint(data: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

beforeEach(async () => {
  await deleteEditorDatabase();
  await deleteDB("worldview-editor");
  await deleteDB("tea-maps-worldview-recovery");
  await deleteDB("tea-maps-recent-projects");
  await deleteDB("tea-maps-worldview-mounts");
  await deleteDB("tea-maps-standalone-resources");
});

afterEach(async () => {
  await deleteEditorDatabase();
  await deleteDB("worldview-editor");
  await deleteDB("tea-maps-worldview-recovery");
  await deleteDB("tea-maps-recent-projects");
  await deleteDB("tea-maps-worldview-mounts");
  await deleteDB("tea-maps-standalone-resources");
});

it("transfers local copies and recovery history while preserving both originals and Tea edits", async () => {
  expect(await countLegacyLocalData()).toEqual({
    copies: 0,
    recovery: 0,
    mounts: 0,
  });
  const document = createStarterDocument();
  const copy = {
    version: 1,
    id: "legacy-copy",
    originalMapId: "hosted-map",
    documentKey: "hosted-map:hosted-map",
    fileName: "saved-work.map",
    profile: "quake",
    document,
    source: rebaseMapSource(document, serializeMap(document)),
    originalMapVersion: 3,
    createdAt: 100,
    reason: "Offline work",
    operationCount: 1,
    encodedBytes: 100,
  } as const;
  const snapshot = {
    version: 1,
    snapshotId: "hosted-map:hosted-map:checkpoint:100",
    documentKey: copy.documentKey,
    fileName: copy.fileName,
    document,
    source: copy.source,
    savedDocumentRevision: -1,
    updatedAt: 100,
    label: "Before offline work",
    protected: true,
  } as const;
  const legacy = await openDB("worldview-editor", 3, {
    upgrade(database) {
      database.createObjectStore("detached-maps", { keyPath: "id" });
      database.createObjectStore("recovery-history", {
        keyPath: "snapshotId",
      });
      database.createObjectStore("recovery-latest", {
        keyPath: "documentKey",
      });
      database.createObjectStore("local-projects", { keyPath: "projectKey" });
    },
  });
  await legacy.put("detached-maps", copy);
  await legacy.put("recovery-history", snapshot);
  await legacy.put("recovery-latest", snapshot);
  const project = {
    version: 2,
    workspaceId: "legacy-workspace",
    projectKey: "legacy-project",
    displayName: "Legacy project",
    handle: { kind: "directory", name: "legacy-folder" },
    buildBindings: {},
    lastMapPath: "maps/start.map",
    updatedAt: 101,
  };
  await legacy.put("local-projects", project);
  legacy.close();

  expect(await countLegacyLocalData()).toEqual({
    copies: 1,
    recovery: 1,
    mounts: 0,
  });
  expect(await countLegacyLocalProjects()).toBe(1);
  expect(await importLegacyLocalProjects()).toEqual({
    imported: 1,
    existing: 0,
  });
  expect(await recentProject("legacy-workspace")).toMatchObject({
    name: "Legacy project",
    handle: { kind: "directory", name: "legacy-folder" },
    lastMapPath: "maps/start.map",
  });
  expect(await importLegacyLocalProjects()).toEqual({
    imported: 0,
    existing: 1,
  });
  expect(await importLegacyLocalData()).toEqual({
    copies: { imported: 1, existing: 0 },
    recovery: { imported: 1, existing: 0 },
    mounts: { imported: 0, existing: 0 },
  });
  expect(
    await new IndexedDbCollaborationOutbox().loadDetached(copy.id),
  ).toEqual(copy);
  expect(await listImportedLegacyRecovery()).toEqual([snapshot]);
  expect(await loadImportedLegacyRecovery(snapshot.snapshotId)).toEqual(
    snapshot,
  );

  const destination = await openEditorDatabase();
  await destination.put(EDITOR_STORES.detachedMaps, {
    ...copy,
    reason: "Edited in Tea",
  });
  expect(await importLegacyLocalData()).toEqual({
    copies: { imported: 0, existing: 1 },
    recovery: { imported: 0, existing: 1 },
    mounts: { imported: 0, existing: 0 },
  });
  expect(
    (await new IndexedDbCollaborationOutbox().loadDetached(copy.id))?.reason,
  ).toBe("Edited in Tea");

  const source = await openDB("worldview-editor");
  expect(await source.get("detached-maps", copy.id)).toEqual(copy);
  expect(await source.get("recovery-history", snapshot.snapshotId)).toEqual(
    snapshot,
  );
  expect(await source.get("local-projects", project.projectKey)).toEqual(
    project,
  );
  source.close();

  const archive = await exportLegacyLocalArchive();
  await deleteEditorDatabase();
  await deleteDB("tea-maps-worldview-recovery");
  expect(
    await importLegacyLocalArchive(new File([archive], "worldview-local.json")),
  ).toEqual({
    copies: { imported: 1, existing: 0 },
    recovery: { imported: 1, existing: 0 },
    mounts: { imported: 0, existing: 0 },
  });
  expect(
    await new IndexedDbCollaborationOutbox().loadDetached(copy.id),
  ).toEqual(copy);
  expect(await loadImportedLegacyRecovery(snapshot.snapshotId)).toEqual(
    snapshot,
  );
});

it("accepts earlier archives without resource mounts", async () => {
  const archive = new File(
    [
      JSON.stringify({
        kind: "tea-maps-worldview-detached",
        version: 1,
        copies: [],
      }),
    ],
    "worldview-copies.json",
  );
  expect(await importLegacyLocalArchive(archive)).toEqual({
    copies: { imported: 0, existing: 0 },
    recovery: { imported: 0, existing: 0 },
    mounts: { imported: 0, existing: 0 },
  });
  const v2 = new File(
    [
      JSON.stringify({
        kind: "tea-maps-worldview-local",
        version: 2,
        copies: [],
        recovery: [],
      }),
    ],
    "worldview-local-v2.json",
  );
  expect(await importLegacyLocalArchive(v2)).toEqual({
    copies: { imported: 0, existing: 0 },
    recovery: { imported: 0, existing: 0 },
    mounts: { imported: 0, existing: 0 },
  });
});

it("carries browser WADs and palettes through an archive into recovery copies", async () => {
  const wad = developmentTexturePack("quake")!.wad;
  const palette = new Uint8Array(768).fill(17).buffer;
  const mounts = [
    {
      id: "source:wad",
      scopeId: "source",
      label: "textures.wad",
      priority: 1,
      profile: "quake",
      sourceName: "textures.wad",
      contentFingerprint: await fingerprint(wad),
      kind: "browser-wad",
      data: wad,
    },
    {
      id: "source:palette",
      scopeId: "source",
      label: "palette.lmp",
      priority: 2,
      profile: "quake",
      sourceName: "palette.lmp",
      contentFingerprint: await fingerprint(palette),
      kind: "browser-palette",
      data: palette,
    },
  ];
  const legacy = await openDB("worldview-editor", 3, {
    upgrade(database) {
      database.createObjectStore("asset-mounts", { keyPath: "id" });
    },
  });
  for (const mount of mounts) await legacy.put("asset-mounts", mount);
  legacy.close();

  expect(await countLegacyLocalData()).toEqual({
    copies: 0,
    recovery: 0,
    mounts: 2,
  });
  const archive = await exportLegacyLocalArchive();
  expect(JSON.parse(await archive.text())).toMatchObject({ version: 3 });
  expect(
    await importLegacyLocalArchive(new File([archive], "resources.json")),
  ).toEqual({
    copies: { imported: 0, existing: 0 },
    recovery: { imported: 0, existing: 0 },
    mounts: { imported: 2, existing: 0 },
  });
  expect(await installLegacyRecoveryResources("source", "copy", "quake")).toBe(
    true,
  );
  const resources = await loadStandaloneResources("copy", "quake");
  expect(resources.wads[0]?.data).toEqual(wad);
  expect(resources.palette).toEqual(new Uint8Array(palette));
  await saveStandaloneResources("copy", "quake", emptyStandaloneResources());
  expect(await installLegacyRecoveryResources("source", "copy", "quake")).toBe(
    false,
  );
  expect((await loadStandaloneResources("copy", "quake")).wads).toEqual([]);
  const source = await openDB("worldview-editor");
  const sourceMounts = await source.getAll("asset-mounts");
  source.close();
  expect(sourceMounts.map((mount) => mount.id)).toEqual([
    "source:palette",
    "source:wad",
  ]);
});

it("preserves unsynced Worldview hosted edits as a portable local copy", async () => {
  const before = createStarterDocument();
  const brush = createBoxBrush(
    [0, 0, 0],
    [64, 64, 64],
    "STONE",
    createSequentialIdFactory("pending"),
  );
  const document = insertBrush(before, before.entities[0]!.id, brush);
  const operation = {
    schemaVersion: 1,
    operationId: "alice:1",
    transactionId: "alice:1",
    actorId: "alice",
    baseMapVersion: 4,
    label: "Offline brush",
    edits: [
      {
        kind: "insert-brush",
        entityId: before.entities[0]!.id,
        insertionIndex: before.entities[0]!.primitives.length,
        brush,
      },
    ],
  };
  const recovery = {
    version: 1,
    mapId: "pending-map",
    documentKey: "hosted-map:pending-map",
    fileName: "pending.map",
    profile: "quake",
    document,
    source: rebaseMapSource(before, serializeMap(before)),
    savedDocumentRevision: before.revision,
    mapVersion: 4,
    updatedAt: 100,
  };
  const storedOperation = {
    version: 1,
    key: "pending-map\u0000alice:1",
    mapId: "pending-map",
    operation,
    encodedBytes: 100,
    recordedAt: 100,
    localSequence: 1,
  };
  const session = {
    version: 1,
    mapId: "pending-map",
    mapVersion: 4,
    dirtySince: 100,
    operationCount: 1,
    encodedBytes: 100,
    recovery,
    updatedAt: 100,
  };
  const legacy = await openDB("worldview-editor", 3, {
    upgrade(database) {
      database.createObjectStore("collaboration-operations", {
        keyPath: "key",
      });
      database.createObjectStore("collaboration-sessions", {
        keyPath: "mapId",
      });
    },
  });
  await legacy.put("collaboration-operations", storedOperation);
  await legacy.put("collaboration-sessions", session);
  legacy.close();

  expect(await countLegacyLocalData()).toEqual({
    copies: 1,
    recovery: 0,
    mounts: 0,
  });
  expect(await importLegacyLocalData()).toEqual({
    copies: { imported: 1, existing: 0 },
    recovery: { imported: 0, existing: 0 },
    mounts: { imported: 0, existing: 0 },
  });
  const [copy] = await new IndexedDbCollaborationOutbox().listDetached();
  expect(copy).toMatchObject({
    originalMapId: "pending-map",
    document,
    operationCount: 1,
    encodedBytes: 100,
  });
  const archive = await exportLegacyLocalArchive();
  await deleteEditorDatabase();
  expect(
    await importLegacyLocalArchive(new File([archive], "pending.json")),
  ).toEqual({
    copies: { imported: 1, existing: 0 },
    recovery: { imported: 0, existing: 0 },
    mounts: { imported: 0, existing: 0 },
  });
  expect(
    await new IndexedDbCollaborationOutbox().loadDetached(copy!.id),
  ).toEqual(copy);
  const source = await openDB("worldview-editor");
  expect(
    await source.get("collaboration-operations", storedOperation.key),
  ).toEqual(storedOperation);
  await source.put("collaboration-sessions", { ...session, recovery: null });
  source.close();
  await expect(countLegacyLocalData()).rejects.toThrow(
    "without a recovery snapshot",
  );
});
