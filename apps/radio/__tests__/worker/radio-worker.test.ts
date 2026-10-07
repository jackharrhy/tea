import { env, exports } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  parseServerMessage,
  type RoomSnapshot,
  type ServerMessage,
  type Track,
} from "../../app/data/protocol.ts";

const origin = "https://radio.test";

describe("room cells", () => {
  it("isolates room state and restores it after eviction", async () => {
    let track = await uploadTrack("studio", "Studio tone");

    expect((await snapshot("studio")).tracks).toEqual([track]);
    expect((await snapshot("cozy")).tracks).toEqual([]);

    await evictDurableObject(env.RADIO_ROOMS.getByName("studio"));
    expect((await snapshot("studio")).tracks).toEqual([track]);
  });

  it("waits for every listener before scheduling playback", async () => {
    let track = await uploadTrack("ready-room", "Ready tone");
    let first = await join("ready-room", "first");
    let second = await join("ready-room", "second");

    first.send({ type: "PLAY", trackId: track.id, trackTimeSeconds: 4 });
    expect((await first.next("LOAD_TRACK")).track).toEqual(track);
    await second.next("LOAD_TRACK");
    expect((await first.next("TRACK_BUFFERING")).readyClientCount).toBe(0);

    first.send({ type: "TRACK_READY", trackId: track.id });
    expect((await first.next("TRACK_BUFFERING")).readyClientCount).toBe(1);
    first.expectNoMessage("SCHEDULED_PLAY");

    second.send({ type: "TRACK_READY", trackId: track.id });
    let scheduled = await first.next("SCHEDULED_PLAY");
    expect(scheduled.trackId).toBe(track.id);
    expect(scheduled.trackTimeSeconds).toBe(4);

    first.close();
    second.close();
  });

  it("uses its alarm when a listener never becomes ready", async () => {
    let track = await uploadTrack("timeout-room", "Timeout tone");
    let listener = await join("timeout-room", "listener");

    listener.send({ type: "PLAY", trackId: track.id, trackTimeSeconds: 0 });
    await listener.next("LOAD_TRACK");
    expect(
      await runDurableObjectAlarm(env.RADIO_ROOMS.getByName("timeout-room")),
    ).toBe(true);
    expect((await listener.next("SCHEDULED_PLAY")).trackId).toBe(track.id);

    listener.close();
  });

  it("keeps hibernatable sockets and durable playback state across eviction", async () => {
    let listener = await join("hibernate-room", "listener");
    let stub = env.RADIO_ROOMS.getByName("hibernate-room");

    await evictDurableObject(stub);
    listener.send({ type: "SET_VOLUME", volume: 0.35 });
    expect((await listener.next("VOLUME_UPDATED")).volume).toBe(0.35);

    await evictDurableObject(stub);
    expect((await snapshot("hibernate-room")).volume).toBe(0.35);
    listener.close();
  });

  it("uses the server-provided listener name instead of a JOIN payload name", async () => {
    let response = await env.RADIO_ROOMS.getByName("identity-room").fetch(
      "https://cell.test/websocket",
      {
        headers: {
          Upgrade: "websocket",
          "x-radio-room": "identity-room",
          "x-radio-listener-name": "Trusted name",
        },
      },
    );
    let socket = response.webSocket!;
    socket.accept();
    let client = new SocketClient(socket);
    client.send({
      type: "JOIN",
      clientId: "identity-client",
      name: "Spoofed name",
    });
    let state = await client.next("ROOM_STATE");
    expect(state.snapshot.clients[0]!.name).toBe("Trusted name");
    client.close();
  });

  it("treats duplicate readiness as one listener and cancels removed pending tracks", async () => {
    let track = await uploadTrack("pending-room", "Pending");
    let first = await join("pending-room", "first");
    let second = await join("pending-room", "second");

    first.send({ type: "PLAY", trackId: track.id, trackTimeSeconds: 0 });
    await first.next("LOAD_TRACK");
    await second.next("LOAD_TRACK");
    await first.next("TRACK_BUFFERING");
    first.send({ type: "TRACK_READY", trackId: track.id });
    first.send({ type: "TRACK_READY", trackId: track.id });
    await first.next("TRACK_BUFFERING");
    expect((await first.next("TRACK_BUFFERING")).readyClientCount).toBe(1);
    first.expectNoMessage("SCHEDULED_PLAY");

    first.send({ type: "REMOVE_TRACK", trackId: track.id });
    expect((await first.next("QUEUE_UPDATED")).tracks).toEqual([]);
    await runDurableObjectAlarm(env.RADIO_ROOMS.getByName("pending-room"));
    first.expectNoMessage("SCHEDULED_PLAY");

    first.close();
    second.close();
  });

  it("renames, reorders, removes, and advances tracks through the socket protocol", async () => {
    let firstTrack = await uploadTrack("queue-room", "First");
    let secondTrack = await uploadTrack("queue-room", "Second");
    let listener = await join("queue-room", "listener");

    listener.send({
      type: "RENAME_TRACK",
      trackId: firstTrack.id,
      title: "Renamed",
    });
    expect((await listener.next("QUEUE_UPDATED")).tracks[0]!.title).toBe(
      "Renamed",
    );

    listener.send({
      type: "REORDER_TRACKS",
      trackIds: [secondTrack.id, firstTrack.id],
    });
    expect(
      (await listener.next("QUEUE_UPDATED")).tracks.map((track) => track.id),
    ).toEqual([secondTrack.id, firstTrack.id]);

    listener.send({
      type: "PLAY",
      trackId: secondTrack.id,
      trackTimeSeconds: 0,
    });
    await listener.next("LOAD_TRACK");
    listener.send({ type: "TRACK_READY", trackId: secondTrack.id });
    await listener.next("SCHEDULED_PLAY");
    listener.send({
      type: "TRACK_ENDED",
      trackId: secondTrack.id,
      trackTimeSeconds: 12,
    });
    expect((await listener.next("LOAD_TRACK")).track.id).toBe(firstTrack.id);

    listener.send({ type: "REMOVE_TRACK", trackId: secondTrack.id });
    expect(
      (await listener.next("QUEUE_UPDATED")).tracks.map((track) => track.id),
    ).toEqual([firstTrack.id]);

    listener.close();
  });
});

