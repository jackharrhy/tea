import * as assert from "remix/assert";
import { it } from "remix/test";
import type { Handle } from "remix/component";

import type { RoomSnapshot } from "../../data/protocol.ts";
import { DEFAULT_ROOM_SLUG } from "../../data/room-id.ts";
import { createClientId, RadioRoom } from "../radio-room.tsx";

class FakeWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;

  readyState = FakeWebSocket.CONNECTING;
  closeCount = 0;

  constructor(readonly url: string) {
    super();
  }

  send(): void {}

  close(): void {
    this.closeCount++;
    this.readyState = 3;
  }
}

class FakeAudioContext {
  currentTime = 0;
  destination = {} as AudioDestinationNode;
  state = "running" as AudioContextState;

  createGain(): GainNode {
    return {
      connect() {},
      gain: {
        value: 1,
        cancelScheduledValues() {},
        linearRampToValueAtTime() {},
        setValueAtTime() {},
      },
    } as unknown as GainNode;
  }

  createAnalyser(): AnalyserNode {
    return {
      connect() {},
      fftSize: 0,
      smoothingTimeConstant: 0,
    } as unknown as AnalyserNode;
  }

  createMediaElementSource(): MediaElementAudioSourceNode {
    return { connect() {} } as unknown as MediaElementAudioSourceNode;
  }
}

class FakeMediaElement extends EventTarget {
  src = "";
  preload = "";
  currentTime = 0;
  duration = Number.NaN;
  readyState = 0;
  buffered = { length: 0, end: () => 0 } as unknown as TimeRanges;
  pause(): void {}
  load(): void {}
  async play(): Promise<void> {}
  removeAttribute(): void {}
}

function snapshot(): RoomSnapshot {
  return {
    roomId: DEFAULT_ROOM_SLUG,
    tracks: [],
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

it("creates a client ID when randomUUID is unavailable on an HTTP origin", () => {
  let id = createClientId({
    getRandomValues(array) {
      array.fill(0xab);
      return array;
    },
  });

  assert.equal(id, "abababab-abab-4bab-abab-abababababab");
});

it("keeps a connecting WebSocket alive across the initial component update", () => {
  let originalAudioContext = globalThis.AudioContext;
  let originalDocument = globalThis.document;
  let originalLocalStorage = globalThis.localStorage;
  let originalWebSocket = globalThis.WebSocket;
  let originalWindow = globalThis.window;
  let sockets: FakeWebSocket[] = [];
  let storage = new Map([["radio.clientId", "client-1"]]);

  try {
    globalThis.AudioContext =
      FakeAudioContext as unknown as typeof AudioContext;
    globalThis.document = {
      documentElement: { clientWidth: 960 },
      createElement(name: string) {
        if (name === "audio") return new FakeMediaElement();
        throw new Error(`Unexpected element: ${name}`);
      },
    } as unknown as Document;
    globalThis.localStorage = {
      getItem(key: string) {
        return storage.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        storage.set(key, value);
      },
    } as Storage;
    globalThis.WebSocket = class extends FakeWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    } as unknown as typeof WebSocket;
    globalThis.window = Object.assign(new EventTarget(), {
      innerWidth: 960,
      location: { protocol: "http:", host: "localhost:44100" },
    }) as typeof window;

    let componentController = new AbortController();
    let queuedTask: ((signal: AbortSignal) => void) | undefined;
    let handle = {
      props: { initialSnapshot: snapshot(), roomName: "cozy" },
      signal: componentController.signal,
      queueTask(task: (signal: AbortSignal) => void) {
        queuedTask = task;
      },
      update: async () => new AbortController().signal,
    } as unknown as Handle<{ initialSnapshot: RoomSnapshot; roomName: string }>;

    RadioRoom(handle);
    if (!queuedTask)
      throw new Error("RadioRoom did not queue its initial task");

    let renderController = new AbortController();
    queuedTask(renderController.signal);
    assert.equal(sockets.length, 1);

    renderController.abort();
    assert.equal(sockets[0].closeCount, 0);

    componentController.abort();
    assert.equal(sockets[0].closeCount, 1);
  } finally {
    globalThis.AudioContext = originalAudioContext;
    globalThis.document = originalDocument;
    globalThis.localStorage = originalLocalStorage;
    globalThis.WebSocket = originalWebSocket;
    globalThis.window = originalWindow;
  }
});
