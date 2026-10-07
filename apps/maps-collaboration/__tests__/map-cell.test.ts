import { env } from "cloudflare:workers";
import { createHmac } from "node:crypto";
import { evictDurableObject, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  collaborationEditsBetween,
  createBoxBrush,
  createSequentialIdFactory,
  createStarterDocument,
  insertBrush,
  insertEntity,
  serializeMap,
  translateBrush,
  type CollaborationOperation,
  type MapDocument,
} from "@tea/maps-editor/core";
import type { MapCell } from "../src/map-cell.js";

function hostedTicket(
  mapId: string,
  role: "owner" | "editor" | "viewer" = "editor",
) {
  const header = Buffer.from(
    JSON.stringify({ algorithm: "HS256", type: "WVT" }),
  ).toString("base64url");
  const content = Buffer.from(
    JSON.stringify({
      version: 2,
      mapId,
      principalId: "user-1",
      actorId: "user-1",
      role,
      expiresAt: Date.now() + 60_000,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", env.TEA_MAPS_REALTIME_TICKET_SECRET)
    .update(`${header}.${content}`)
    .digest("base64url");
  return `${header}.${content}.${signature}`;
}

function operation(
  before: ReturnType<typeof createStarterDocument>,
  after: ReturnType<typeof createStarterDocument>,
): CollaborationOperation {
  return {
    schemaVersion: 1,
    operationId: "alice:1",
    transactionId: "alice:1",
    actorId: "alice",
    baseMapVersion: 0,
    label: "Edit map",
    edits: collaborationEditsBetween(before, after),
  };
}

function nextSocketFrame(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    socket.addEventListener(
      "message",
      (event) => resolve(JSON.parse(String(event.data)) as unknown),
      { once: true },
    );
  });
}

describe("MapCell", () => {
  it("checkpoints the old source and rejects a stale project sync push", async () => {
    const mapId = "project-sync-cell";
    const cell = env.MAP_CELLS.getByName(mapId);
    const original = serializeMap(createStarterDocument());
    const first = await cell.initialize(mapId, original);
    const changed = `${original}\n// edited on disk\n`;
    const replaced = await cell.replaceSource(
      mapId,
      "user-1",
      first.mapVersion,
      first.sourceSha256,
      changed,
    );
    expect(replaced).toMatchObject({
      status: "replaced",
      map: { mapVersion: 1, source: changed },
    });
    expect(await cell.listCheckpoints()).toMatchObject([
      { name: "Before project sync", mapVersion: 0 },
    ]);
    const checkpointId = (await cell.listCheckpoints())[0]!.id;
    expect(await cell.checkpointSource(checkpointId)).toMatchObject({
      checkpoint: { mapVersion: 0 },
      source: original,
    });
    const checkpointResponse = await SELF.fetch(
      `https://map.test/sync/maps/${mapId}/checkpoints/${checkpointId}`,
      { headers: { Authorization: `Bearer ${hostedTicket(mapId, "viewer")}` } },
    );
    expect(checkpointResponse.status).toBe(200);
    expect(await checkpointResponse.json()).toMatchObject({ source: original });
    expect(
      (
        await SELF.fetch(
          `https://map.test/sync/maps/${mapId}/checkpoints/${checkpointId}`,
        )
      ).status,
    ).toBe(401);
    const stale = await cell.replaceSource(
      mapId,
      "user-1",
      first.mapVersion,
      first.sourceSha256,
      original,
    );
    expect(stale).toMatchObject({ status: "conflict", mapVersion: 1 });
    expect((await cell.snapshot(mapId)).source).toBe(changed);
  });
  it("requires signed map access and initializes one canonical snapshot", async () => {
    const mapId = "map-auth";
    const preflight = await SELF.fetch(
      `https://map.test/sync/maps/${mapId}/initialize`,
      {
        method: "OPTIONS",
        headers: { Origin: "https://editor.test" },
      },
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toContain(
      "POST",
    );
    expect(
      (await SELF.fetch(`https://map.test/sync/maps/${mapId}/snapshot`)).status,
    ).toBe(401);
    const source = serializeMap(createStarterDocument());
    expect(
      (
        await SELF.fetch(`https://map.test/sync/maps/${mapId}/initialize`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${hostedTicket("another-map")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ source }),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await SELF.fetch(`https://map.test/sync/maps/${mapId}/initialize`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${hostedTicket(mapId, "viewer")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ source }),
        })
      ).status,
    ).toBe(403);
    const initialized = await SELF.fetch(
      `https://map.test/sync/maps/${mapId}/initialize`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${hostedTicket(mapId)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ source }),
      },
    );
    expect(initialized.status).toBe(200);
    expect(await initialized.json()).toMatchObject({
      mapId,
      mapVersion: 0,
      source,
    });
    const snapshot = await SELF.fetch(
      `https://map.test/sync/maps/${mapId}/snapshot`,
      {
        headers: { Authorization: `Bearer ${hostedTicket(mapId)}` },
      },
    );
    expect(await snapshot.json()).toMatchObject({
      mapId,
      mapVersion: 0,
      source,
    });
  });

  it("lets viewers observe a live room without accepting their durable edits", async () => {
    const mapId = "viewer-room";
    const cell = env.MAP_CELLS.getByName(mapId);
    const initial = createStarterDocument();
    await cell.initialize(mapId, serializeMap(initial));
    const after = insertBrush(
      initial,
      initial.entities[0]!.id,
      createBoxBrush(
        [0, 0, 0],
        [64, 64, 64],
        "STONE",
        createSequentialIdFactory("viewer"),
      ),
    );
    const response = await cell.fetch(
      new Request(
        `https://map.test/live?map=${mapId}&actor=viewer&role=viewer`,
        {
          headers: { Upgrade: "websocket" },
        },
      ),
    );
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    if (!socket) throw new Error("MapCell did not return a WebSocket");
    socket.accept();
    expect(await nextSocketFrame(socket)).toMatchObject({
      type: "ready",
      mapVersion: 0,
    });
    const rejected = nextSocketFrame(socket);
    socket.send(
      JSON.stringify({
        type: "operation",
        operation: operation(initial, after),
      }),
    );
    await expect(rejected).resolves.toMatchObject({
      type: "error",
      message: "Viewer connections cannot edit maps",
    });
    expect(await cell.snapshot(mapId)).toMatchObject({ mapVersion: 0 });
    socket.close(1000, "test complete");
  });

  it("atomically advances document, source, hash, receipt, and version", async () => {
    const mapId = "atomic";
    const cell = env.MAP_CELLS.getByName(mapId);
    const initial = createStarterDocument();
    await cell.initialize(mapId, serializeMap(initial));
    const starter = (await cell.snapshot(mapId))
      .document as unknown as MapDocument;
    const ids = createSequentialIdFactory("atomic");
    const after = insertBrush(
      starter,
      starter.entities[0]!.id,
      createBoxBrush([0, 0, 0], [64, 64, 64], "STONE", ids),
    );
    const edit = operation(starter, after);
    expect(await cell.submit("alice", edit)).toMatchObject({
      type: "ack",
      operationId: edit.operationId,
      mapVersion: 1,
      sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const snapshot = await cell.snapshot(mapId);
    expect(snapshot.mapVersion).toBe(1);
    expect(snapshot.document.entities[0]!.primitives).toHaveLength(
      after.entities[0]!.primitives.length,
    );
    expect(snapshot.source).toContain("STONE");
    const originalAck = await cell.submit("alice", edit);
    expect(originalAck).toMatchObject({ type: "ack", mapVersion: 1 });
    if (originalAck.type !== "ack")
      throw new Error("Expected an acknowledgement");
    const secondDocument = insertBrush(
      after,
      after.entities[0]!.id,
      createBoxBrush([128, 0, 0], [192, 64, 64], "METAL", ids),
    );
    const secondEdit = {
      ...operation(after, secondDocument),
      operationId: "alice:2",
      transactionId: "alice:2",
      baseMapVersion: 1,
    };
    expect(await cell.submit("alice", secondEdit)).toMatchObject({
      type: "ack",
      mapVersion: 2,
    });
    expect(await cell.submit("alice", edit)).toEqual(originalAck);
    await runInDurableObject(cell, (_instance: MapCell, state) => {
      expect(
        state.storage.sql.exec("SELECT * FROM operation_receipts").toArray(),
      ).toHaveLength(2);
      expect(
        state.storage.sql.exec("SELECT * FROM operations").toArray(),
      ).toHaveLength(2);
    });
  });

  it("persists created point entities in the authoritative document and map source", async () => {
    const mapId = "point-entity";
    const cell = env.MAP_CELLS.getByName(mapId);
    const initial = createStarterDocument();
    await cell.initialize(mapId, serializeMap(initial));
    const starter = (await cell.snapshot(mapId))
      .document as unknown as MapDocument;
    const light = {
      id: createSequentialIdFactory("point-entity").entity(),
      properties: { classname: "light", origin: "64 64 64", light: "300" },
      primitives: [],
    };
    const after = insertEntity(starter, light);

    expect(await cell.submit("alice", operation(starter, after))).toMatchObject(
      {
        type: "ack",
        mapVersion: 1,
      },
    );
    const snapshot = await cell.snapshot(mapId);
    expect(snapshot.document.entities).toContainEqual(light);
    expect(snapshot.source).toContain('"classname" "light"');
    expect(snapshot.source).toContain('"origin" "64 64 64"');
  });

  it("deduplicates concurrent retries before applying geometry twice", async () => {
    const mapId = "concurrent-retry";
    const cell = env.MAP_CELLS.getByName(mapId);
    const initial = createStarterDocument();
    await cell.initialize(mapId, serializeMap(initial));
    const starter = (await cell.snapshot(mapId))
      .document as unknown as MapDocument;
    const after = insertBrush(
      starter,
      starter.entities[0]!.id,
      createBoxBrush(
        [0, 0, 0],
        [64, 64, 64],
        "STONE",
        createSequentialIdFactory("concurrent"),
      ),
    );
    const edit = operation(starter, after);
    const acknowledgements = await Promise.all([
      cell.submit("alice", edit),
      cell.submit("alice", edit),
    ]);
    expect(acknowledgements[0]).toEqual(acknowledgements[1]);
    expect(await cell.snapshot(mapId)).toMatchObject({ mapVersion: 1 });
  });

  it("survives repeated edits and eviction without a second source authority", async () => {
    const mapId = "sustained";
    const cell = env.MAP_CELLS.getByName(mapId);
    const initial = createStarterDocument();
    await cell.initialize(mapId, serializeMap(initial));
    let document = (await cell.snapshot(mapId))
      .document as unknown as MapDocument;
    const ids = createSequentialIdFactory("sustained");
    for (let index = 0; index < 100; index += 1) {
      const next = insertBrush(
        document,
        document.entities[0]!.id,
        createBoxBrush(
          [index * 80, 0, 0],
          [index * 80 + 64, 64, 64],
          "STONE",
          ids,
        ),
      );
      const edit = {
        ...operation(document, next),
        operationId: `alice:${index}`,
        transactionId: `alice:${index}`,
        baseMapVersion: index,
      };
      expect(await cell.submit("alice", edit)).toMatchObject({
        type: "ack",
        mapVersion: index + 1,
      });
      document = next;
    }
    await evictDurableObject(cell);
    const recovered = await cell.snapshot(mapId);
    expect(recovered.mapVersion).toBe(100);
    expect(recovered.document.entities[0]!.primitives).toHaveLength(
      document.entities[0]!.primitives.length,
    );
    expect(recovered.source).toBe(serializeMap(document));
  });

  it("does not advance canonical state for a conflicting operation", async () => {
    const mapId = "conflict";
    const cell = env.MAP_CELLS.getByName(mapId);
    const starter = createStarterDocument();
    await cell.initialize(mapId, serializeMap(starter));
    const brush = starter.entities[0]!.primitives[0]!;
    if (brush.kind !== "brush") throw new Error("Expected starter brush");
    const moved = {
      ...starter,
      entities: starter.entities.with(0, {
        ...starter.entities[0]!,
        primitives: [translateBrush(brush, [16, 0, 0])],
      }),
    };
    const edit = operation(starter, moved);
    const invalid = {
      ...edit,
      operationId: "alice:bad",
      // oxlint-disable-next-line no-map-spread -- immutable fixture corrupts one revision deliberately.
      edits: edit.edits.map((candidate) =>
        candidate.kind === "replace-brush"
          ? { ...candidate, baseRevision: 999 }
          : candidate,
      ),
    };
    expect(await cell.submit("alice", invalid)).toMatchObject({
      type: "conflict",
    });
    expect(await cell.snapshot(mapId)).toMatchObject({
      mapVersion: 0,
      source: serializeMap(starter),
    });
  });
});
