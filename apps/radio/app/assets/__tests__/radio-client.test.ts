import * as assert from "remix/assert";
import { afterEach, beforeEach, describe, it } from "remix/test";

import type { RoomSnapshot, Track } from "../../data/protocol.ts";
import { DEFAULT_ROOM_SLUG } from "../../data/room-id.ts";
import { RadioClient } from "../radio-client.ts";

type Listener = (event?: unknown) => void;

class FakeWebSocket {
  static OPEN = 1;
  readyState = FakeWebSocket.OPEN;
  sent: unknown[] = [];
  private listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as unknown);
  }

  close(): void {
    this.readyState = 3;
  }

  emit(type: string, event?: unknown): void {
    for (let listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class FakeMediaElement extends EventTarget {
  src = "";
  preload = "";
  currentTime = 0;
  duration = 120;
  readyState = 0;
  paused = true;
  playbackRate = 1;
  failLoad = false;
  buffered = { length: 0, end: () => 0 } as unknown as TimeRanges;

  load(): void {
    if (!this.src) return;
    queueMicrotask(() => {
      if (this.failLoad) {
        this.dispatchEvent(new Event("error"));
        return;
      }
      this.readyState = 3;
      this.dispatchEvent(new Event("loadedmetadata"));
      this.dispatchEvent(new Event("canplay"));
    });
  }

  async play(): Promise<void> {
    this.paused = false;
    this.dispatchEvent(new Event("playing"));
  }

  pause(): void {
    this.paused = true;
  }

  removeAttribute(name: string): void {
    if (name === "src") this.src = "";
  }

  end(): void {
    this.currentTime = this.duration;
    this.paused = true;
    this.dispatchEvent(new Event("ended"));
  }
}

class FakeAudioManager {
  media = new FakeMediaElement();
  audibleAt: number | null = null;
  mutedAt: number | null = null;

  async resume(): Promise<void> {}
  setMasterGain(): void {}
  connectMediaElement(): void {}
  muteNow(): void {}
  scheduleAudibleAt(localEpochTime: number): number {
    this.audibleAt = localEpochTime;
    return 1;
  }
  scheduleMuteAt(localEpochTime: number): number {
    this.mutedAt = localEpochTime;
    return 1;
  }
  outputLatencyMs(): number {
    return 12;
  }
}

let originalWebSocket: typeof globalThis.WebSocket | undefined;
let originalWindow: typeof globalThis.window | undefined;
let originalFetch: typeof globalThis.fetch | undefined;
let sockets: FakeWebSocket[] = [];
let windowTimers = new Map<number, () => void>();
let windowIntervals = new Map<number, () => void>();
let nextWindowTimerId = 1;

beforeEach(() => {
  sockets = [];
  windowTimers = new Map();
  windowIntervals = new Map();
  nextWindowTimerId = 1;
  originalWebSocket = globalThis.WebSocket;
  originalWindow = globalThis.window;
  originalFetch = globalThis.fetch;

  globalThis.WebSocket = class extends FakeWebSocket {
    constructor(url: string) {
      super(url);
      sockets.push(this);
    }
  } as unknown as typeof WebSocket;

  globalThis.window = {
    setTimeout(callback: () => void) {
      let id = nextWindowTimerId++;
      windowTimers.set(id, callback);
      return id;
    },
    clearTimeout(id: number) {
      windowTimers.delete(id);
    },
    setInterval(callback: () => void) {
      let id = nextWindowTimerId++;
      windowIntervals.set(id, callback);
      return id;
    },
    clearInterval(id: number) {
      windowIntervals.delete(id);
    },
    location: { protocol: "http:", host: "localhost:44100" },
  } as unknown as typeof window;

  globalThis.fetch = async () => new Response(new ArrayBuffer(0));
});

afterEach(() => {
  if (originalWebSocket) globalThis.WebSocket = originalWebSocket;
  if (originalWindow) globalThis.window = originalWindow;
  if (originalFetch) globalThis.fetch = originalFetch;
});

function snapshot(): RoomSnapshot {
  return {
    roomId: DEFAULT_ROOM_SLUG,
    tracks: [
      {
        id: "track-1",
        title: "Track 1",
        url: "/uploads/track-1.mp3",
        addedAt: 1,
      },
      {
        id: "track-2",
        title: "Track 2",
        url: "/uploads/track-2.mp3",
        addedAt: 2,
      },
    ],
    clients: [],
    playback: {
      type: "paused",
      trackId: null,
      trackTimeSeconds: 0,
      serverTimeToExecute: 0,
    },
    volume: 1,
  };
}

function message(type: string, value: unknown): { data: string } {
  return {
    data: JSON.stringify({ type, ...(value as Record<string, unknown>) }),
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("RadioClient playback UI behavior", () => {
  it("loads a paused room's current track so a joining client can seek", async () => {
    let audio = new FakeAudioManager();
    let pausedSnapshot = snapshot();
    pausedSnapshot.playback = {
      type: "paused",
      trackId: "track-1",
      trackTimeSeconds: 37,
      serverTimeToExecute: 0,
    };
    let client = new RadioClient({
      initialSnapshot: pausedSnapshot,
      clientId: "client-1",
      audioManager: audio,
      mediaElement: audio.media as unknown as HTMLMediaElement,
    });
    client.connect();
    let socket = sockets[0];
    socket.emit("open");
    socket.sent = [];

    socket.emit("message", message("ROOM_STATE", { snapshot: pausedSnapshot }));
    await flush();

    assert.equal(client.state.durationSeconds, 120);
    assert.equal(audio.media.currentTime, 37);

    let renamedTrack = {
      ...pausedSnapshot.tracks[0],
      title: "Renamed track",
      url: "/uploads/track-1-Renamed-track.mp3",
    };
    socket.emit(
      "message",
      message("QUEUE_UPDATED", {
        tracks: [renamedTrack, pausedSnapshot.tracks[1]],
      }),
    );
    await flush();
    assert.equal(audio.media.src, renamedTrack.url);
    assert.equal(audio.media.currentTime, 37);

    client.seek(72.5);
    assert.partialDeepEqual(socket.sent.at(-1), {
      type: "PAUSE",
      trackId: "track-1",
      trackTimeSeconds: 72.5,
    });
    client.dispose();
  });

  it("starts a different selected track from 0 instead of reusing current track position", async () => {
    let audio = new FakeAudioManager();
    let client = new RadioClient({
      initialSnapshot: snapshot(),
      clientId: "client-1",
      audioManager: audio,
      mediaElement: audio.media as unknown as HTMLMediaElement,
    });
    client.connect();
    let socket = sockets[0];
    socket.emit("open");
    socket.sent = [];

    socket.emit(
      "message",
      message("SCHEDULED_PLAY", {
        trackId: "track-1",
        trackTimeSeconds: 42,
        serverTimeToExecute: performance.timeOrigin + performance.now(),
      }),
    );
    await flush();
    socket.sent = [];

    client.play("track-2");

    assert.partialDeepEqual(socket.sent.at(-1), {
      type: "PLAY",
      trackId: "track-2",
      trackTimeSeconds: 0,
    });
    client.dispose();
  });

  it("does not report a paused track as naturally ended", async () => {
    let audio = new FakeAudioManager();
    let client = new RadioClient({
      initialSnapshot: snapshot(),
      clientId: "client-1",
      audioManager: audio,
      mediaElement: audio.media as unknown as HTMLMediaElement,
    });
    client.connect();
    let socket = sockets[0];
    socket.emit("open");

    socket.emit(
      "message",
      message("SCHEDULED_PLAY", {
        trackId: "track-1",
        trackTimeSeconds: 30,
        serverTimeToExecute: performance.timeOrigin + performance.now(),
      }),
    );
    await flush();
    socket.emit(
      "message",
      message("SCHEDULED_PAUSE", {
        trackId: "track-1",
        trackTimeSeconds: 12,
        serverTimeToExecute: performance.timeOrigin + performance.now(),
      }),
    );
    await flush();
    audio.media.end();

    assert.equal(client.state.playing, false);
    assert.equal(client.state.positionSeconds, 12);
    assert.equal(client.state.durationSeconds, 120);
    assert.equal(
      socket.sent.some(
        (value) => (value as { type?: string }).type === "TRACK_ENDED",
      ),
      false,
    );
    client.dispose();
  });

  it("reports a natural media ending so the server can advance the queue", async () => {
    let audio = new FakeAudioManager();
    let client = new RadioClient({
      initialSnapshot: snapshot(),
      clientId: "client-1",
      audioManager: audio,
      mediaElement: audio.media as unknown as HTMLMediaElement,
    });
    client.connect();
    let socket = sockets[0];
    socket.emit("open");

    socket.emit(
      "message",
      message("SCHEDULED_PLAY", {
        trackId: "track-1",
        trackTimeSeconds: 0,
        serverTimeToExecute: performance.timeOrigin + performance.now(),
      }),
    );
    await flush();
    socket.sent = [];
    audio.media.end();

    assert.partialDeepEqual(socket.sent.at(-1), {
      type: "TRACK_ENDED",
      trackId: "track-1",
      trackTimeSeconds: 120,
    });
    client.dispose();
  });

  it("sends an NTP request when sync is triggered from the UI", () => {
    let audio = new FakeAudioManager();
    let client = new RadioClient({
      initialSnapshot: snapshot(),
      clientId: "client-1",
      audioManager: audio,
      mediaElement: audio.media as unknown as HTMLMediaElement,
    });
    client.connect();
    let socket = sockets[0];
    socket.emit("open");
    socket.sent = [];

    client.syncNow();

    assert.equal((socket.sent[0] as { type: string }).type, "NTP_REQUEST");
    client.dispose();
  });

  it("schedules the audible gate early by the persisted device compensation", async () => {
    let audio = new FakeAudioManager();
    let client = new RadioClient({
      initialSnapshot: snapshot(),
      clientId: "client-1",
      audioManager: audio,
      mediaElement: audio.media as unknown as HTMLMediaElement,
      deviceCompensationMs: 35,
    });
    client.connect();
    let socket = sockets[0];
    socket.emit("open");
    let target = performance.timeOrigin + performance.now() + 500;

    socket.emit(
      "message",
      message("SCHEDULED_PLAY", {
        trackId: "track-1",
        trackTimeSeconds: 10,
        serverTimeToExecute: target,
      }),
    );
    await flush();

    assert.ok(audio.audibleAt !== null);
    assert.ok(Math.abs(audio.audibleAt - (target - 35)) < 2);
    assert.equal(client.state.outputLatencyMs, 12);
    client.dispose();
  });

  it("disciplines playback drift while a track is running", async () => {
    let audio = new FakeAudioManager();
    let client = new RadioClient({
      initialSnapshot: snapshot(),
      clientId: "client-1",
      audioManager: audio,
      mediaElement: audio.media as unknown as HTMLMediaElement,
    });
    client.connect();
    let socket = sockets[0];
    socket.emit("open");
    let target = performance.timeOrigin + performance.now();
    socket.emit(
      "message",
      message("SCHEDULED_PLAY", {
        trackId: "track-1",
        trackTimeSeconds: 10,
        serverTimeToExecute: target,
      }),
    );
    await flush();
    audio.media.currentTime = 10.2;

    windowIntervals.values().next().value?.();

    assert.equal(audio.media.playbackRate, 0.9992);
    assert.ok(client.state.playbackErrorMs > 190);
    client.dispose();
  });

  it("does not reconnect after disposal", () => {
    let audio = new FakeAudioManager();
    let client = new RadioClient({
      initialSnapshot: snapshot(),
      clientId: "client-1",
      audioManager: audio,
      mediaElement: audio.media as unknown as HTMLMediaElement,
    });
    client.connect();
    let socket = sockets[0];
    socket.emit("open");

    assert.equal(windowTimers.size, 1);
    client.dispose();
    socket.emit("close");

    assert.equal(windowTimers.size, 0);
    assert.equal(sockets.length, 1);
  });

  it("does not report a failed track load as ready", async () => {
    let audio = new FakeAudioManager();
    audio.media.failLoad = true;
    let client = new RadioClient({
      initialSnapshot: snapshot(),
      clientId: "client-1",
      audioManager: audio,
      mediaElement: audio.media as unknown as HTMLMediaElement,
    });
    client.connect();
    let socket = sockets[0];
    socket.emit("open");
    socket.sent = [];

    socket.emit(
      "message",
      message("LOAD_TRACK", { track: snapshot().tracks[0] }),
    );
    await flush();

    assert.equal(
      socket.sent.some(
        (value) => (value as { type?: string }).type === "TRACK_READY",
      ),
      false,
    );
    assert.equal(client.state.status, "Could not load Track 1");
    client.dispose();
  });

  it("surfaces an upload failure in client state", async () => {
    globalThis.fetch = async () =>
      Response.json({ error: "Uploads are unavailable" }, { status: 503 });
    let audio = new FakeAudioManager();
    let client = new RadioClient({
      initialSnapshot: snapshot(),
      clientId: "client-1",
      audioManager: audio,
      mediaElement: audio.media as unknown as HTMLMediaElement,
    });

    await client.upload(
      new File(["audio"], "track.mp3", { type: "audio/mpeg" }),
    );

    assert.equal(client.state.status, "Uploads are unavailable");
    client.dispose();
  });

  it("adds an uploading row immediately and updates byte progress", async () => {
    let pendingTrack = {
      id: "track-upload",
      title: "Long mix",
      url: "/uploads/track-upload-Long-mix.mp3",
      addedAt: 3,
      mediaType: "audio/mpeg",
      upload: {
        status: "uploading" as const,
        bytesReceived: 0,
        sizeBytes: 10,
      },
    };
    globalThis.fetch = async () =>
      Response.json({ track: pendingTrack }, { status: 201 });
    let audio = new FakeAudioManager();
    let sawHalfUploaded = false;
    let client!: RadioClient;
    client = new RadioClient({
      initialSnapshot: snapshot(),
      clientId: "client-1",
      audioManager: audio,
      mediaElement: audio.media as unknown as HTMLMediaElement,
      uploadContent: async ({ onProgress }) => {
        onProgress({ bytesSent: 5, sizeBytes: 10 });
        sawHalfUploaded =
          client.state.tracks.find((track) => track.id === pendingTrack.id)
            ?.upload?.bytesReceived === 5;
        let completedTrack: Track = { ...pendingTrack };
        delete completedTrack.upload;
        return completedTrack;
      },
    });

    await client.upload(
      new File(["0123456789"], "Long mix.mp3", { type: "audio/mpeg" }),
    );

    assert.equal(sawHalfUploaded, true);
    assert.equal(client.state.tracks.at(-1)?.upload, undefined);
    assert.equal(client.state.status, "Upload complete");
    client.dispose();
  });

  it("sends queue commands and exposes client buffering counts", async () => {
    let audio = new FakeAudioManager();
    let client = new RadioClient({
      initialSnapshot: snapshot(),
      clientId: "client-1",
      audioManager: audio,
      mediaElement: audio.media as unknown as HTMLMediaElement,
    });
    client.connect();
    let socket = sockets[0];
    socket.emit("open");
    socket.sent = [];

    client.renameTrack("track-1", "New title");
    assert.partialDeepEqual(socket.sent.at(-1), {
      type: "RENAME_TRACK",
      trackId: "track-1",
      title: "New title",
    });

    client.reorderTracks(["track-2", "track-1"]);
    assert.deepEqual(
      client.state.tracks.map((track) => track.id),
      ["track-2", "track-1"],
    );
    assert.partialDeepEqual(socket.sent.at(-1), {
      type: "REORDER_TRACKS",
      trackIds: ["track-2", "track-1"],
    });

    socket.emit(
      "message",
      message("TRACK_BUFFERING", {
        trackId: "track-1",
        readyClientCount: 1,
        totalClientCount: 3,
      }),
    );
    await flush();
    assert.equal(client.state.bufferingTrackId, "track-1");
    assert.equal(client.state.readyClientCount, 1);
    assert.equal(client.state.totalClientCount, 3);
    client.dispose();
  });
});
