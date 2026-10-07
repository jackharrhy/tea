import { DurableObject } from "cloudflare:workers";
import { BoardAssets } from "./board-assets.ts";
import {
  parseOperation,
  type BoardItem,
  type BoardOperation,
  type BoardServerFrame,
  type BoardSnapshot,
  type LinkPreview,
} from "./protocol.ts";

interface ItemRow extends Record<string, SqlStorageValue> {
  id: string;
  asset_id: string;
  filename: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z: number;
  revision: number;
  link_url: string | null;
  link_title: string | null;
  link_description: string | null;
  link_image_url: string | null;
  link_site_name: string | null;
}

interface SocketAttachment {
  sessionHash: string;
  expiresAt: number;
  accessVersion: number;
  windowStartedAt: number;
  messageCount: number;
}

const MAX_CONNECTIONS = 64;
const MAX_ITEMS = 2_000;
const MAX_FRAME_BYTES = 24_000;
const MAX_MESSAGES_PER_MINUTE = 2_400;
const OPERATION_RETENTION = 10_000;
const OPERATION_PRUNE_INTERVAL = 100;
const ITEM_QUERY = `SELECT items.*, links.url AS link_url, links.title AS link_title,
  links.description AS link_description, links.image_url AS link_image_url,
  links.site_name AS link_site_name FROM items
  LEFT JOIN links ON links.asset_id = items.asset_id`;