describe("Worker HTTP boundary", () => {
  it("keeps the lobby public and protects rooms and mutations", async () => {
    expect((await request("/")).status).toBe(200);
    expect((await request("/rooms/cozy", { redirect: "manual" })).status).toBe(
      303,
    );
    expect(
      (await request("/api/rooms/cozy/tracks", { method: "POST" })).status,
    ).toBe(401);
  });

  it("rejects a wrong password and accepts a signed session", async () => {
    let rejected = await request("/join", {
      method: "POST",
      body: new URLSearchParams({
        name: "Ada",
        password: "wrong",
        roomSlug: "cozy",
      }),
      redirect: "manual",
    });
    expect(rejected.status).toBe(303);
    expect(rejected.headers.get("Location")).toBe("/?room=cozy");

    let accepted = await login("Ada");
    let page = await request("/rooms/cozy", { headers: { Cookie: accepted } });
    expect(page.status).toBe(200);
  });

  it("rejects a tampered session cookie", async () => {
    let cookie = await login("Ada");
    let replacement = cookie.endsWith("a") ? "b" : "a";
    let tampered = cookie.slice(0, -1) + replacement;
    let response = await request("/rooms/cozy", {
      headers: { Cookie: tampered },
      redirect: "manual",
    });
    expect(response.status).toBe(303);
  });

  it("creates directory entries through the authenticated form", async () => {
    let cookie = await login("Creator");
    let created = await request("/rooms", {
      method: "POST",
      headers: { Cookie: cookie },
      body: new URLSearchParams({ name: "Late Night", slug: "late-night" }),
      redirect: "manual",
    });
    expect(created.status).toBe(303);
    expect(created.headers.get("Location")).toBe("/rooms/late-night");

    let lobby = await request("/");
    let lobbyHtml = await lobby.text();
    expect(lobbyHtml).toContain("late night");
    expect(lobbyHtml).not.toContain("Late Night");
  });

  it("rejects unsafe cross-origin form submissions", async () => {
    let response = await request("/join", {
      method: "POST",
      headers: { Origin: "https://attacker.test" },
      body: new URLSearchParams({
        name: "Ada",
        password: "test-password",
        roomSlug: "cozy",
      }),
    });
    expect(response.status).toBe(403);
  });

  it("renders room-specific Remix pages", async () => {
    let root = await request("/", { redirect: "manual" });
    expect(root.status).toBe(200);
    let rootHtml = await root.text();
    expect(rootHtml).toContain('aria-label="Rooms"');
    expect(rootHtml).toContain('name="room" value="cozy"');
    expect(rootHtml).toContain('placeholder="username"');
    expect(rootHtml).toContain('placeholder="password"');
    expect(rootHtml).toContain(">join</button>");
    expect(rootHtml).not.toContain('type="radio"');
    expect(rootHtml).toContain('aria-label="Breadcrumb"');

    await ensureRoom("http-room", "HTTP room");
    let page = await authorizedRequest("/rooms/http-room");
    expect(page.status).toBe(200);
    let html = await page.text();
    expect(html).toContain("radio-room");
    expect(html).toMatch(/\/assets\/entry-[A-Z0-9]+\.js/);
    expect(html).toMatch(/\/assets\/radio-room-[A-Z0-9]+\.js/);
    expect(html).toContain('"exportName":"RadioRoom"');
    expect(html).toContain("http room");
    expect(html).not.toContain('"exportName":"RadioRoom2"');
  });

  it("streams uploads to object storage and serves byte ranges", async () => {
    let track = await uploadTrack("media-room", "Media");
    let response = await authorizedRequest(track.url, {
      headers: { Range: "bytes=1-2" },
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 1-2/4");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([2, 3]);

    let suffix = await authorizedRequest(track.url, {
      headers: { Range: "bytes=-2" },
    });
    expect(suffix.headers.get("Content-Range")).toBe("bytes 2-3/4");
    expect([...new Uint8Array(await suffix.arrayBuffer())]).toEqual([3, 4]);
  });

  it("marks interrupted uploads failed without exposing partial media", async () => {
    await ensureRoom("failed-upload", "Failed upload");
    let metadata = await authorizedRequest("/api/rooms/failed-upload/tracks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "broken.mp3",
        mediaType: "audio/mpeg",
        sizeBytes: 4,
      }),
    });
    let track = (await metadata.json<{ track: Track }>()).track;
    let content = await authorizedRequest(
      `/api/rooms/failed-upload/tracks/${track.id}/content`,
      {
        method: "PUT",
        headers: { "Content-Type": "audio/mpeg", "Content-Length": "3" },
        body: new Uint8Array([1, 2, 3]),
      },
    );

    expect(content.status).toBe(400);
    expect((await snapshot("failed-upload")).tracks[0]!.upload?.status).toBe(
      "failed",
    );
    expect((await authorizedRequest(track.url)).status).toBe(404);
  });
});

