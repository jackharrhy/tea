import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COLLABORATION_SCHEMA_VERSION,
  createBoxBrush,
  createSequentialIdFactory,
  createStarterDocument,
  insertBrush,
  rebaseMapSource,
  serializeMap,
  type CollaborationOperation,
  type MapDocument,
} from "@tea/maps-editor/core";

import {
  IndexedDbCollaborationOutbox,
  type HostedMapRecoverySnapshot,
} from "../editor-collaboration-outbox.ts";
import {
  closeEditorDatabase,
  deleteEditorDatabase,
} from "../editor-collaboration-database.ts";

beforeEach(deleteEditorDatabase);
afterEach(deleteEditorDatabase);

function fixture(mapId = "room"): {
  readonly before: MapDocument;
  readonly after: MapDocument;
  readonly operation: CollaborationOperation;
  readonly recovery: HostedMapRecoverySnapshot;
} {
  const before = createStarterDocument();
  const brush = createBoxBrush(
    [0, 0, 0],
    [64, 64, 64],
    "STONE",
    createSequentialIdFactory("offline"),
  );
  const after = insertBrush(before, before.entities[0]!.id, brush);
  const operation: CollaborationOperation = {
    schemaVersion: COLLABORATION_SCHEMA_VERSION,
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
  const text = serializeMap(after);
  return {
    before,
    after,
    operation,
    recovery: {
      version: 1,
      mapId,
      documentKey: `hosted-map:${mapId}`,
      fileName: "offline.map",
      profile: "quake",
      document: after,
      source: rebaseMapSource(after, text),
      savedDocumentRevision: before.revision,
      mapVersion: 4,
      updatedAt: 100,
    },
  };
}

describe("bounded hosted reconnect outbox", () => {
  it("allows a clean hosted map to reconnect after an unbounded absence", async () => {
    const outbox = new IndexedDbCollaborationOutbox({
      graceMilliseconds: 1,
      maxOperations: 1,
      maxEncodedBytes: 1,
    });

    expect(await outbox.inspect("room", Number.MAX_SAFE_INTEGER)).toMatchObject(
      {
        status: "clean",
        summary: { operationCount: 0, encodedBytes: 0, dirtySince: null },
      },
    );
  });

  it("tracks count, bytes, map version, recovery, and the first dirty disconnect", async () => {
    const { operation, recovery } = fixture();
    const outbox = new IndexedDbCollaborationOutbox();

    const recorded = await outbox.put("room", operation, {
      mapVersion: 4,
      connected: true,
      recordedAt: 100,
      recovery,
    });
    expect(recorded).toMatchObject({
      status: "replay",
      summary: {
        mapVersion: 4,
        dirtySince: null,
        operationCount: 1,
        recovery: { fileName: "offline.map" },
      },
    });
    expect(recorded.summary.encodedBytes).toBeGreaterThan(0);

    const disconnected = await outbox.connectionChanged("room", 200);
    expect(disconnected.summary.dirtySince).toBe(100);
    const stillDisconnected = await outbox.connectionChanged("room", 300);
    expect(stillDisconnected.summary.dirtySince).toBe(100);
    const handshakeReady = await outbox.connectionChanged("room", 400);
    expect(handshakeReady.summary.dirtySince).toBe(100);
  });

  it("keeps replay idempotent and orders same-timestamp operations by numeric sequence", async () => {
    const { operation, recovery } = fixture();
    const outbox = new IndexedDbCollaborationOutbox();
    const tenth = {
      ...operation,
      operationId: "alice:10",
      transactionId: "alice:10",
    };
    const second = {
      ...operation,
      operationId: "alice:2",
      transactionId: "alice:2",
    };
    await outbox.put("room", tenth, {
      mapVersion: 4,
      connected: false,
      recordedAt: 100,
      localSequence: 10,
      recovery,
    });
    await outbox.put("room", second, {
      mapVersion: 4,
      connected: false,
      recordedAt: 100,
      localSequence: 2,
      recovery,
    });
    await outbox.put("room", second, {
      mapVersion: 4,
      connected: false,
      recordedAt: 100,
      localSequence: 2,
      recovery,
    });

    expect(
      (await outbox.pending("room")).map(({ operationId }) => operationId),
    ).toEqual(["alice:2", "alice:10"]);
    expect(await outbox.inspect("room", 100)).toMatchObject({
      status: "replay",
      summary: { operationCount: 2 },
    });

    await outbox.acknowledge("room", second.operationId, 5);
    expect(await outbox.inspect("room", 100)).toMatchObject({
      status: "replay",
      summary: { mapVersion: 5, operationCount: 1 },
    });
  });

  it("survives a new storage instance, then atomically quarantines expired replay as a local map", async () => {
    const { after, operation, recovery } = fixture();
    const limits = {
      graceMilliseconds: 100,
      maxOperations: 10,
      maxEncodedBytes: 1_000_000,
    };
    const beforeReload = new IndexedDbCollaborationOutbox(limits);
    await beforeReload.put("room", operation, {
      mapVersion: 4,
      connected: true,
      recordedAt: 1_000,
      recovery,
    });
    await closeEditorDatabase();

    const afterReload = new IndexedDbCollaborationOutbox(limits);
    const decision = await afterReload.inspect("room", 1_101);
    expect(decision.status).toBe("detach");
    if (decision.status !== "detach") throw new Error("Expected detachment");
    const copy = await afterReload.detach("room", decision.reason, 1_101);

    expect(copy).toMatchObject({
      originalMapId: "room",
      fileName: "offline.map",
      originalMapVersion: 4,
      operationCount: 1,
      document: after,
    });
    expect(await afterReload.pending("room")).toEqual([]);
    expect(await afterReload.inspect("room", 1_102)).toMatchObject({
      status: "clean",
    });
    expect((await afterReload.loadDetached(copy!.id))?.document).toEqual(after);
  });

  it("detaches on count or aggregate encoded-byte limits without replaying the triggering edit", async () => {
    const { operation, recovery } = fixture();
    const countLimited = new IndexedDbCollaborationOutbox({
      graceMilliseconds: 1_000,
      maxOperations: 0,
      maxEncodedBytes: 1_000_000,
    });
    expect(
      await countLimited.put("room", operation, {
        mapVersion: 4,
        connected: false,
        recordedAt: 10,
        recovery,
      }),
    ).toMatchObject({ status: "detach" });

    await deleteEditorDatabase();
    const byteLimited = new IndexedDbCollaborationOutbox({
      graceMilliseconds: 1_000,
      maxOperations: 10,
      maxEncodedBytes: 1,
    });
    expect(
      await byteLimited.put("room", operation, {
        mapVersion: 4,
        connected: false,
        recordedAt: 10,
        recovery,
      }),
    ).toMatchObject({ status: "detach" });
  });

  it("clears only acknowledged pending rows and leaves a detached copy intact", async () => {
    const { operation, recovery } = fixture();
    const outbox = new IndexedDbCollaborationOutbox({
      graceMilliseconds: 0,
      maxOperations: 10,
      maxEncodedBytes: 1_000_000,
    });
    await outbox.put("room", operation, {
      mapVersion: 4,
      connected: false,
      recordedAt: 10,
      recovery,
    });
    const decision = await outbox.inspect("room", 11);
    if (decision.status !== "detach") throw new Error("Expected detachment");
    const copy = await outbox.detach("room", decision.reason, 11);

    await outbox.acknowledge("room", operation.operationId, 5);

    expect(await outbox.pending("room")).toEqual([]);
    expect(await outbox.loadDetached(copy!.id)).not.toBeNull();
  });

  it("retains independent local copies instead of silently expiring user-authored work", async () => {
    const limits = {
      graceMilliseconds: 1_000,
      maxOperations: 0,
      maxEncodedBytes: 1_000_000,
    };
    const outbox = new IndexedDbCollaborationOutbox(limits);
    const first = fixture("first-room");
    await outbox.put("first-room", first.operation, {
      mapVersion: 4,
      connected: false,
      recordedAt: 10,
      recovery: first.recovery,
    });
    const firstCopy = await outbox.detach("first-room", "First expired", 10);

    const second = fixture("second-room");
    await outbox.put("second-room", second.operation, {
      mapVersion: 4,
      connected: false,
      recordedAt: 20,
      recovery: second.recovery,
    });
    const secondCopy = await outbox.detach("second-room", "Second expired", 20);

    expect((await outbox.listDetached()).map(({ id }) => id)).toEqual([
      secondCopy!.id,
      firstCopy!.id,
    ]);
    expect(await outbox.loadDetached(firstCopy!.id)).not.toBeNull();
  });
});
