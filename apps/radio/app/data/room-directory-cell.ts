import { DurableObject } from "cloudflare:workers";

import { normalizeRoomName, normalizeRoomSlug } from "./room-id.ts";
import type { RoomRecord } from "./radio-runtime.ts";

type RoomRow = {
  slug: string;
  name: string;
  created_at: number;
};

export class RoomDirectoryCell extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS rooms (
          slug TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO rooms VALUES ('cozy', 'cozy', 0);
      `);
      let rooms = ctx.storage.sql.exec<Pick<RoomRow, "slug" | "name">>(
        "SELECT slug, name FROM rooms",
      );
      for (let room of rooms) {
        let name = normalizeRoomName(room.name);
        if (name !== room.name) {
          ctx.storage.sql.exec(
            "UPDATE rooms SET name = ? WHERE slug = ?",
            name,
            room.slug,
          );
        }
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    let url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/rooms") {
      return Response.json(this.rooms(), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    let match = /^\/rooms\/([^/]+)$/.exec(url.pathname);
    if (!match) return new Response("Not Found", { status: 404 });
    let slug = normalizeRoomSlug(decodeURIComponent(match[1]!));
    if (!slug) return new Response("Not Found", { status: 404 });
    if (request.method === "GET") {
      let room = this.room(slug);
      return room
        ? Response.json(room, { headers: { "Cache-Control": "no-store" } })
        : new Response("Not Found", { status: 404 });
    }
    if (request.method === "PUT") return this.createRoom(request, slug);
    return new Response("Method Not Allowed", { status: 405 });
  }

  private rooms(): RoomRecord[] {
    return this.ctx.storage.sql
      .exec<RoomRow>(
        "SELECT slug, name, created_at FROM rooms ORDER BY created_at, name",
      )
      .toArray()
      .map(toRoomRecord);
  }

  private hasRoom(slug: string): boolean {
    return Boolean(
      this.ctx.storage.sql
        .exec<{ found: number }>(
          "SELECT 1 AS found FROM rooms WHERE slug = ?",
          slug,
        )
        .toArray()[0],
    );
  }

  private room(slug: string): RoomRecord | null {
    let row = this.ctx.storage.sql
      .exec<RoomRow>(
        "SELECT slug, name, created_at FROM rooms WHERE slug = ?",
        slug,
      )
      .toArray()[0];
    return row ? toRoomRecord(row) : null;
  }

  private async createRoom(request: Request, slug: string): Promise<Response> {
    let input = (await request.json().catch(() => null)) as {
      name?: unknown;
    } | null;
    if (typeof input?.name !== "string")
      return new Response("Invalid room", { status: 400 });
    let name = normalizeRoomName(input.name);
    if (!name || name.length > 48)
      return new Response("Invalid room", { status: 400 });
    if (this.hasRoom(slug))
      return new Response("Room already exists", { status: 409 });
    let createdAt = Date.now();
    this.ctx.storage.sql.exec(
      "INSERT INTO rooms (slug, name, created_at) VALUES (?, ?, ?)",
      slug,
      name,
      createdAt,
    );
    return Response.json({ slug, name, createdAt } satisfies RoomRecord, {
      status: 201,
    });
  }
}

function toRoomRecord(row: RoomRow): RoomRecord {
  return {
    slug: row.slug,
    name: normalizeRoomName(row.name),
    createdAt: row.created_at,
  };
}
