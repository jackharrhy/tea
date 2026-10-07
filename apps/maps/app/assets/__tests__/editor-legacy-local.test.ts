import "fake-indexeddb/auto";
import { deleteDB, openDB } from "idb";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  createStarterDocument,
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
  listImportedLegacyRecovery,
  loadImportedLegacyRecovery,
} from "../editor-legacy-local.ts";

beforeEach(async () => {
  await deleteEditorDatabase();
  await deleteDB("worldview-editor");
  await deleteDB("tea-maps-worldview-recovery");
});

afterEach(async () => {
  await deleteEditorDatabase();
  await deleteDB("worldview-editor");
  await deleteDB("tea-maps-worldview-recovery");
});

it("transfers local copies and recovery history while preserving both originals and Tea edits", async () => {
  expect(await countLegacyLocalData()).toEqual({ copies: 0, recovery: 0 });
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
    },
  });
  await legacy.put("detached-maps", copy);
  await legacy.put("recovery-history", snapshot);
  await legacy.put("recovery-latest", snapshot);
  legacy.close();

  expect(await countLegacyLocalData()).toEqual({ copies: 1, recovery: 1 });
  expect(await importLegacyLocalData()).toEqual({
    copies: { imported: 1, existing: 0 },
    recovery: { imported: 1, existing: 0 },
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
  });
  expect(
    (await new IndexedDbCollaborationOutbox().loadDetached(copy.id))?.reason,
  ).toBe("Edited in Tea");

  const source = await openDB("worldview-editor");
  expect(await source.get("detached-maps", copy.id)).toEqual(copy);
  expect(await source.get("recovery-history", snapshot.snapshotId)).toEqual(
    snapshot,
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
  });
  expect(
    await new IndexedDbCollaborationOutbox().loadDetached(copy.id),
  ).toEqual(copy);
  expect(await loadImportedLegacyRecovery(snapshot.snapshotId)).toEqual(
    snapshot,
  );
});

it("accepts an earlier detached-only archive", async () => {
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
  });
});
