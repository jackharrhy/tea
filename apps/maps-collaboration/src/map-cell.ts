import { DurableObject } from "cloudflare:workers";
import {
  applyCollaborationOperation,
  MapDocumentSchema,
  parseMapSource,
  planMapSave,
  rebaseMapSource,
  type CollaborationOperation,
  type MapDocument,
} from "@tea/maps-editor/core";
import {
  parseCollaborationClientFrame,
  type CollaborationServerFrame,
  type HostedCheckpoint,
  type HostedMapSnapshot,
  type ReplaceHostedMapSourceResult,
} from "@tea/maps-protocol";

interface SocketAttachment {
  readonly actorId: string;
  readonly role: "owner" | "editor" | "viewer";
  readonly operationWindowStartedAt: number;
  readonly operationCount: number;
}

type MapSnapshot = HostedMapSnapshot;
type MapCheckpoint = HostedCheckpoint;
interface StateRow {
  readonly [key: string]: string | number;
  readonly map_id: string;
  readonly map_version: number;
  readonly document_json: string;
  readonly source_text: string;
  readonly source_sha256: string;
}

const MAX_ROOM_CONNECTIONS = 32;
const MAX_ACTOR_CONNECTIONS = 4;
const OPERATION_WINDOW_MS = 60_000;
const MAX_OPERATIONS_PER_WINDOW = 240;
const RETAINED_OPERATION_BODIES = 2_048;
const MAX_MAP_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_CHECKPOINTS = 100;

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export class MapCell extends DurableObject<Env> {
  private documentCache:
    | { readonly serialized: string; readonly document: MapDocument }
    | undefined;

  public constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  private migrate(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS map_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        map_id TEXT NOT NULL,
        map_version INTEGER NOT NULL,
        document_json TEXT NOT NULL,
        source_text TEXT NOT NULL,
        source_sha256 TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS operation_receipts (
        operation_id TEXT PRIMARY KEY,
        map_version INTEGER NOT NULL,
        source_sha256 TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        accepted_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS operations (
        map_version INTEGER PRIMARY KEY,
        operation_id TEXT NOT NULL UNIQUE,
        operation_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        map_version INTEGER NOT NULL,
        source_text TEXT NOT NULL,
        source_sha256 TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO _sql_schema_migrations(version) VALUES (1);
    `);
  }

  public async initialize(mapId: string, source: string): Promise<MapSnapshot> {
    if (new TextEncoder().encode(source).byteLength > MAX_MAP_SOURCE_BYTES) {
      throw new Error("Hosted maps are limited to 2 MiB of source");
    }
    const existing = this.stateOrNull();
    if (existing) {
      if (existing.map_id !== mapId)
        throw new Error("MapCell identity mismatch");
      return this.toSnapshot(existing);
    }
    const parsed = parseMapSource(source);
    const sourceSha256 = await sha256(source);
    this.ctx.storage.transactionSync(() => {
      const raced = this.stateOrNull();
      if (raced) {
        if (raced.map_id !== mapId)
          throw new Error("MapCell identity mismatch");
        return;
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO map_state(singleton,map_id,map_version,document_json,source_text,source_sha256,updated_at)
         VALUES(1,?,0,?,?,?,?)`,
        mapId,
        JSON.stringify(parsed.document),
        source,
        sourceSha256,
        Date.now(),
      );
    });
    return this.snapshot(mapId);
  }

  public snapshot(mapId?: string): MapSnapshot {
    const state = this.state();
    if (mapId && state.map_id !== mapId)
      throw new Error("MapCell identity mismatch");
    return this.toSnapshot(state);
  }

  public async replaceSource(
    mapId: string,
    actorId: string,
    expectedMapVersion: number,
    expectedSourceSha256: string,
    source: string,
  ): Promise<ReplaceHostedMapSourceResult> {
    if (new TextEncoder().encode(source).byteLength > MAX_MAP_SOURCE_BYTES) {
      throw new Error("Hosted maps are limited to 2 MiB of source");
    }
    const before = this.state();
    if (before.map_id !== mapId) throw new Error("MapCell identity mismatch");
    if (
      before.map_version !== expectedMapVersion ||
      before.source_sha256 !== expectedSourceSha256
    ) {
      return {
        status: "conflict",
        mapVersion: before.map_version,
        sourceSha256: before.source_sha256,
      };
    }
    if (before.source_text === source)
      return { status: "replaced", map: this.toSnapshot(before) };
    const document = parseMapSource(source).document;
    const sourceSha256 = await sha256(source);
    const documentJson = JSON.stringify(document);
    const committed = this.ctx.storage.transactionSync(() => {
      const current = this.state();
      if (
        current.map_version !== expectedMapVersion ||
        current.source_sha256 !== expectedSourceSha256
      ) {
        return false;
      }
      const now = Date.now();
      this.ctx.storage.sql.exec(
        "INSERT INTO checkpoints VALUES(?,?,?,?,?,?,?)",
        crypto.randomUUID(),
        "Before project sync",
        current.map_version,
        current.source_text,
        current.source_sha256,
        actorId,
        now,
      );
      this.ctx.storage.sql.exec(
        `DELETE FROM checkpoints WHERE id IN (
          SELECT id FROM checkpoints ORDER BY created_at DESC LIMIT -1 OFFSET ?
        )`,
        MAX_CHECKPOINTS,
      );
      this.ctx.storage.sql.exec(
        `UPDATE map_state SET map_version=?,document_json=?,source_text=?,source_sha256=?,updated_at=?
         WHERE singleton=1`,
        current.map_version + 1,
        documentJson,
        source,
        sourceSha256,
        now,
      );
      return true;
    });
    if (!committed) {
      const current = this.state();
      return {
        status: "conflict",
        mapVersion: current.map_version,
        sourceSha256: current.source_sha256,
      };
    }
    this.documentCache = { serialized: documentJson, document };
    for (const socket of this.ctx.getWebSockets())
      socket.close(1012, "Map source replaced; reconnect");
    return { status: "replaced", map: this.snapshot(mapId) };
  }
  public async submit(
    actorId: string,
    operation: CollaborationOperation,
  ): Promise<CollaborationServerFrame> {
    if (actorId !== operation.actorId)
      throw new Error("Operation actor does not match the caller");
    const response = await this.applyOperation(operation);
    if (response.type === "operation") this.broadcast(response);
    return response.type === "operation"
      ? {
          type: "ack",
          operationId: operation.operationId,
          mapVersion: response.mapVersion,
          sourceSha256: response.sourceSha256,
        }
      : response;
  }

  public createCheckpoint(actorId: string, name: string): MapCheckpoint {
    const state = this.state();
    if (!name.trim() || name.length > 120)
      throw new Error("Checkpoint name is invalid");
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    this.ctx.storage.sql.exec(
      "INSERT INTO checkpoints VALUES(?,?,?,?,?,?,?)",
      id,
      name,
      state.map_version,
      state.source_text,
      state.source_sha256,
      actorId,
      createdAt,
    );
    this.ctx.storage.sql.exec(
      `DELETE FROM checkpoints WHERE id IN (
        SELECT id FROM checkpoints ORDER BY created_at DESC LIMIT -1 OFFSET ?
      )`,
      MAX_CHECKPOINTS,
    );
    return {
      id,
      name,
      mapVersion: state.map_version,
      sourceSha256: state.source_sha256,
      createdBy: actorId,
      createdAt,
    };
  }

  public listCheckpoints(): readonly MapCheckpoint[] {
    return this.ctx.storage.sql
      .exec<{
        id: string;
        name: string;
        map_version: number;
        source_sha256: string;
        created_by: string;
        created_at: number;
      }>(
        `SELECT id,name,map_version,source_sha256,created_by,created_at
         FROM checkpoints ORDER BY created_at DESC`,
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        name: row.name,
        mapVersion: row.map_version,
        sourceSha256: row.source_sha256,
        createdBy: row.created_by,
        createdAt: row.created_at,
      }));
  }

  public checkpointSource(
    checkpointId: string,
  ): { checkpoint: MapCheckpoint; source: string } | null {
    const row = this.ctx.storage.sql
      .exec<{
        id: string;
        name: string;
        map_version: number;
        source_text: string;
        source_sha256: string;
        created_by: string;
        created_at: number;
      }>(
        `SELECT id,name,map_version,source_text,source_sha256,created_by,created_at
         FROM checkpoints WHERE id=?`,
        checkpointId,
      )
      .toArray()[0];
    if (!row) return null;
    return {
      checkpoint: {
        id: row.id,
        name: row.name,
        mapVersion: row.map_version,
        sourceSha256: row.source_sha256,
        createdBy: row.created_by,
        createdAt: row.created_at,
      },
      source: row.source_text,
    };
  }

  public override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return Response.json(
        { error: "WebSocket upgrade required" },
        { status: 426 },
      );
    }
    const url = new URL(request.url);
    const actorId = url.searchParams.get("actor");
    const mapId = url.searchParams.get("map");
    const role = url.searchParams.get("role") ?? "editor";
    if (!actorId || !mapId || actorId.length > 128 || mapId.length > 128) {
      return Response.json(
        { error: "Valid map and actor parameters are required" },
        { status: 400 },
      );
    }
    if (role !== "owner" && role !== "editor" && role !== "viewer") {
      return Response.json(
        { error: "Valid collaboration role required" },
        { status: 400 },
      );
    }
    if (this.ctx.getWebSockets().length >= MAX_ROOM_CONNECTIONS) {
      return Response.json(
        { error: "Map session is at capacity" },
        { status: 503 },
      );
    }
    if (
      this.ctx.getWebSockets(`actor:${actorId}`).length >= MAX_ACTOR_CONNECTIONS
    ) {
      return Response.json(
        { error: "Actor connection limit reached" },
        { status: 429 },
      );
    }
    const snapshot = this.snapshot(mapId);
    const { 0: client, 1: server } = new WebSocketPair();
    server.serializeAttachment({
      actorId,
      role,
      operationWindowStartedAt: Date.now(),
      operationCount: 0,
    } satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server, [`actor:${actorId}`]);
    server.send(
      JSON.stringify({
        type: "ready",
        ...snapshot,
      } satisfies CollaborationServerFrame),
    );
    return new Response(null, { status: 101, webSocket: client });
  }

  public override async webSocketMessage(
    socket: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    try {
      const frame = parseCollaborationClientFrame(message);
      if (frame.type === "presence") {
        const attachment =
          socket.deserializeAttachment() as SocketAttachment | null;
        if (!attachment || attachment.actorId !== frame.presence.actorId) {
          throw new Error("Presence actor does not match the connection");
        }
        this.broadcast({ type: "presence", presence: frame.presence }, socket);
        return;
      }
      const attachment =
        socket.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.role === "viewer")
        throw new Error("Viewer connections cannot edit maps");
      if (!attachment)
        throw new Error("Collaboration connection is missing its identity");
      this.rateLimit(socket, attachment);
      const response = await this.applyOperation(frame.operation);
      if (response.type === "operation") {
        socket.send(
          JSON.stringify({
            type: "ack",
            operationId: frame.operation.operationId,
            mapVersion: response.mapVersion,
            sourceSha256: response.sourceSha256,
          } satisfies CollaborationServerFrame),
        );
        this.broadcast(response, socket);
      } else socket.send(JSON.stringify(response));
    } catch (error) {
      socket.send(
        JSON.stringify({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "Invalid collaboration frame",
        } satisfies CollaborationServerFrame),
      );
    }
  }

  public override webSocketClose(
    socket: WebSocket,
    code: number,
    reason: string,
  ): void {
    if (socket.readyState === WebSocket.CLOSED) return;
    const replyCode =
      code === 1000 ||
      code === 1001 ||
      code === 1002 ||
      code === 1003 ||
      (code >= 1007 && code <= 1014) ||
      (code >= 3000 && code <= 4999)
        ? code
        : 1000;
    socket.close(replyCode, reason);
  }

  private rateLimit(socket: WebSocket, attachment: SocketAttachment): void {
    const now = Date.now();
    const operationWindowStartedAt =
      now - attachment.operationWindowStartedAt >= OPERATION_WINDOW_MS
        ? now
        : attachment.operationWindowStartedAt;
    const operationCount =
      operationWindowStartedAt === now ? 1 : attachment.operationCount + 1;
    if (operationCount > MAX_OPERATIONS_PER_WINDOW) {
      socket.close(1008, "Operation rate limit exceeded");
      throw new Error("Operation rate limit exceeded");
    }
    socket.serializeAttachment({
      ...attachment,
      operationWindowStartedAt,
      operationCount,
    });
  }

  private async applyOperation(
    operation: CollaborationOperation,
  ): Promise<CollaborationServerFrame> {
    for (;;) {
      const receipt = this.receipt(operation.operationId);
      if (receipt) return receipt;
      const before = this.state();
      const document = this.document(before.document_json);
      const result = applyCollaborationOperation(document, operation);
      if (result.status === "conflict") {
        return {
          type: "conflict",
          operationId: operation.operationId,
          conflicts: result.conflicts,
        };
      }
      const sourceState = rebaseMapSource(document, before.source_text);
      const plan = planMapSave(result.document, sourceState);
      if (plan.status === "blocked") {
        return {
          type: "conflict",
          operationId: operation.operationId,
          conflicts: plan.diagnostics,
        };
      }
      const sourceSha256 = await sha256(plan.text);
      const documentJson = JSON.stringify(result.document);
      const committed = this.ctx.storage.transactionSync(() => {
        if (this.receipt(operation.operationId)) return false;
        if (this.state().map_version !== before.map_version) return false;
        const mapVersion = before.map_version + 1;
        this.ctx.storage.sql.exec(
          "INSERT INTO operation_receipts VALUES(?,?,?,?,?)",
          operation.operationId,
          mapVersion,
          sourceSha256,
          operation.actorId,
          Date.now(),
        );
        this.ctx.storage.sql.exec(
          "INSERT INTO operations VALUES(?,?,?)",
          mapVersion,
          operation.operationId,
          JSON.stringify(operation),
        );
        this.ctx.storage.sql.exec(
          `UPDATE map_state SET map_version=?,document_json=?,source_text=?,source_sha256=?,updated_at=?
           WHERE singleton=1`,
          mapVersion,
          documentJson,
          plan.text,
          sourceSha256,
          Date.now(),
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM operations WHERE map_version <= ?",
          mapVersion - RETAINED_OPERATION_BODIES,
        );
        return true;
      });
      if (!committed) continue;
      this.documentCache = {
        serialized: documentJson,
        document: result.document,
      };
      return {
        type: "operation",
        mapVersion: before.map_version + 1,
        sourceSha256,
        operation,
      };
    }
  }

  private receipt(
    operationId: string,
  ): Extract<CollaborationServerFrame, { type: "ack" }> | null {
    const receipt = this.ctx.storage.sql
      .exec<{ map_version: number; source_sha256: string }>(
        "SELECT map_version,source_sha256 FROM operation_receipts WHERE operation_id = ?",
        operationId,
      )
      .toArray()[0];
    return receipt
      ? {
          type: "ack",
          operationId,
          mapVersion: receipt.map_version,
          sourceSha256: receipt.source_sha256,
        }
      : null;
  }

  private stateOrNull(): StateRow | null {
    return (
      this.ctx.storage.sql
        .exec<StateRow>("SELECT * FROM map_state WHERE singleton=1")
        .toArray()[0] ?? null
    );
  }

  private state(): StateRow {
    const state = this.stateOrNull();
    if (!state) throw new Error("MapCell has not been initialized");
    return state;
  }

  private toSnapshot(state: StateRow): MapSnapshot {
    return {
      mapId: state.map_id,
      mapVersion: state.map_version,
      document: this.document(state.document_json),
      source: state.source_text,
      sourceSha256: state.source_sha256,
    };
  }

  private document(serialized: string): MapDocument {
    if (this.documentCache?.serialized === serialized)
      return this.documentCache.document;
    const document = MapDocumentSchema.parse(JSON.parse(serialized));
    this.documentCache = { serialized, document };
    return document;
  }

  private broadcast(frame: CollaborationServerFrame, except?: WebSocket): void {
    const serialized = JSON.stringify(frame);
    for (const socket of this.ctx.getWebSockets())
      if (socket !== except) socket.send(serialized);
  }
}