export class BoardCell extends DurableObject<Env> {
  private assets: BoardAssets;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.assets = new BoardAssets(ctx, env.MEDIA);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS board_info (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), board_id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS assets (
          id TEXT PRIMARY KEY,
          object_key TEXT NOT NULL,
          filename TEXT NOT NULL,
          content_type TEXT NOT NULL,
          size INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS links (
          asset_id TEXT PRIMARY KEY REFERENCES assets(id),
          url TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          image_url TEXT,
          site_name TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS items (
          id TEXT PRIMARY KEY,
          asset_id TEXT NOT NULL REFERENCES assets(id),
          filename TEXT NOT NULL,
          x REAL NOT NULL,
          y REAL NOT NULL,
          width REAL NOT NULL,
          height REAL NOT NULL,
          rotation REAL NOT NULL,
          z INTEGER NOT NULL,
          revision INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS operations (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          operation_id TEXT NOT NULL UNIQUE,
          actor_id TEXT NOT NULL,
          item_id TEXT NOT NULL,
          item_json TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS access_versions (
          actor_id TEXT PRIMARY KEY,
          version INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pending_deletes (
          object_key TEXT PRIMARY KEY
        );
      `);
    });
  }

  initialize(boardId: string): void {
    const existing = this.boardId();
    if (existing && existing !== boardId)
      throw new Error("Board identity mismatch");
    if (!existing)
      this.ctx.storage.sql.exec(
        "INSERT INTO board_info VALUES (1, ?)",
        boardId,
      );
  }

  snapshot(boardId: string): BoardSnapshot {
    this.assertBoard(boardId);
    return {
      boardId,
      sequence: this.sequence(),
      items: this.ctx.storage.sql
        .exec<ItemRow>(`${ITEM_QUERY} ORDER BY items.z, items.id`)
        .toArray()
        .map(toItem),
    };
  }

  recordAsset(
    boardId: string,
    asset: {
      id: string;
      objectKey: string;
      filename: string;
      contentType: string;
      size: number;
    },
  ): void {
    this.assertBoard(boardId);
    this.assets.recordAsset(asset);
  }

  restoreAsset(
    boardId: string,
    asset: {
      id: string;
      objectKey: string;
      filename: string;
      contentType: string;
      size: number;
    },
  ): boolean {
    this.assertBoard(boardId);
    return this.assets.restoreAsset(asset);
  }

  recordLink(
    boardId: string,
    preview: LinkPreview,
  ): { assetId: string; preview: LinkPreview; existingItemId: string | null } {
    this.assertBoard(boardId);
    return this.assets.recordLink(preview);
  }

  existingLink(
    boardId: string,
    url: string,
  ): {
    assetId: string;
    preview: LinkPreview;
    existingItemId: string | null;
  } | null {
    this.assertBoard(boardId);
    return this.assets.existingLink(url);
  }

  restoreLink(boardId: string, assetId: string, preview: LinkPreview): boolean {
    this.assertBoard(boardId);
    return this.assets.restoreLink(assetId, preview);
  }

  restoreItem(boardId: string, input: unknown): boolean {
    this.assertBoard(boardId);
    const operation = parseOperation(input);
    if (
      !operation ||
      operation.kind !== "create" ||
      operation.operationId !== operation.item.id
    )
      return false;
    const result = this.applyOperation(boardId, "restore", operation);
    if (result.type !== "applied") return false;
    this.broadcast(result);
    return true;
  }

  asset(
    boardId: string,
    assetId: string,
  ): { objectKey: string; contentType: string; size: number } | null {
    this.assertBoard(boardId);
    return this.assets.asset(assetId);
  }

  closeSession(sessionHash: string): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO access_versions VALUES (?, 1)
       ON CONFLICT(actor_id) DO UPDATE SET version = version + 1`,
      sessionHash,
    );
    for (const socket of this.ctx.getWebSockets()) {
      const attachment =
        socket.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.sessionHash !== sessionHash) continue;
      this.endSocket(socket);
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    const boardId = request.headers.get("x-ref-board");
    const sessionHash = request.headers.get("x-ref-session-hash");
    if (
      !boardId ||
      !sessionHash ||
      !/^[0-9a-f]{64}$/.test(sessionHash) ||
      boardId !== this.boardId()
    ) {
      return new Response("Invalid board access", { status: 403 });
    }
    const access = await this.env.DIRECTORY.getByName("main").socketAccess(
      boardId,
      sessionHash,
    );
    if (!access) return new Response("Invalid board access", { status: 403 });
    if (this.ctx.getWebSockets().length >= MAX_CONNECTIONS) {
      return new Response("Board is at capacity", { status: 503 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    server.serializeAttachment({
      sessionHash,
      expiresAt: access.expiresAt,
      accessVersion: this.accessVersion(sessionHash),
      windowStartedAt: Date.now(),
      messageCount: 0,
    } satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server);
    this.send(server, { type: "ready", snapshot: this.snapshot(boardId) });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(
    socket: WebSocket,
    raw: string | ArrayBuffer,
  ): Promise<void> {
    const attachment =
      socket.deserializeAttachment() as SocketAttachment | null;
    if (
      !attachment ||
      typeof raw !== "string" ||
      raw.length > MAX_FRAME_BYTES
    ) {
      this.send(socket, { type: "error", message: "Invalid message" });
      return;
    }
    if (
      attachment.accessVersion !== this.accessVersion(attachment.sessionHash) ||
      attachment.expiresAt <= Date.now()
    ) {
      this.send(socket, { type: "error", message: "Session ended" });
      return;
    }
    const now = Date.now();
    if (now - attachment.windowStartedAt >= 60_000) {
      attachment.windowStartedAt = now;
      attachment.messageCount = 0;
    }
    attachment.messageCount++;
    socket.serializeAttachment(attachment);
    if (attachment.messageCount > MAX_MESSAGES_PER_MINUTE) return;

    let frame: unknown;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isRecord(frame)) return;
    if (frame.type !== "ping" && frame.type !== "operation") return;
    const boardId = this.boardId();
    if (
      !boardId ||
      !(await this.env.DIRECTORY.getByName("main").socketAccess(
        boardId,
        attachment.sessionHash,
      ))
    ) {
      this.endSocket(socket);
      return;
    }

    if (frame.type === "ping") {
      this.send(socket, { type: "pong" });
      return;
    }
    const operation = parseOperation(frame.operation);
    if (!operation) {
      this.send(socket, { type: "error", message: "Invalid board operation" });
      return;
    }
    if (operation.kind === "remove")
      await this.ctx.storage.setAlarm(Date.now() + 60_000);
    const result = this.applyOperation(
      boardId,
      attachment.sessionHash,
      operation,
    );
    if (result.type === "applied") {
      this.broadcast(result);
      if (operation.kind === "remove") await this.assets.drainPendingDeletes();
    } else this.send(socket, result);
  }

  async alarm(): Promise<void> {
    await this.assets.drainPendingDeletes();
  }

  private applyOperation(
    boardId: string,
    actorId: string,
    operation: BoardOperation,
  ): Extract<BoardServerFrame, { type: "applied" | "rejected" }> {
    const existing = this.ctx.storage.sql
      .exec<{
        sequence: number;
        item_id: string;
        item_json: string | null;
      }>(
        "SELECT sequence, item_id, item_json FROM operations WHERE operation_id = ?",
        operation.operationId,
      )
      .toArray()[0];
    if (existing) {
      return {
        type: "applied",
        operationId: operation.operationId,
        sequence: existing.sequence,
        itemId: existing.item_id,
        item: existing.item_json
          ? (JSON.parse(existing.item_json) as BoardItem)
          : null,
      };
    }

    const rejected = (reason: string) => ({
      type: "rejected" as const,
      operationId: operation.operationId,
      reason,
      snapshot: this.snapshot(boardId),
    });

    let item: BoardItem | null;
    let itemId: string;
    let removedAssetId: string | null = null;
    if (operation.kind === "create") {
      const asset = this.assets.itemMetadata(operation.item.assetId);
      if (!asset) return rejected("Upload is missing");
      if (
        this.ctx.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM items")
          .one().count >= MAX_ITEMS
      ) {
        return rejected("Board item limit reached");
      }
      if (
        this.ctx.storage.sql
          .exec("SELECT id FROM items WHERE id = ?", operation.item.id)
          .toArray().length
      ) {
        return rejected("Item already exists");
      }
      item = {
        ...operation.item,
        filename: asset.filename,
        revision: 1,
        ...(asset.link ? { link: asset.link } : {}),
      };
      itemId = item.id;
    } else {
      itemId = operation.itemId;
      const row = this.ctx.storage.sql
        .exec<ItemRow>(`${ITEM_QUERY} WHERE items.id = ?`, itemId)
        .toArray()[0];
      if (!row) return rejected("Item is no longer on the board");
      if (row.revision !== operation.baseRevision)
        return rejected("This item changed in another tab");
      if (operation.kind === "remove") removedAssetId = row.asset_id;
      item =
        operation.kind === "remove"
          ? null
          : {
              ...toItem(row),
              x: operation.x,
              y: operation.y,
              width: operation.width,
              height: operation.height,
              rotation: operation.rotation,
              z: operation.z,
              revision: row.revision + 1,
            };
    }

    const acceptedItem = item;
    const sequence = this.ctx.storage.transactionSync(() => {
      if (acceptedItem && operation.kind === "create") {
        this.ctx.storage.sql.exec(
          "INSERT INTO items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          acceptedItem.id,
          acceptedItem.assetId,
          acceptedItem.filename,
          acceptedItem.x,
          acceptedItem.y,
          acceptedItem.width,
          acceptedItem.height,
          acceptedItem.rotation,
          acceptedItem.z,
          acceptedItem.revision,
        );
      } else if (acceptedItem) {
        this.ctx.storage.sql.exec(
          `UPDATE items SET x = ?, y = ?, width = ?, height = ?, rotation = ?, z = ?, revision = ? WHERE id = ?`,
          acceptedItem.x,
          acceptedItem.y,
          acceptedItem.width,
          acceptedItem.height,
          acceptedItem.rotation,
          acceptedItem.z,
          acceptedItem.revision,
          itemId,
        );
      } else {
        this.ctx.storage.sql.exec("DELETE FROM items WHERE id = ?", itemId);
        if (removedAssetId)
          this.assets.deleteUnusedAsset(boardId, removedAssetId);
      }
      const nextSequence = this.ctx.storage.sql
        .exec<{ sequence: number }>(
          `INSERT INTO operations (operation_id, actor_id, item_id, item_json, created_at)
         VALUES (?, ?, ?, ?, ?) RETURNING sequence`,
          operation.operationId,
          actorId,
          itemId,
          acceptedItem ? JSON.stringify(acceptedItem) : null,
          Date.now(),
        )
        .one().sequence;
      if (nextSequence % OPERATION_PRUNE_INTERVAL === 0) {
        this.ctx.storage.sql.exec(
          "DELETE FROM operations WHERE sequence <= ?",
          nextSequence - OPERATION_RETENTION,
        );
      }
      return nextSequence;
    });
    return {
      type: "applied",
      operationId: operation.operationId,
      sequence,
      itemId,
      item: acceptedItem,
    };
  }

  private boardId(): string | null {
    return (
      this.ctx.storage.sql
        .exec<{ board_id: string }>(
          "SELECT board_id FROM board_info WHERE singleton = 1",
        )
        .toArray()[0]?.board_id ?? null
    );
  }

  private assertBoard(boardId: string): void {
    if (this.boardId() !== boardId) throw new Error("Board identity mismatch");
  }

  private sequence(): number {
    return this.ctx.storage.sql
      .exec<{ sequence: number }>(
        "SELECT COALESCE(MAX(sequence), 0) AS sequence FROM operations",
      )
      .one().sequence;
  }

  private accessVersion(sessionHash: string): number {
    return (
      this.ctx.storage.sql
        .exec<{ version: number }>(
          "SELECT version FROM access_versions WHERE actor_id = ?",
          sessionHash,
        )
        .toArray()[0]?.version ?? 0
    );
  }

  private activeSocket(socket: WebSocket): boolean {
    const attachment =
      socket.deserializeAttachment() as SocketAttachment | null;
    return (
      !!attachment &&
      attachment.expiresAt > Date.now() &&
      attachment.accessVersion === this.accessVersion(attachment.sessionHash)
    );
  }

  private send(socket: WebSocket, frame: BoardServerFrame): void {
    try {
      socket.send(JSON.stringify(frame));
    } catch {}
  }

  private broadcast(frame: BoardServerFrame): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (this.activeSocket(socket)) this.send(socket, frame);
      else this.endSocket(socket);
    }
  }

  private endSocket(socket: WebSocket): void {
    this.send(socket, { type: "error", message: "Session ended" });
    try {
      socket.close(1008, "Session ended");
    } catch {}
  }
}

function toItem(row: ItemRow): BoardItem {
  return {
    id: row.id,
    assetId: row.asset_id,
    filename: row.filename,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    rotation: row.rotation,
    z: row.z,
    revision: row.revision,
    ...(row.link_url
      ? {
          link: {
            url: row.link_url,
            title: row.link_title ?? row.filename,
            description: row.link_description ?? "",
            imageUrl: row.link_image_url,
            siteName: row.link_site_name ?? "",
          },
        }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