async function uploadTrack(roomSlug: string, title: string): Promise<Track> {
  await ensureRoom(roomSlug, title);
  let metadata = await authorizedRequest(`/api/rooms/${roomSlug}/tracks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `${title}.mp3`,
      mediaType: "audio/mpeg",
      sizeBytes: 4,
    }),
  });
  expect(metadata.status).toBe(201);
  let pending = (await metadata.json<{ track: Track }>()).track;

  let content = await authorizedRequest(
    `/api/rooms/${roomSlug}/tracks/${pending.id}/content`,
    {
      method: "PUT",
      headers: { "Content-Type": "audio/mpeg", "Content-Length": "4" },
      body: new Uint8Array([1, 2, 3, 4]),
    },
  );
  expect(content.status).toBe(200);
  return (await content.json<{ track: Track }>()).track;
}

async function snapshot(roomSlug: string): Promise<RoomSnapshot> {
  let response = await env.RADIO_ROOMS.getByName(roomSlug).fetch(
    "https://cell.test/snapshot",
    {
      headers: { "x-radio-room": roomSlug },
    },
  );
  expect(response.status).toBe(200);
  return response.json<RoomSnapshot>();
}

async function join(roomSlug: string, clientId: string): Promise<SocketClient> {
  let response = await env.RADIO_ROOMS.getByName(roomSlug).fetch(
    "https://cell.test/websocket",
    {
      headers: {
        Upgrade: "websocket",
        "x-radio-room": roomSlug,
        "x-radio-listener-name": clientId,
      },
    },
  );
  expect(response.status).toBe(101);
  let socket = response.webSocket!;
  socket.accept();
  let client = new SocketClient(socket);
  client.send({ type: "JOIN", clientId });
  await client.next("ROOM_STATE");
  return client;
}

class SocketClient {
  private messages: ServerMessage[] = [];
  private waiters: Array<() => void> = [];

  constructor(private socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      let message = parseServerMessage(String(event.data));
      if (message) this.messages.push(message);
      this.waiters.shift()?.();
    });
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  async next<T extends ServerMessage["type"]>(
    type: T,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    return this.waitForMessage(type, 20);
  }

  expectNoMessage(type: ServerMessage["type"]): void {
    expect(this.messages.some((message) => message.type === type)).toBe(false);
  }

  close(): void {
    this.socket.close(1000);
  }

  private async waitForMessage<T extends ServerMessage["type"]>(
    type: T,
    attemptsLeft: number,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    let index = this.messages.findIndex((message) => message.type === type);
    if (index >= 0)
      return this.messages.splice(index, 1)[0] as Extract<
        ServerMessage,
        { type: T }
      >;
    if (attemptsLeft === 0) throw new Error(`Timed out waiting for ${type}`);
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      setTimeout(resolve, 50);
    });
    return this.waitForMessage(type, attemptsLeft - 1);
  }
}

function request(pathname: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(origin + pathname, init));
}

let sessionCookie: string | null = null;

async function authorizedRequest(
  pathname: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!sessionCookie) {
    sessionCookie = await login("Test listener");
  }
  let headers = new Headers(init.headers);
  headers.set("Cookie", sessionCookie!);
  return request(pathname, { ...init, headers });
}

async function login(name: string): Promise<string> {
  let body = new URLSearchParams({
    name,
    password: "test-password",
    roomSlug: "cozy",
  });
  let response = await request("/join", {
    method: "POST",
    body,
    redirect: "manual",
  });
  expect(response.status).toBe(303);
  let cookie = response.headers.get("Set-Cookie")?.split(";", 1)[0];
  expect(cookie).toBeTruthy();
  return cookie!;
}

async function ensureRoom(slug: string, name: string): Promise<void> {
  let response = await env.ROOM_DIRECTORY.getByName("global").fetch(
    `https://directory.test/rooms/${slug}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );
  expect([201, 409]).toContain(response.status);
}
