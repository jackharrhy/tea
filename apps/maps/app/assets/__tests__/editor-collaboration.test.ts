import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyCollaborationOperation,
  brushVertices,
  createBoxBrush,
  createObjectSelection,
  createSequentialIdFactory,
  createStarterDocument,
  deriveBrush,
  deriveEditorGroups,
  deriveEditorLayers,
  EditorSession,
  insertBrush,
  rebaseMapSource,
  serializeMap,
  selectedBrushIds,
} from "@tea/maps-editor/core";
import {
  CollaborationController,
  EditorCollaborationBridge,
  CollaborationSocketClient,
  IndexedDbCollaborationOutbox,
  reconcilePendingOperations,
  type CollaborationChannel,
  type CollaborationSocket,
} from "../editor-collaboration.ts";
import { deleteEditorDatabase } from "../editor-collaboration-database.ts";
import { createEditorClipboard } from "../editor-clipboard.ts";

beforeEach(deleteEditorDatabase);
afterEach(deleteEditorDatabase);

function channel(publish: (message: unknown) => void): CollaborationChannel {
  return {
    publish,
    addEventListener: () => {},
    close: () => {},
  } as CollaborationChannel;
}

describe("CollaborationController", () => {
  it("replays a vertex move as a hosted brush edit", async () => {
    const controller = new CollaborationController({
      mapId: "topology",
      actorId: "alice",
      outbox: new IndexedDbCollaborationOutbox(),
      channel: channel(() => {}),
      createId: () => crypto.randomUUID(),
    });
    const session = new EditorSession(createStarterDocument());
    const brush = session.document.entities[0]!.primitives[1]!;
    if (brush.kind !== "brush") throw new Error("Expected a starter brush");
    session.selectBrush(brush.id);
    const before = session.document;
    const candidate = session.createBrushSetVertexMoveCandidate(
      [brush.id],
      [brushVertices(brush)[0]!],
      [16, 0, 0],
      createSequentialIdFactory("hosted-vertex"),
      true,
    )!;
    session.commitCandidate(candidate);
    const operation = await controller.recordCommit(
      candidate.label,
      before,
      session.document,
    );
    expect(operation).not.toBeNull();
    const replay = applyCollaborationOperation(before, operation!);
    expect(replay.status).toBe("applied");
    if (replay.status === "applied")
      expect(serializeMap(replay.document)).toBe(
        serializeMap(session.document),
      );
    controller.close();
  });

  it("replays a multi-segment face sweep as one hosted operation", async () => {
    const controller = new CollaborationController({
      mapId: "sweeps",
      actorId: "alice",
      outbox: new IndexedDbCollaborationOutbox(),
      channel: channel(() => {}),
      createId: () => crypto.randomUUID(),
    });
    const session = new EditorSession(createStarterDocument());
    const brush = session.document.entities[0]!.primitives[1]!;
    if (brush.kind !== "brush") throw new Error("Expected a starter brush");
    const face = deriveBrush(brush).faces.find(
      ({ normal }) => normal[2] > 0.9,
    )!;
    const before = session.document;
    const candidate = session.createSweepCandidate(
      [{ brushId: brush.id, faceId: face.faceId }],
      { translation: [0, 0, 64], rotationDegrees: [0, 0, 0], scale: 1 },
      {
        path: "straight",
        segments: 2,
        iterations: 1,
        snapToInteger: false,
        textureLock: true,
      },
      createSequentialIdFactory("hosted-sweep"),
    )!;
    expect(candidate.insertions).toHaveLength(2);
    session.commitBatchCreationCandidate(candidate);
    const operation = await controller.recordCommit(
      candidate.label,
      before,
      session.document,
    );
    expect(operation).not.toBeNull();
    const replay = applyCollaborationOperation(before, operation!);
    expect(replay.status).toBe("applied");
    if (replay.status === "applied")
      expect(serializeMap(replay.document)).toBe(
        serializeMap(session.document),
      );
    controller.close();
  });

  it("replays a multi-brush split as one hosted operation", async () => {
    const controller = new CollaborationController({
      mapId: "clips",
      actorId: "alice",
      outbox: new IndexedDbCollaborationOutbox(),
      channel: channel(() => {}),
      createId: () => crypto.randomUUID(),
    });
    const session = new EditorSession(createStarterDocument());
    const brushes = session.document.entities[0]!.primitives;
    session.selectBrush(brushes[1]!.id);
    session.selectBrush(brushes[2]!.id, true);
    const before = session.document;
    const candidate = session.createBrushSetClipCandidate(
      selectedBrushIds(session.selection),
      [
        [0, 0, 0],
        [16, 0, 0],
        [0, 0, 16],
      ],
      "split",
      createSequentialIdFactory("hosted-clip"),
    )!;
    session.commitClipCandidate(candidate);
    const operation = await controller.recordCommit(
      candidate.label,
      before,
      session.document,
    );
    expect(operation).not.toBeNull();
    const replay = applyCollaborationOperation(before, operation!);
    expect(replay.status).toBe("applied");
    if (replay.status === "applied") {
      expect(serializeMap(replay.document)).toBe(
        serializeMap(session.document),
      );
    }
    controller.close();
  });

  it("replays shear and mirror transforms for mixed selections", async () => {
    const controller = new CollaborationController({
      mapId: "transforms",
      actorId: "alice",
      outbox: new IndexedDbCollaborationOutbox(),
      channel: channel(() => {}),
      createId: () => crypto.randomUUID(),
    });
    const session = new EditorSession(createStarterDocument());
    const brushId = session.document.entities[0]!.primitives[0]!.id;
    const pointId = session.document.entities[1]!.id;
    session.select(createObjectSelection([brushId], [pointId]));
    let replay = session.document;
    for (const [label, transform] of [
      [
        "Shear objects",
        () => session.shearSelected([-128, -128, -32], 2, 0, 0.25),
      ],
      ["Flip objects", () => session.flipSelected([0, 0, 0], 1)],
    ] as const) {
      const before = session.document;
      expect(transform()).toBe(true);
      const operation = await controller.recordCommit(
        label,
        before,
        session.document,
      );
      expect(operation).not.toBeNull();
      const result = applyCollaborationOperation(replay, operation!);
      expect(result.status).toBe("applied");
      if (result.status === "applied") replay = result.document;
      expect(serializeMap(replay)).toBe(serializeMap(session.document));
    }
    controller.close();
  });

  it("replays linked group duplication and unlinking", async () => {
    const controller = new CollaborationController({
      mapId: "linked-groups",
      actorId: "alice",
      outbox: new IndexedDbCollaborationOutbox(),
      channel: channel(() => {}),
      createId: () => crypto.randomUUID(),
    });
    const session = new EditorSession(createStarterDocument());
    session.selectBrush(session.document.entities[0]!.primitives[0]!.id);
    session.groupSelected("Linked", createSequentialIdFactory("linked-group"));
    let replay = session.document;
    const beforeDuplicate = session.document;
    const duplicateId = session.linkedDuplicateSelected(
      createSequentialIdFactory("linked-copy"),
      [16, 16, 0],
    )!;
    const duplicateOperation = await controller.recordCommit(
      "Create linked duplicate",
      beforeDuplicate,
      session.document,
    );
    expect(duplicateOperation).not.toBeNull();
    const duplicated = applyCollaborationOperation(replay, duplicateOperation!);
    expect(duplicated.status).toBe("applied");
    if (duplicated.status === "applied") replay = duplicated.document;
    const linked = deriveEditorGroups(replay);
    expect(linked).toHaveLength(2);
    expect(new Set(linked.map((group) => group.linkedGroupId)).size).toBe(1);

    const beforeUnlink = session.document;
    session.unlinkGroup(duplicateId);
    const unlinkOperation = await controller.recordCommit(
      "Unlink group",
      beforeUnlink,
      session.document,
    );
    expect(unlinkOperation).not.toBeNull();
    const unlinked = applyCollaborationOperation(replay, unlinkOperation!);
    expect(unlinked.status).toBe("applied");
    if (unlinked.status === "applied") {
      expect(
        deriveEditorGroups(unlinked.document).every(
          (group) => group.linkedGroupId === null,
        ),
      ).toBe(true);
    }
    controller.close();
  });

  it("replays an issue repair as a hosted operation", async () => {
    const controller = new CollaborationController({
      mapId: "issues",
      actorId: "alice",
      outbox: new IndexedDbCollaborationOutbox(),
      channel: channel(() => {}),
      createId: () => "repair",
    });
    const session = new EditorSession(createStarterDocument());
    session.createLayer(
      "Empty",
      createSequentialIdFactory("hosted-issue-layer"),
    );
    const before = session.document;
    const issue = session.issues.find(({ type }) => type === "empty-layer")!;
    expect(session.fixIssue(issue.id)).toBe(true);
    const operation = await controller.recordCommit(
      "Delete empty layer",
      before,
      session.document,
    );
    expect(operation).not.toBeNull();
    const replay = applyCollaborationOperation(before, operation!);
    expect(replay.status).toBe("applied");
    if (replay.status === "applied") {
      expect(deriveEditorLayers(replay.document)).toHaveLength(1);
    }
    controller.close();
  });

  it("replays layer creation, object moves, flags, and removal", async () => {
    const controller = new CollaborationController({
      mapId: "layers",
      actorId: "alice",
      outbox: new IndexedDbCollaborationOutbox(),
      channel: channel(() => {}),
      createId: () => crypto.randomUUID(),
    });
    const session = new EditorSession(createStarterDocument());
    let replay = session.document;
    const commit = async (label: string, before: typeof replay) => {
      const operation = await controller.recordCommit(
        label,
        before,
        session.document,
      );
      expect(operation).not.toBeNull();
      const result = applyCollaborationOperation(replay, operation!);
      expect(result.status).toBe("applied");
      if (result.status === "applied") replay = result.document;
    };

    let before = session.document;
    const layerId = session.createLayer(
      "Gameplay",
      createSequentialIdFactory("hosted-layer"),
    );
    await commit("Create layer", before);
    expect(deriveEditorLayers(replay).map((layer) => layer.name)).toContain(
      "Gameplay",
    );

    const brushId = session.document.entities[0]!.primitives[0]!.id;
    session.selectBrush(brushId);
    before = session.document;
    session.moveSelectedToLayer(layerId);
    await commit("Move objects to layer", before);
    expect(
      deriveEditorLayers(replay).find((layer) => layer.id === layerId)
        ?.brushIds,
    ).toContain(brushId);

    before = session.document;
    session.setLayerFlag(layerId, "omit-from-export", true);
    await commit("Enable layer omit-from-export", before);
    expect(
      deriveEditorLayers(replay).find((layer) => layer.id === layerId)
        ?.omitFromExport,
    ).toBe(true);

    before = session.document;
    session.removeLayer(layerId);
    await commit("Remove layer", before);
    expect(deriveEditorLayers(replay)).toHaveLength(1);
    expect(deriveEditorLayers(replay)[0]!.brushIds).toContain(brushId);
    controller.close();
  });

  it("replays group creation, rename, and ungroup over a hosted map", async () => {
    const controller = new CollaborationController({
      mapId: "groups",
      actorId: "alice",
      outbox: new IndexedDbCollaborationOutbox(),
      channel: channel(() => {}),
      createId: () => crypto.randomUUID(),
    });
    const session = new EditorSession(createStarterDocument());
    const brush = session.document.entities[0]!.primitives[0]!;
    session.selectBrush(brush.id);
    let replay = session.document;
    const commit = async (label: string, before: typeof replay) => {
      const operation = await controller.recordCommit(
        label,
        before,
        session.document,
      );
      expect(operation).not.toBeNull();
      const result = applyCollaborationOperation(replay, operation!);
      expect(result.status).toBe("applied");
      if (result.status === "applied") replay = result.document;
    };
    let before = session.document;
    const groupId = session.groupSelected(
      "Door",
      createSequentialIdFactory("hosted-group"),
    )!;
    await commit("Group objects", before);
    expect(deriveEditorGroups(replay)[0]?.name).toBe("Door");

    before = session.document;
    session.renameGroup(groupId, "Gate");
    await commit("Rename group", before);
    expect(deriveEditorGroups(replay)[0]?.name).toBe("Gate");

    before = session.document;
    session.ungroupSelected(groupId);
    await commit("Ungroup objects", before);
    expect(deriveEditorGroups(replay)).toHaveLength(0);
    controller.close();
  });

  it("reapplies offline operations over a canonical snapshot and reports stale edits", () => {
    const before = createStarterDocument();
    const brush = createBoxBrush(
      [0, 0, 0],
      [64, 64, 64],
      "STONE",
      createSequentialIdFactory("reconcile"),
    );
    const after = insertBrush(before, before.entities[0]!.id, brush);
    const operation = {
      schemaVersion: 1,
      operationId: "alice:offline",
      transactionId: "alice:offline",
      actorId: "alice",
      baseMapVersion: 0,
      label: "Offline edit",
      edits: [
        {
          kind: "insert-brush",
          entityId: before.entities[0]!.id,
          insertionIndex: before.entities[0]!.primitives.length,
          brush,
        },
      ],
    } as const;
    expect(reconcilePendingOperations(before, [operation])).toMatchObject({
      document: after,
      conflicts: [],
    });
    expect(reconcilePendingOperations(after, [operation])).toMatchObject({
      document: after,
      conflicts: [{ operationId: operation.operationId }],
    });
  });

  it("persists before broadcasting and clears only acknowledged operations", async () => {
    const outbox = new IndexedDbCollaborationOutbox();
    const broadcast = vi.fn();
    const controller = new CollaborationController({
      mapId: "room",
      actorId: "alice",
      outbox,
      channel: channel(broadcast),
      createId: () => "fixed",
    });
    const ids = createSequentialIdFactory("outbox");
    const before = createStarterDocument();
    const after = insertBrush(
      before,
      before.entities[0]!.id,
      createBoxBrush([0, 0, 0], [64, 64, 64], "STONE", ids),
    );
    const operation = await controller.recordCommit(
      "Create brush",
      before,
      after,
    );

    expect(operation?.operationId).toBe("alice:1:fixed");
    expect(
      (await controller.pending()).map((pending) => pending.operationId),
    ).toEqual(["alice:1:fixed"]);
    expect(broadcast).toHaveBeenCalledWith(operation);
    await controller.acknowledge(operation!.operationId, 1);
    expect(await controller.pending()).toEqual([]);
  });

  it("detaches an over-limit offline commit before broadcasting it", async () => {
    const outbox = new IndexedDbCollaborationOutbox({
      graceMilliseconds: 1_000,
      maxOperations: 0,
      maxEncodedBytes: 1_000_000,
    });
    const broadcast = vi.fn();
    const detached = vi.fn();
    const before = createStarterDocument();
    const after = insertBrush(
      before,
      before.entities[0]!.id,
      createBoxBrush(
        [0, 0, 0],
        [64, 64, 64],
        "STONE",
        createSequentialIdFactory("detach"),
      ),
    );
    const controller = new CollaborationController({
      mapId: "room",
      actorId: "alice",
      outbox,
      channel: channel(broadcast),
      createId: () => "fixed",
      now: () => 100,
      captureRecovery: (document, mapVersion) => ({
        version: 1,
        mapId: "room",
        documentKey: "hosted-map:room",
        fileName: "detached.map",
        profile: "quake",
        document,
        source: rebaseMapSource(document, serializeMap(document)),
        savedDocumentRevision: before.revision,
        mapVersion,
        updatedAt: 100,
      }),
      onDetached: detached,
    });

    await controller.recordCommit("Offline edit", before, after);

    expect(broadcast).not.toHaveBeenCalled();
    expect(await controller.pending()).toEqual([]);
    expect(detached).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: "detached.map",
        document: after,
        operationCount: 1,
      }),
    );
  });

  it("never broadcasts an operation when durable outbox storage rejects it", async () => {
    const outbox = new IndexedDbCollaborationOutbox();
    vi.spyOn(outbox, "put").mockRejectedValueOnce(
      new DOMException("quota full", "QuotaExceededError"),
    );
    const broadcast = vi.fn();
    const controller = new CollaborationController({
      mapId: "room",
      actorId: "alice",
      outbox,
      channel: channel(broadcast),
    });
    const before = createStarterDocument();
    const after = insertBrush(
      before,
      before.entities[0]!.id,
      createBoxBrush(
        [0, 0, 0],
        [64, 64, 64],
        "STONE",
        createSequentialIdFactory("quota"),
      ),
    );

    await expect(
      controller.recordCommit("Offline edit", before, after),
    ).rejects.toMatchObject({
      name: "QuotaExceededError",
    });
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("flushes the offline outbox on ready, handles ack/remote frames, and reconnects", async () => {
    const listeners = new Map<string, (event?: MessageEvent<string>) => void>();
    const sent: string[] = [];
    const socket: CollaborationSocket = {
      readyState: 1,
      addEventListener: (
        type: string,
        listener: (event?: MessageEvent<string>) => void,
      ) => listeners.set(type, listener),
      send: (data) => sent.push(data),
      close: vi.fn(),
    } as CollaborationSocket;
    const outbox = new IndexedDbCollaborationOutbox();
    const peers = vi.fn();
    const controller = new CollaborationController({
      mapId: "room",
      actorId: "alice",
      outbox,
      channel: channel(() => {}),
      createId: () => "fixed",
      onPeerOperation: peers,
    });
    const before = createStarterDocument();
    const ids = createSequentialIdFactory("socket");
    const after = insertBrush(
      before,
      before.entities[0]!.id,
      createBoxBrush([0, 0, 0], [64, 64, 64], "STONE", ids),
    );
    const queued = await controller.recordCommit("Offline edit", before, after);
    let reconnect: (() => void) | null = null;
    let finishReconciliation: (() => void) | null = null;
    const client = new CollaborationSocketClient({
      endpoint: "ws://localhost:8787",
      mapId: "room",
      actorId: "alice",
      controller,
      createSocket: () => socket,
      scheduleReconnect: (callback) => {
        reconnect = callback;
        return 1;
      },
      cancelReconnect: () => {},
      onReady: () =>
        new Promise<void>((resolve) => {
          finishReconciliation = resolve;
        }),
    });
    client.connect();
    listeners.get("message")?.({
      data: JSON.stringify({
        type: "ready",
        mapId: "room",
        mapVersion: 0,
        document: before,
        source: serializeMap(before),
        sourceSha256: "a".repeat(64),
      }),
    } as MessageEvent<string>);
    await vi.waitFor(() => expect(finishReconciliation).not.toBeNull());
    expect(sent).toHaveLength(0);
    listeners.get("message")?.({
      data: JSON.stringify({
        type: "operation",
        mapVersion: 1,
        sourceSha256: "b".repeat(64),
        operation: queued,
      }),
    } as MessageEvent<string>);
    expect(peers).not.toHaveBeenCalled();
    finishReconciliation!();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await vi.waitFor(() => expect(peers).toHaveBeenCalledWith(queued));
    expect(JSON.parse(sent[0]!).operation.operationId).toBe(
      queued?.operationId,
    );
    listeners.get("message")?.({
      data: JSON.stringify({
        type: "ack",
        mapVersion: 1,
        operationId: queued!.operationId,
        sourceSha256: "b".repeat(64),
      }),
    } as MessageEvent<string>);
    await vi.waitFor(async () =>
      expect(await controller.pending()).toEqual([]),
    );
    const rejected = await controller.recordCommit(
      "Rejected edit",
      before,
      after,
    );
    listeners.get("message")?.({
      data: JSON.stringify({
        type: "conflict",
        operationId: rejected!.operationId,
        conflicts: [],
      }),
    } as MessageEvent<string>);
    await vi.waitFor(async () =>
      expect(await controller.pending()).toEqual([]),
    );
    listeners.get("close")?.();
    expect(reconnect).not.toBeNull();
    client.close();
  });

  it("sends operations committed after the room is ready without waiting for reconnect", async () => {
    const listeners = new Map<string, (event?: MessageEvent<string>) => void>();
    const sent: string[] = [];
    const socket: CollaborationSocket = {
      readyState: 1,
      addEventListener: (
        type: string,
        listener: (event?: MessageEvent<string>) => void,
      ) => listeners.set(type, listener),
      send: (data) => sent.push(data),
      close: vi.fn(),
    } as CollaborationSocket;
    const controller = new CollaborationController({
      mapId: "room",
      actorId: "alice",
      outbox: new IndexedDbCollaborationOutbox(),
      channel: channel(() => {}),
      createId: () => "live",
    });
    const client = new CollaborationSocketClient({
      endpoint: "ws://localhost:8787",
      mapId: "room",
      actorId: "alice",
      controller,
      createSocket: () => socket,
    });
    const before = createStarterDocument();
    client.connect();
    listeners.get("message")?.({
      data: JSON.stringify({
        type: "ready",
        mapId: "room",
        mapVersion: 0,
        document: before,
        source: serializeMap(before),
        sourceSha256: "a".repeat(64),
      }),
    } as MessageEvent<string>);
    await vi.waitFor(() => expect(sent).toHaveLength(0));

    const ids = createSequentialIdFactory("live");
    const after = insertBrush(
      before,
      before.entities[0]!.id,
      createBoxBrush([0, 0, 0], [64, 64, 64], "STONE", ids),
    );
    const operation = await controller.recordCommit("Live edit", before, after);

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(JSON.parse(sent[0]!).operation.operationId).toBe(
      operation?.operationId,
    );
    client.close();
  });

  it("fails a room handshake closed when its durable connected transition rejects", async () => {
    const listeners = new Map<string, (event?: MessageEvent<string>) => void>();
    const close = vi.fn();
    const socket: CollaborationSocket = {
      readyState: 1,
      addEventListener: (
        type: string,
        listener: (event?: MessageEvent<string>) => void,
      ) => listeners.set(type, listener),
      send: vi.fn(),
      close,
    } as CollaborationSocket;
    const outbox = new IndexedDbCollaborationOutbox();
    vi.spyOn(outbox, "connectionChanged").mockRejectedValueOnce(
      new DOMException("quota full", "QuotaExceededError"),
    );
    const onError = vi.fn();
    const controller = new CollaborationController({
      mapId: "room",
      actorId: "alice",
      outbox,
      channel: channel(() => {}),
      createId: () => "offline-after-failure",
      now: () => 50,
    });
    const client = new CollaborationSocketClient({
      endpoint: "ws://localhost:8787",
      mapId: "room",
      actorId: "alice",
      controller,
      createSocket: () => socket,
      onError,
    });
    const before = createStarterDocument();
    client.connect();
    listeners.get("message")?.({
      data: JSON.stringify({
        type: "ready",
        mapId: "room",
        mapVersion: 0,
        document: before,
        source: serializeMap(before),
        sourceSha256: "a".repeat(64),
      }),
    } as MessageEvent<string>);

    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ name: "QuotaExceededError" }),
    );

    const after = insertBrush(
      before,
      before.entities[0]!.id,
      createBoxBrush(
        [0, 0, 0],
        [64, 64, 64],
        "STONE",
        createSequentialIdFactory("offline-after-failure"),
      ),
    );
    await controller.recordCommit(
      "Offline after failed handshake",
      before,
      after,
    );
    expect(await outbox.inspect("room", 50)).toMatchObject({
      status: "replay",
      summary: { dirtySince: 50 },
    });
    client.close();
  });

  it("authorizes the hosted WebSocket URL before opening it", async () => {
    let openedUrl = "";
    const socket: CollaborationSocket = {
      readyState: 1,
      addEventListener: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
    };
    const controller = new CollaborationController({
      mapId: "hosted-map",
      actorId: "alice",
      outbox: new IndexedDbCollaborationOutbox(),
      channel: channel(() => {}),
    });
    const client = new CollaborationSocketClient({
      endpoint: "wss://worldview.example",
      mapId: "hosted-map",
      actorId: "alice",
      authorize: async () => "signed-ticket",
      controller,
      createSocket: (url) => {
        openedUrl = url;
        return socket;
      },
    });

    client.connect();

    await vi.waitFor(() => expect(openedUrl).not.toBe(""));
    expect(new URL(openedUrl).searchParams.get("access_token")).toBe(
      "signed-ticket",
    );
    client.close();
  });

  it("bridges real EditorSession commits while keeping remote commits out of the local outbox", async () => {
    const outbox = new IndexedDbCollaborationOutbox();
    const controller = new CollaborationController({
      mapId: "room",
      actorId: "alice",
      outbox,
      channel: channel(() => {}),
      createId: () => "fixed",
    });
    const session = new EditorSession(createStarterDocument());
    const bridge = new EditorCollaborationBridge(session, controller);
    const ids = createSequentialIdFactory("bridge");
    session.commitCreationCandidate(
      session.createBrushCandidate(
        createBoxBrush([0, 0, 0], [64, 64, 64], "STONE", ids),
      ),
    );
    await vi.waitFor(async () =>
      expect(await controller.pending()).toHaveLength(1),
    );
    const remote = (await controller.pending())[0]!;
    const inverse = await bridge.undo(remote);
    expect(inverse.label).toBe("Undo Create brush");
    expect(session.document.entities[0]!.primitives).toHaveLength(
      createStarterDocument().entities[0]!.primitives.length,
    );
    await controller.acknowledge(inverse.operationId, 2);
    await controller.acknowledge(remote.operationId, 1);
    bridge.receive({
      ...remote,
      operationId: "bob:1",
      transactionId: "bob:1",
      actorId: "bob",
      edits: [],
    });
    expect(await controller.pending()).toEqual([]);
    const synchronized = insertBrush(
      session.document,
      session.document.entities[0]!.id,
      createBoxBrush([128, 0, 0], [192, 64, 64], "STONE", ids),
    );
    bridge.synchronize(() =>
      session.replaceDocument(synchronized, "Hosted reconciliation"),
    );
    expect(session.document).toBe(synchronized);
    expect(await controller.pending()).toEqual([]);
    bridge.close();
  });

  it("persists a hosted paste as one room operation before publishing it", async () => {
    const broadcast = vi.fn();
    const controller = new CollaborationController({
      mapId: "room",
      actorId: "alice",
      outbox: new IndexedDbCollaborationOutbox(),
      channel: channel(broadcast),
      createId: () => "paste",
    });
    const session = new EditorSession(createStarterDocument());
    const bridge = new EditorCollaborationBridge(session, controller);
    session.selectAllEditable();
    const clipboard = createEditorClipboard({
      session: () => session,
      pointer: () => null,
      gridSize: () => 16,
      textureLock: () => true,
      canPaste: () => true,
      hosted: () => true,
      prepare: () => true,
      status: () => {},
    });
    expect(clipboard.pasteText(clipboard.copyText()!, "original")).toBe(true);
    await vi.waitFor(async () =>
      expect(await controller.pending()).toHaveLength(1),
    );
    const [operation] = await controller.pending();
    expect(operation?.edits.some((edit) => edit.kind === "insert-brush")).toBe(
      true,
    );
    expect(operation?.inverseEdits?.length).toBeGreaterThan(0);
    expect(broadcast).toHaveBeenCalledWith(operation);
    bridge.close();
  });

  it("rejects a stale personalized undo before putting it in the outbox", async () => {
    const outbox = new IndexedDbCollaborationOutbox();
    const controller = new CollaborationController({
      mapId: "room",
      actorId: "alice",
      outbox,
      channel: channel(() => {}),
    });
    const session = new EditorSession(createStarterDocument());
    const bridge = new EditorCollaborationBridge(session, controller);
    const brush = createBoxBrush(
      [0, 0, 0],
      [64, 64, 64],
      "STONE",
      createSequentialIdFactory("stale-undo"),
    );
    session.commitCreationCandidate(session.createBrushCandidate(brush));
    await vi.waitFor(async () =>
      expect(await controller.pending()).toHaveLength(1),
    );
    const original = (await controller.pending())[0]!;
    bridge.receive({
      schemaVersion: 1,
      operationId: "bob:remove",
      transactionId: "bob:remove",
      actorId: "bob",
      baseMapVersion: 1,
      label: "Remove brush",
      edits: [{ kind: "delete-brush", brushId: brush.id, baseRevision: 0 }],
    });

    await expect(bridge.undo(original)).rejects.toThrow(
      `Brush ${brush.id} no longer exists`,
    );
    expect(await controller.pending()).toEqual([original]);
    bridge.close();
  });
});
