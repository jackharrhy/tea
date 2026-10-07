import { DurableObject } from "cloudflare:workers";

import {
  encodeServerMessage,
  parseClientMessage,
  type ClientInfo,
  type ServerMessage,
} from "./protocol.ts";
import { RadioRoomStore } from "./radio-room-store.ts";
import { calculateScheduleTimeMs, DEFAULT_CLIENT_RTT_MS } from "./timing.ts";
import {
  normalizeTrackTitle,
  parseUploadMetadata,
  validateUploadMetadata,
} from "./track-metadata.ts";

type SocketAttachment =
  | { state: "pending"; name: string }
  | ({ state: "joined" } & ClientInfo);
type JoinedSocketAttachment = Extract<SocketAttachment, { state: "joined" }>;

const AUDIO_LOAD_TIMEOUT_MS = 3000;

export class RadioRoomCell extends DurableObject<Env> {
  private store: RadioRoomStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new RadioRoomStore(ctx.storage);
    ctx.blockConcurrencyWhile(async () => this.store.initialize());
  }

  async fetch(request: Request): Promise<Response> {
    let roomSlug = request.headers.get("x-radio-room");
    if (!roomSlug) return new Response("Missing room", { status: 400 });
    this.store.ensureRoom(roomSlug);

    let url = new URL(request.url);
    if (url.pathname === "/websocket") return this.acceptSocket(request);
    if (request.method === "GET" && url.pathname === "/snapshot") {
      return Response.json(this.store.snapshot(this.clients()), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (request.method === "POST" && url.pathname === "/tracks") {
      return this.reserveTrack(request);
    }
    return this.trackUploadRequest(request, url.pathname);
  }

  alarm(): void {
    this.flushPendingPlay();
  }

  async webSocketMessage(
    socket: WebSocket,
    raw: string | ArrayBuffer,
  ): Promise<void> {
    let message = parseSocketMessage(raw);
    if (!message) {
      this.send(socket, { type: "ERROR", message: "Invalid message" });
      return;
    }
    if (message.type === "JOIN") {
      this.join(socket, message.clientId);
      return;
    }

    let client = socket.deserializeAttachment() as SocketAttachment | null;
    if (!client || client.state !== "joined") {
      this.send(socket, {
        type: "ERROR",
        message: "Join before sending commands",
      });
      return;
    }
    client.lastSeenAt = Date.now();

    if (message.type === "NTP_REQUEST") {
      this.processClockProbe(socket, client, message);
      return;
    }

    switch (message.type) {
      case "TRACK_READY":
        this.markTrackReady(client.clientId, message.trackId);
        break;
      case "PLAY":
        await this.requestPlay(
          socket,
          message.trackId,
          message.trackTimeSeconds,
        );
        break;
      case "PAUSE":
        this.requestPause(message.trackId, message.trackTimeSeconds);
        break;
      case "SET_VOLUME":
        this.broadcast({
          type: "VOLUME_UPDATED",
          volume: this.store.setVolume(message.volume),
        });
        break;
      case "REMOVE_TRACK":
        await this.removeTrack(message.trackId);
        break;
      case "RENAME_TRACK":
        this.renameTrack(socket, message.trackId, message.title);
        break;
      case "TRACK_ENDED":
        await this.trackEnded(
          socket,
          message.trackId,
          message.trackTimeSeconds,
        );
        break;
      case "REORDER_TRACKS":
        if (this.store.reorderTracks(message.trackIds)) this.broadcastQueue();
        break;
      case "LIVENESS_PONG":
        socket.serializeAttachment(client);
        break;
    }
  }

  webSocketClose(): void {
    this.connectionLeft();
  }

  webSocketError(): void {
    this.connectionLeft();
  }

  private trackUploadRequest(request: Request, pathname: string): Response {
    let match = /^\/tracks\/([^/]+)\/(upload|complete|failed)$/.exec(pathname);
    if (!match) return new Response("Not Found", { status: 404 });
    let trackId = decodeURIComponent(match[1]!);

    if (request.method === "GET" && match[2] === "upload") {
      let track = this.store.track(trackId);
      return track?.upload?.status === "uploading"
        ? Response.json({ track, objectKey: this.store.objectKey(trackId) })
        : Response.json({ error: "Upload no longer exists" }, { status: 404 });
    }
    if (request.method !== "POST")
      return new Response("Method Not Allowed", { status: 405 });

    if (match[2] === "complete") {
      let track = this.store.completeUpload(trackId);
      if (!track)
        return Response.json(
          { error: "Upload no longer exists" },
          { status: 404 },
        );
      this.broadcastQueue();
      return Response.json({ track });
    }
    if (match[2] === "failed") {
      this.store.failUpload(trackId);
      this.broadcastQueue();
      return Response.json({ ok: true });
    }
    return new Response("Not Found", { status: 404 });
  }

  private async reserveTrack(request: Request): Promise<Response> {
    let input = parseUploadMetadata(await request.json().catch(() => null));
    if (!input)
      return Response.json(
        { error: "Invalid upload metadata" },
        { status: 400 },
      );
    let error = validateUploadMetadata(input);
    if (error) return Response.json({ error }, { status: 400 });

    let track = this.store.reserveTrack(input);
    this.broadcastQueue();
    return Response.json({ track }, { status: 201 });
  }

  private acceptSocket(request: Request): Response {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    let pair = new WebSocketPair();
    let name = request.headers.get("x-radio-listener-name")?.trim();
    if (!name)
      return new Response("Missing listener identity", { status: 401 });
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({
      state: "pending",
      name,
    } satisfies SocketAttachment);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private join(socket: WebSocket, clientId: string): void {
    let previous = socket.deserializeAttachment() as SocketAttachment | null;
    if (!previous) {
      this.send(socket, {
        type: "ERROR",
        message: "Missing listener identity",
      });
      socket.close(1008);
      return;
    }
    for (let existing of this.ctx.getWebSockets()) {
      let info = existing.deserializeAttachment() as SocketAttachment | null;
      if (
        existing !== socket &&
        info?.state === "joined" &&
        info.clientId === clientId
      ) {
        existing.close(1000);
      }
    }
    socket.serializeAttachment({
      state: "joined",
      clientId,
      name: previous.name,
      rtt: previous.state === "joined" ? previous.rtt : 0,
      compensationMs: previous.state === "joined" ? previous.compensationMs : 0,
      nudgeMs: previous.state === "joined" ? previous.nudgeMs : 0,
      joinedAt: previous.state === "joined" ? previous.joinedAt : Date.now(),
      lastSeenAt: Date.now(),
    } satisfies SocketAttachment);
    this.send(socket, {
      type: "ROOM_STATE",
      snapshot: this.store.snapshot(this.clients()),
    });
    this.broadcastPresence();
    this.syncLateClient(socket);
  }

  private processClockProbe(
    socket: WebSocket,
    client: JoinedSocketAttachment,
    message: Extract<
      ReturnType<typeof parseClientMessage>,
      { type: "NTP_REQUEST" }
    >,
  ): void {
    if (message.clientRTT !== undefined && message.clientRTT > 0) {
      client.rtt =
        client.rtt > 0
          ? client.rtt * 0.8 + message.clientRTT * 0.2
          : message.clientRTT;
    }
    if (
      message.clientCompensationMs !== undefined &&
      message.clientCompensationMs >= 0
    ) {
      client.compensationMs = message.clientCompensationMs;
    }
    if (message.clientNudgeMs !== undefined)
      client.nudgeMs = message.clientNudgeMs;
    socket.serializeAttachment(client);
    let t1 = Date.now();
    this.send(socket, {
      type: "NTP_RESPONSE",
      t0: message.t0,
      t1,
      t2: Date.now(),
      probeGroupId: message.probeGroupId,
      probeGroupIndex: message.probeGroupIndex,
    });
  }

  private async requestPlay(
    socket: WebSocket,
    trackId: string,
    trackTimeSeconds: number,
  ): Promise<void> {
    let track = this.store.track(trackId);
    if (!track || track.upload) {
      this.send(socket, {
        type: "ERROR",
        message: track ? "Track is uploading" : "Track no longer exists",
      });
      return;
    }
    let deadline = Date.now() + AUDIO_LOAD_TIMEOUT_MS;
    this.store.replacePendingPlay(trackId, trackTimeSeconds, deadline);
    await this.ctx.storage.setAlarm(deadline);
    this.broadcast({ type: "LOAD_TRACK", track });
    this.broadcastBuffering();
    this.maybeFlushPendingPlay();
  }

  private markTrackReady(clientId: string, trackId: string): void {
    let pending = this.store.pendingPlay();
    if (!pending || pending.trackId !== trackId) return;
    this.store.markReady(clientId);
    this.broadcastBuffering();
    this.maybeFlushPendingPlay();
  }

  private maybeFlushPendingPlay(): void {
    if (
      this.store.pendingPlay() &&
      this.store.readyCount() >= this.clients().length
    ) {
      this.flushPendingPlay();
    }
  }

  private flushPendingPlay(): void {
    let pending = this.store.pendingPlay();
    if (!pending) return;
    let serverTimeToExecute = this.scheduledExecutionTime();
    this.store.clearPendingPlay();
    this.store.play(
      pending.trackId,
      pending.trackTimeSeconds,
      serverTimeToExecute,
    );
    this.broadcast({
      type: "SCHEDULED_PLAY",
      trackId: pending.trackId,
      trackTimeSeconds: pending.trackTimeSeconds,
      serverTimeToExecute,
    });
  }

  private requestPause(trackId: string, trackTimeSeconds: number): void {
    if (!this.store.track(trackId)) return;
    let serverTimeToExecute = this.scheduledExecutionTime();
    this.store.pause(trackId, trackTimeSeconds, serverTimeToExecute);
    this.broadcast({
      type: "SCHEDULED_PAUSE",
      trackId,
      trackTimeSeconds: Math.max(0, trackTimeSeconds),
      serverTimeToExecute,
    });
  }

  private renameTrack(
    socket: WebSocket,
    trackId: string,
    requestedTitle: string,
  ): void {
    let track = this.store.track(trackId);
    let title = normalizeTrackTitle(requestedTitle);
    if (!track || track.upload || !title) {
      this.send(socket, { type: "ERROR", message: "Track cannot be renamed" });
      return;
    }
    this.store.renameTrack(trackId, title);
    this.broadcastQueue();
  }

  private async removeTrack(trackId: string): Promise<void> {
    if (!this.store.track(trackId)) return;
    await this.env.TRACKS.delete(this.store.objectKey(trackId));
    this.store.removeTrack(trackId);
    this.broadcastQueue();
    this.broadcast({
      type: "ROOM_STATE",
      snapshot: this.store.snapshot(this.clients()),
    });
  }

  private async trackEnded(
    socket: WebSocket,
    trackId: string,
    trackTimeSeconds: number,
  ): Promise<void> {
    let playback = this.store.playback();
    if (
      playback.type !== "playing" ||
      playback.trackId !== trackId ||
      this.store.pendingPlay()
    ) {
      return;
    }
    let playable = this.store.tracks().filter((track) => !track.upload);
    let index = playable.findIndex((track) => track.id === trackId);
    let next =
      playable.length > 1 && index >= 0
        ? playable[(index + 1) % playable.length]
        : null;
    this.store.markTrackEnded(trackTimeSeconds);
    if (next) await this.requestPlay(socket, next.id, 0);
    else
      this.broadcast({
        type: "ROOM_STATE",
        snapshot: this.store.snapshot(this.clients()),
      });
  }

  private scheduledExecutionTime(): number {
    let maxRtt = DEFAULT_CLIENT_RTT_MS;
    let maxCompensation = 0;
    for (let client of this.clients()) {
      maxRtt = Math.max(maxRtt, client.rtt);
      maxCompensation = Math.max(maxCompensation, client.compensationMs);
    }
    return (
      Date.now() +
      Math.max(calculateScheduleTimeMs(maxRtt), maxCompensation + 200)
    );
  }

  private syncLateClient(socket: WebSocket): void {
    let playback = this.store.playback();
    if (playback.type !== "playing" || !playback.trackId) return;
    let serverTimeToExecute = this.scheduledExecutionTime() + 1500;
    this.send(socket, {
      type: "SCHEDULED_PLAY",
      trackId: playback.trackId,
      trackTimeSeconds:
        playback.trackTimeSeconds +
        (serverTimeToExecute - playback.serverTimeToExecute) / 1000,
      serverTimeToExecute,
    });
  }

  private clients(): ClientInfo[] {
    return this.ctx
      .getWebSockets()
      .map(
        (socket) => socket.deserializeAttachment() as SocketAttachment | null,
      )
      .filter(
        (info): info is JoinedSocketAttachment => info?.state === "joined",
      );
  }

  private connectionLeft(): void {
    this.broadcastPresence();
    this.maybeFlushPendingPlay();
  }

  private broadcastBuffering(): void {
    let pending = this.store.pendingPlay();
    if (!pending) return;
    this.broadcast({
      type: "TRACK_BUFFERING",
      trackId: pending.trackId,
      readyClientCount: this.store.readyCount(),
      totalClientCount: this.clients().length,
    });
  }

  private broadcastPresence(): void {
    this.broadcast({ type: "PRESENCE", clients: this.clients() });
  }

  private broadcastQueue(): void {
    this.broadcast({ type: "QUEUE_UPDATED", tracks: this.store.tracks() });
  }

  private broadcast(message: ServerMessage): void {
    let encoded = encodeServerMessage(message);
    for (let socket of this.ctx.getWebSockets()) socket.send(encoded);
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    socket.send(encodeServerMessage(message));
  }
}

function parseSocketMessage(raw: string | ArrayBuffer) {
  try {
    return parseClientMessage(
      typeof raw === "string"
        ? JSON.parse(raw)
        : JSON.parse(new TextDecoder().decode(raw)),
    );
  } catch {
    return null;
  }
}
