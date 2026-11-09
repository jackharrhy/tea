import { afterEach, expect, spyOn, test } from "bun:test";
import type { ClientMessage, ServerMessage } from "@tea/pool-protocol";
import { Session } from "../../app/game/session";

class Socket extends EventTarget {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  sent: ClientMessage[] = [];
  constructor(readonly url: string) {
    super();
    Socket.instances.push(this);
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }
  close(code = 1000) {
    this.dispatchEvent(Object.assign(new Event("close"), { code }));
  }
  message(message: ServerMessage) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(message) }),
    );
  }
}
const originals = new Map<string, PropertyDescriptor | undefined>();
function replace(name: string, value: unknown) {
  originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}
afterEach(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  originals.clear();
  Socket.instances = [];
});
function setup() {
  const tokens = new Map<string, string>();
  replace("WebSocket", Socket);
  replace("location", { protocol: "https:", host: "hall.test" });
  replace("sessionStorage", {
    getItem: (key: string) => tokens.get(key),
    setItem: (key: string, value: string) => tokens.set(key, value),
  });
  const messages: ServerMessage[] = [],
    statuses: string[] = [];
  let closed = 0;
  const session = new Session(() => ({ name: "Player", color: 123 }), {
    message: (message) => {
      if (message.type === "welcome") {
        expect(session.connected).toBe(true);
        expect(tokens.get("8ball.token")).toBe(message.token);
      }
      messages.push(message);
    },
    closed: () => {
      expect(session.connected).toBe(false);
      closed++;
    },
    status: (text) => statuses.push(text),
    notice: () => {},
  });
  return { session, tokens, messages, statuses, closed: () => closed };
}

test("watch-to-player replacement ignores stale socket events and resumes with the saved token", () => {
  const { session, tokens, messages, statuses, closed } = setup();
  session.connect(true);
  const watch = Socket.instances[0];
  expect(watch.url).toBe("wss://hall.test/ws?watch=1");
  watch.dispatchEvent(new Event("open"));
  expect(watch.sent).toHaveLength(0);
  tokens.set("8ball.token", "resume");
  session.connect();
  const active = Socket.instances[1];
  watch.dispatchEvent(new Event("open"));
  watch.message({ type: "welcome", id: "stale", token: "stale" });
  watch.dispatchEvent(new Event("error"));
  expect(messages).toHaveLength(0);
  expect(closed()).toBe(0);
  expect(statuses.at(-1)).toBe("Joining…");
  active.dispatchEvent(new Event("open"));
  expect(active.sent).toMatchObject([
    { type: "hello", name: "Player", token: "resume" },
  ]);
  active.message({ type: "welcome", id: "player", token: "new" });
  expect(tokens.get("8ball.token")).toBe("new");
  expect(messages).toHaveLength(1);
});

test("watch reconnect retains preview mode; session takeover stops reconnection", () => {
  const { session, closed } = setup();
  const timers: { callback: () => void; delay: number }[] = [];
  const timer = spyOn(globalThis, "setTimeout").mockImplementation(((
    callback: () => void,
    delay: number,
  ) => {
    timers.push({ callback, delay });
    return 1;
  }) as unknown as typeof setTimeout);
  const clear = spyOn(globalThis, "clearTimeout").mockImplementation(() => {});
  try {
    session.connect(true);
    Socket.instances[0].close(1006);
    expect(timers[0].delay).toBe(1000);
    timers[0].callback();
    expect(Socket.instances[1].url).toEndWith("?watch=1");
    Socket.instances[1].close(1006);
    expect(timers[1].delay).toBe(2000);
    timers[1].callback();
    session.connect();
    const player = Socket.instances[3];
    player.message({ type: "welcome", id: "player", token: "resume" });
    player.close(1006);
    expect(timers[2].delay).toBe(1000);
    timers[2].callback();
    expect(Socket.instances[4].url).toBe("wss://hall.test/ws");
    Socket.instances[4].close(4001);
    expect(timers).toHaveLength(3);
    expect(closed()).toBe(4);
  } finally {
    timer.mockRestore();
    clear.mockRestore();
  }
});
