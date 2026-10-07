import "fake-indexeddb/auto";

import {
  COLLABORATION_SCHEMA_VERSION,
  createBoxBrush,
  createSequentialIdFactory,
  createStarterDocument,
  EditorSession,
  insertBrush,
  rebaseMapSource,
  serializeMap,
} from "@tea/maps-editor/core";
import type { HostedMapLaunch } from "@tea/maps-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deleteEditorDatabase } from "../editor-collaboration-database.ts";
import { IndexedDbCollaborationOutbox } from "../editor-collaboration.ts";
import { connectHostedEditor } from "../editor-hosted-collaboration.ts";

const initialDocument = createStarterDocument();
const initialSource = serializeMap(initialDocument);
const map: HostedMapLaunch = {
  id: "map-1",
  mapId: "map-1",
  mapVersion: 0,
  document: initialDocument,
  source: initialSource,
  sourceSha256: "a".repeat(64),
  slug: "test-map",
  projectId: "project-1",
  projectSlug: "project",
  projectName: "Project",
  game: "quake",
  name: "Test map",
  format: "quake",
  role: "editor",
  actorId: "member-1",
  displayName: "Member",
};

class TestSocket {
  static current: TestSocket | null = null;
  readyState = 1;
  sent: string[] = [];
  listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();

  constructor(readonly url: string) {
    TestSocket.current = this;
  }

  addEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }

  receive(value: unknown) {
    for (const listener of this.listeners.get("message") ?? []) {
      listener({ data: JSON.stringify(value) } as MessageEvent<string>);
    }
  }
}

beforeEach(async () => {
  await deleteEditorDatabase();
  vi.stubGlobal("location", { href: "https://maps.example.test/editor" });
  vi.stubGlobal("WebSocket", TestSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/realtime-ticket")) {
        expect(init?.method).toBe("POST");
        return Response.json({
          ticket: "signed-ticket",
          expiresAt: Date.now() + 60_000,
          actorId: map.actorId,
          displayName: map.displayName,
        });
      }
      expect(url).toBe("/sync/maps/map-1/snapshot");
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer signed-ticket",
      );
      return Response.json({
        mapId: map.id,
        mapVersion: 0,
        document: initialDocument,
        source: initialSource,
        sourceSha256: map.sourceSha256,
      });
    }),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  TestSocket.current = null;
  await deleteEditorDatabase();
});

describe("hosted editor room", () => {
  it("persists a semantic edit before sending it through the same-origin socket", async () => {
    const session = new EditorSession(initialDocument);
    const updates: string[] = [];
    const presence = vi.fn();
    const connection = await connectHostedEditor(map, session, {
      update(_document, source) {
        updates.push(source);
      },
      status: () => {},
      presence,
      history: () => {},
      detached: () => {},
      failure(error) {
        throw error;
      },
    });
    expect(connection).not.toBeNull();
    await vi.waitFor(() => expect(TestSocket.current).not.toBeNull());
    const socket = TestSocket.current!;
    expect(socket.url).toContain(
      "wss://maps.example.test/sync/maps/map-1/live",
    );
    expect(socket.url).toContain("access_token=signed-ticket");
    socket.receive({
      type: "ready",
      mapId: map.id,
      mapVersion: 0,
      document: initialDocument,
      source: initialSource,
      sourceSha256: map.sourceSha256,
    });
    socket.receive({
      type: "presence",
      presence: {
        actorId: "peer-1",
        displayName: "Peer",
        color: "blue",
        selectedObjectIds: [],
        sentAt: Date.now(),
      },
    });
    await vi.waitFor(() =>
      expect(presence).toHaveBeenCalledWith([
        expect.objectContaining({ actorId: "peer-1" }),
      ]),
    );
    connection!.publishPointer({
      viewport: "xy",
      point: [16, 32, 0],
      surfaceNormal: null,
    });
    const brush = createBoxBrush(
      [0, 0, 0],
      [64, 64, 64],
      "STONE",
      createSequentialIdFactory("hosted"),
    );
    session.commitCreationCandidate(session.createBrushCandidate(brush));

    await vi.waitFor(() =>
      expect(
        socket.sent.filter((value) => JSON.parse(value).type === "operation"),
      ).toHaveLength(1),
    );
    await vi.waitFor(() =>
      expect(
        socket.sent.some((value) => {
          const frame = JSON.parse(value);
          return frame.type === "presence" && frame.presence?.viewport === "xy";
        }),
      ).toBe(true),
    );
    const serializedOperation = socket.sent.find(
      (value) => JSON.parse(value).type === "operation",
    )!;
    const frame = JSON.parse(serializedOperation) as {
      type: string;
      operation: { schemaVersion: number; edits: unknown[] };
    };
    expect(frame.type).toBe("operation");
    expect(frame.operation.schemaVersion).toBe(COLLABORATION_SCHEMA_VERSION);
    expect(frame.operation.edits).toHaveLength(1);
    expect(await connection!.pending()).toBe(true);
    expect(updates.at(-1)).toContain("STONE");
    expect(connection!.canUndo()).toBe(true);
    await connection!.undo();
    expect(session.document.entities[0]!.primitives).toHaveLength(
      initialDocument.entities[0]!.primitives.length,
    );
    expect(connection!.canRedo()).toBe(true);
    await connection!.redo();
    expect(session.document.entities[0]!.primitives).toHaveLength(
      initialDocument.entities[0]!.primitives.length + 1,
    );
    expect(
      socket.sent.filter((value) => JSON.parse(value).type === "operation"),
    ).toHaveLength(3);
    connection!.close();
    expect(presence).toHaveBeenLastCalledWith([]);
  });

  it("opens an expired queued edit as a local recovery copy before joining", async () => {
    const brush = createBoxBrush(
      [0, 0, 0],
      [64, 64, 64],
      "STONE",
      createSequentialIdFactory("expired"),
    );
    const edited = insertBrush(
      initialDocument,
      initialDocument.entities[0]!.id,
      brush,
    );
    const outbox = new IndexedDbCollaborationOutbox();
    await outbox.put(
      map.id,
      {
        schemaVersion: COLLABORATION_SCHEMA_VERSION,
        operationId: "expired:1",
        transactionId: "expired:1",
        actorId: map.actorId,
        baseMapVersion: 0,
        label: "Expired edit",
        edits: [
          {
            kind: "insert-brush",
            entityId: initialDocument.entities[0]!.id,
            insertionIndex: initialDocument.entities[0]!.primitives.length,
            brush,
          },
        ],
      },
      {
        mapVersion: 0,
        connected: false,
        recordedAt: 1,
        recovery: {
          version: 1,
          mapId: map.id,
          documentKey: `tea-maps-hosted:${map.id}`,
          fileName: "test-map.map",
          profile: "quake",
          document: edited,
          source: rebaseMapSource(edited, serializeMap(edited)),
          savedDocumentRevision: initialDocument.revision,
          mapVersion: 0,
          updatedAt: 1,
        },
      },
    );
    const detached = vi.fn();
    const connection = await connectHostedEditor(
      map,
      new EditorSession(initialDocument),
      {
        update: () => {},
        status: () => {},
        presence: () => {},
        history: () => {},
        detached,
        failure: () => {},
      },
    );

    expect(connection).toBeNull();
    expect(detached).toHaveBeenCalledWith(
      expect.objectContaining({ document: edited, operationCount: 1 }),
    );
    expect(await outbox.pending(map.id)).toEqual([]);
    expect(await outbox.listDetached()).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
