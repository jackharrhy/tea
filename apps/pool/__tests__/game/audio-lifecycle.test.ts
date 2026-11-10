import { expect, test } from "bun:test";
import { GameAudio } from "../../app/game/audio";

test("disposing audio aborts pending loads without reporting a stale error", async () => {
  const originalContext = Object.getOwnPropertyDescriptor(
    globalThis,
    "AudioContext",
  );
  const originalFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  let fetches = 0;
  let aborted = 0;
  let closed = 0;
  const node = { connect: () => node };
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: class {
      destination = {};
      createGain() {
        return { gain: { value: 0 }, ...node };
      }
      createDynamicsCompressor() {
        return {
          threshold: { value: 0 },
          knee: { value: 0 },
          ratio: { value: 0 },
          attack: { value: 0 },
          release: { value: 0 },
          ...node,
        };
      }
      resume() {
        return Promise.resolve();
      }
      close() {
        closed++;
        return Promise.resolve();
      }
    },
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: (_url: string, options: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        fetches++;
        options.signal!.addEventListener(
          "abort",
          () => {
            aborted++;
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      }),
  });
  try {
    const audio = new GameAudio();
    const errors: string[] = [];
    audio.onError = (message) => errors.push(message);
    audio.enabled = true;
    const loading = audio.resume();
    expect(fetches).toBe(9);
    audio.dispose();
    await loading;
    expect(aborted).toBe(fetches);
    expect(closed).toBe(1);
    expect(errors).toEqual([]);
    expect(audio.toggle()).toBe(false);
  } finally {
    if (originalContext)
      Object.defineProperty(globalThis, "AudioContext", originalContext);
    else Reflect.deleteProperty(globalThis, "AudioContext");
    if (originalFetch)
      Object.defineProperty(globalThis, "fetch", originalFetch);
    else Reflect.deleteProperty(globalThis, "fetch");
  }
});
