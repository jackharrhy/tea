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
  countLegacyDetachedMaps,
  exportLegacyDetachedMaps,
  importDetachedArchive,
  importLegacyDetachedMaps,
} from "../editor-legacy-local.ts";

beforeEach(async () => {
  await deleteEditorDatabase();
  await deleteDB("worldview-editor");
});

afterEach(async () => {
  await deleteEditorDatabase();
  await deleteDB("worldview-editor");
});

it("imports same-origin Worldview copies without changing their source or Tea edits", async () => {
  expect(await countLegacyDetachedMaps()).toBe(0);
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
  const legacy = await openDB("worldview-editor", 3, {
    upgrade(database) {
      database.createObjectStore("detached-maps", { keyPath: "id" });
    },
  });
  await legacy.put("detached-maps", copy);
  legacy.close();

  expect(await countLegacyDetachedMaps()).toBe(1);
  expect(await importLegacyDetachedMaps()).toEqual({
    imported: 1,
    existing: 0,
  });
  expect(
    await new IndexedDbCollaborationOutbox().loadDetached(copy.id),
  ).toEqual(copy);
  const destination = await openEditorDatabase();
  await destination.put(EDITOR_STORES.detachedMaps, {
    ...copy,
    reason: "Edited in Tea",
  });
  expect(await importLegacyDetachedMaps()).toEqual({
    imported: 0,
    existing: 1,
  });
  expect(
    (await new IndexedDbCollaborationOutbox().loadDetached(copy.id))?.reason,
  ).toBe("Edited in Tea");

  const source = await openDB("worldview-editor");
  expect(await source.get("detached-maps", copy.id)).toEqual(copy);
  source.close();

  const archive = await exportLegacyDetachedMaps();
  await deleteEditorDatabase();
  expect(
    await importDetachedArchive(new File([archive], "worldview-copies.json")),
  ).toEqual({ imported: 1, existing: 0 });
  expect(
    await new IndexedDbCollaborationOutbox().loadDetached(copy.id),
  ).toEqual(copy);
});
