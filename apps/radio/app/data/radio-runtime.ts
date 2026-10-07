import { createContextKey, type Middleware } from "remix/router";

import type { RoomSnapshot } from "./protocol.ts";
import { normalizeRoomSlug } from "./room-id.ts";

export type RoomRecord = {
  slug: string;
  name: string;
  createdAt: number;
};

export interface RadioRuntimeService {
  listRooms(): Promise<RoomRecord[]>;
  getRoom(roomSlug: string): Promise<RoomRecord | null>;
  createRoom(
    room: Pick<RoomRecord, "slug" | "name">,
  ): Promise<"created" | "exists">;
  fetchRoom(
    roomSlug: string,
    pathname: string,
    init?: Request | RequestInit,
  ): Promise<Response>;
  uploadTrack(
    request: Request,
    roomSlug: string,
    trackId: string,
  ): Promise<Response>;
  serveTrack(
    request: Request,
    roomSlug: string,
    trackId: string,
  ): Promise<Response>;
}

export const RadioRuntime = createContextKey<RadioRuntimeService>();
export const CurrentRoom = createContextKey<RoomRecord>();

export function radioRuntime(service: RadioRuntimeService): Middleware {
  return (context, next) => {
    context.set(RadioRuntime, service);
    return next();
  };
}

export function requireRegisteredRoom(): Middleware {
  return async (context, next) => {
    let roomSlug = normalizeRoomSlug(context.params.roomSlug ?? "");
    if (!roomSlug) return new Response("Room not found", { status: 404 });
    let runtime = context.get(RadioRuntime)!;
    let room = await runtime.getRoom(roomSlug);
    if (!room) return new Response("Room not found", { status: 404 });
    context.set(CurrentRoom, room);
    return next();
  };
}

export async function readSnapshot(
  response: Response,
): Promise<RoomSnapshot | null> {
  return response.ok ? ((await response.json()) as RoomSnapshot) : null;
}
