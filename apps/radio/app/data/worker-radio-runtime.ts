import { resolveMediaRange } from "./media-range.ts";
import type { RadioRuntimeService, RoomRecord } from "./radio-runtime.ts";

export function createRadioRuntime(env: Env): RadioRuntimeService {
  let directory = env.ROOM_DIRECTORY.getByName("global");
  return {
    async listRooms() {
      let response = await directory.fetch("https://directory.internal/rooms");
      if (!response.ok) throw new Error("Room directory unavailable");
      return response.json<RoomRecord[]>();
    },
    async getRoom(roomSlug) {
      let response = await directory.fetch(
        `https://directory.internal/rooms/${encodeURIComponent(roomSlug)}`,
      );
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Room directory unavailable");
      return response.json<RoomRecord>();
    },
    async createRoom(room) {
      let response = await directory.fetch(
        `https://directory.internal/rooms/${encodeURIComponent(room.slug)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: room.name }),
        },
      );
      if (response.status === 409) return "exists";
      if (!response.ok) throw new Error("Could not create room");
      return "created";
    },
    fetchRoom(roomSlug, pathname, init) {
      return roomStub(env, roomSlug).fetch(
        cellRequest(roomSlug, pathname, init),
      );
    },
    uploadTrack(request, roomSlug, trackId) {
      return uploadTrack(request, env, roomSlug, trackId);
    },
    serveTrack(request, roomSlug, trackId) {
      return serveTrack(request, env, roomSlug, trackId);
    },
  };
}

function roomStub(env: Env, roomSlug: string): DurableObjectStub {
  return env.RADIO_ROOMS.getByName(roomSlug);
}

function cellRequest(
  roomSlug: string,
  pathname: string,
  source?: Request | RequestInit,
): Request {
  let init = source instanceof Request ? requestInit(source) : source;
  let headers = new Headers(init?.headers);
  headers.set("x-radio-room", roomSlug);
  return new Request("https://cell.internal" + pathname, { ...init, headers });
}

function requestInit(request: Request): RequestInit {
  return {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: request.redirect,
  };
}

async function uploadTrack(
  request: Request,
  env: Env,
  roomSlug: string,
  trackId: string,
): Promise<Response> {
  let stub = roomStub(env, roomSlug);
  let uploadResponse = await stub.fetch(
    cellRequest(roomSlug, `/tracks/${encodeURIComponent(trackId)}/upload`),
  );
  if (!uploadResponse.ok) return uploadResponse;
  let upload = (await uploadResponse.json()) as {
    track: { upload: { sizeBytes: number } };
    objectKey: string;
  };
  if (!request.body)
    return Response.json({ error: "Missing track file" }, { status: 400 });

  let declaredLength = Number(request.headers.get("Content-Length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > upload.track.upload.sizeBytes
  ) {
    return Response.json({ error: "File is too large" }, { status: 400 });
  }

  try {
    let object = await env.TRACKS.put(upload.objectKey, request.body, {
      httpMetadata: {
        contentType:
          request.headers.get("Content-Type") ?? "application/octet-stream",
      },
    });
    if (object.size !== upload.track.upload.sizeBytes) {
      await env.TRACKS.delete(upload.objectKey);
      throw new Error("Upload size did not match the selected file");
    }
    let completion = await stub.fetch(
      cellRequest(roomSlug, `/tracks/${encodeURIComponent(trackId)}/complete`, {
        method: "POST",
      }),
    );
    if (!completion.ok) await env.TRACKS.delete(upload.objectKey);
    return completion;
  } catch (error) {
    await stub.fetch(
      cellRequest(roomSlug, `/tracks/${encodeURIComponent(trackId)}/failed`, {
        method: "POST",
      }),
    );
    return Response.json({ error: errorMessage(error) }, { status: 400 });
  }
}

async function serveTrack(
  request: Request,
  env: Env,
  roomSlug: string,
  trackId: string,
): Promise<Response> {
  let object = await env.TRACKS.get(`rooms/${roomSlug}/tracks/${trackId}`, {
    range: request.headers,
  });
  if (!object) return new Response("Not Found", { status: 404 });
  let headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Accept-Ranges", "bytes");
  headers.set("ETag", object.httpEtag);
  if ("range" in object && object.range) {
    let { offset, length } = resolveMediaRange(object.range, object.size);
    headers.set(
      "Content-Range",
      `bytes ${offset}-${offset + length - 1}/${object.size}`,
    );
    headers.set("Content-Length", String(length));
  } else {
    headers.set("Content-Length", String(object.size));
  }
  return new Response(request.method === "HEAD" ? null : object.body, {
    status: "range" in object && object.range ? 206 : 200,
    headers,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}
