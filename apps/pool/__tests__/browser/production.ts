import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { INPUT_DT, PROTOCOL_VERSION } from "@tea/pool-protocol";
import type {
  ClientMessage,
  MoveInput,
  ServerMessage,
  Snapshot,
} from "@tea/pool-protocol";
import {
  addAvatar,
  createMovementWorld,
  findPath,
  stepAvatar,
} from "@tea/pool-simulation";
import { tableSeatPosition } from "@tea/pool-simulation/geometry";
import { walkDirection } from "../../app/game/input/walking";

const baseURL = process.env.POOL_E2E_URL ?? "http://127.0.0.1:3188";
async function until(check: () => boolean, label: string, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    assert(Date.now() < deadline, `Timed out: ${label}`);
    await Bun.sleep(25);
  }
}
async function asset(path: string, contentType: RegExp) {
  const response = await fetch(new URL(path, baseURL));
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get("content-type") ?? "", contentType, path);
  assert((await response.arrayBuffer()).byteLength > 0, `${path} has content`);
}
assert((await fetch(new URL("/api/health", baseURL))).ok, "production health");
const response = await fetch(baseURL);
assert.equal(response.status, 200);
assert.match(response.headers.get("content-type") ?? "", /text\/html/);
const html = await response.text();
assert.match(html, /Pool · Tea/);
assert.doesNotMatch(html, /@vite\/client|\/src\/.*\.ts|react-refresh/);
for (const [path, mime] of [
  ["/assets/game.js", /javascript/],
  ["/assets/game.css", /text\/css/],
] as const) {
  assert(html.includes(`"${path}"`), `HTML links ${path}`);
  await asset(path, mime);
}
for (const texture of ["walnut", "aged-brass"])
  await asset(`/textures/${texture}.webp`, /image\/webp/);

for (const sound of [
  "impact",
  "cue",
  "cue-cloth",
  "return",
  "pocket",
  "felt",
  "rolling-loop",
  "impact-dry",
  "felt-roll",
])
  await asset(`/audio/${sound}.wav`, /audio\/(?:x-)?wav/);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? chromium.executablePath(),
  headless: true,
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const peers: WebSocket[] = [];
try {
  const page = await browser.newPage({
    viewport: { width: 960, height: 720 },
    deviceScaleFactor: 0.5,
  });
  const errors: string[] = [];
  const messages: ServerMessage[] = [];
  const browserSockets: { isClosed(): boolean }[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname !== "/ws") return;
    browserSockets.push(socket);
    socket.on("framereceived", ({ payload }) =>
      messages.push(JSON.parse(String(payload)) as ServerMessage),
    );
  });
  await page.goto(baseURL);
  await expect(page.locator("#world")).toBeVisible();
  await expect(page.locator("#entry button")).toBeEnabled({ timeout: 30_000 });
  await until(
    () => messages.filter((m) => m.type === "state").length >= 3,
    "live anonymous snapshots",
  );
  assert(
    !messages.some((m) => m.type === "welcome"),
    "preview stays anonymous",
  );
  await page.locator("#name").fill("Production smoke");
  await page.locator("#player-color").fill("#39aabb");
  await page.locator("#entry button").click();
  await expect(page.locator("#entry")).toBeHidden();
  await until(() => {
    const welcome = messages.find((m) => m.type === "welcome");
    const state = [...messages].toReversed().find((m) => m.type === "state");
    return (
      !!welcome &&
      state?.players.some(
        (p) =>
          p.id === welcome.id &&
          p.name === "Production smoke" &&
          p.color === 0x39aabb,
      ) === true
    );
  }, "browser identity and colour in authoritative state");
  await page.locator("#chat-toggle").click();
  await page.locator("#chat-input").fill("Production smoke chat");
  await page.locator("#chat-input").press("Enter");
  await expect(page.locator("#messages")).toContainText(
    "Production smoke chat",
  );
  assert(
    messages.some(
      (m) => m.type === "chat" && m.text === "Production smoke chat",
    ),
    "chat round trip over WebSocket",
  );
  assert.deepEqual(errors, [], "browser runtime errors");
  assert.equal(
    browserSockets.length,
    2,
    "preview and player sockets were opened",
  );
  const oldPlayerId = messages.find(
    (message) => message.type === "welcome",
  )!.id;
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await until(
    () => browserSockets.every((socket) => socket.isClosed()),
    "mounted game closes its sockets on disposal",
  );
  await page.goto("about:blank");
  const beforeRemount = messages.length;
  await page.goto(baseURL);
  await expect(page.locator("#entry button")).toBeEnabled({ timeout: 30_000 });
  assert.equal(
    await page.locator("canvas#world").count(),
    1,
    "one remounted canvas",
  );
  assert.equal(
    browserSockets.length,
    3,
    "one new spectator socket after remount",
  );
  await until(
    () =>
      messages
        .slice(beforeRemount)
        .some(
          (message) =>
            message.type === "state" &&
            message.players.some(
              (avatar) => avatar.id === oldPlayerId && !avatar.connected,
            ),
        ),
    "unmounted player disconnects on the server",
  );
  assert.deepEqual(errors, [], "remount has no browser runtime errors");
  await page.close();

  const wsURL = new URL("/ws", baseURL);
  wsURL.protocol = wsURL.protocol === "https:" ? "wss:" : "ws:";
  async function player(name: string) {
    const socket = new WebSocket(wsURL.href);
    peers.push(socket);
    let state: Snapshot | undefined;
    let id = "";
    const received: ServerMessage[] = [];
    let failure: Error | undefined;
    socket.addEventListener("open", () =>
      send({ type: "hello", version: PROTOCOL_VERSION, name }),
    );
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data)) as ServerMessage;
      received.push(message);
      if (message.type === "state") state = message;
      if (message.type === "welcome") id = message.id;
      if (message.type === "error") failure = new Error(message.text);
    });
    socket.addEventListener("error", () => {
      failure = new Error(`${name}: WebSocket error`);
    });
    const send = (message: ClientMessage) =>
      socket.send(JSON.stringify(message));
    const wait = (check: () => boolean, label: string) =>
      until(() => {
        if (failure) throw failure;
        return check();
      }, label);
    await wait(() => !!id && !!state, `${name} connected`);
    return {
      send,
      wait,
      received,
      get state() {
        return state!;
      },
      get id() {
        return id;
      },
    };
  }
  const one = await player("Smoke one");
  const two = await player("Smoke two");
  const tableId = one.state.tables.find((t) =>
    t.match.players.every((p) => p === null),
  )?.id;
  assert(tableId, "smoke requires an idle table");
  for (const [seat, peer] of [one, two].entries()) {
    const initial = peer.state.players.find((p) => p.id === peer.id)!;
    const route = findPath(
      initial,
      tableSeatPosition(tableId, seat as 0 | 1),
    ).slice(1);
    const world = createMovementWorld();
    const avatar = addAvatar(world, initial.x, initial.z);
    let position = { x: initial.x, z: initial.z };
    let seq = Math.max(initial.seq, initial.retiredSeq);
    for (let batch = 0; route.length && batch < 200; batch++) {
      const inputs: MoveInput[] = [];
      while (route.length && inputs.length < 6) {
        if (
          Math.hypot(route[0].x - position.x, route[0].z - position.z) < 0.02
        ) {
          route.shift();
          continue;
        }
        const direction = walkDirection(
          position,
          route[0],
          route.length === 1 ? "final" : "intermediate",
        );
        inputs.push({ seq: ++seq, ...direction });
        position = stepAvatar(
          world,
          avatar,
          direction.x,
          direction.z,
          INPUT_DT,
        );
      }
      if (!inputs.length) break;
      peer.send({ type: "move", inputs });
      await peer.wait(
        () => peer.state.players.find((p) => p.id === peer.id)!.seq === seq,
        "walking inputs consumed",
      );
    }
    assert.equal(route.length, 0, "seat route completed");
    peer.send({ type: "join", table: tableId });
    await peer.wait(
      () => peer.state.players.find((p) => p.id === peer.id)?.table === tableId,
      "authoritative seat",
    );
  }
  await one.wait(
    () =>
      one.state.tables.find((t) => t.id === tableId)!.match.phase === "aiming",
    "match ready",
  );
  const ready = one.state.tables.find((t) => t.id === tableId)!;
  const shooter = [one, two].find(
    (p) => p.id === ready.match.players[ready.match.turn],
  )!;
  const cue = ready.balls.find((b) => b.id === 0)!;
  const target = ready.balls.find((b) => b.id === 1)!;
  const shotId = crypto.randomUUID();
  shooter.send({
    type: "shot",
    id: shotId,
    table: tableId,
    turn: ready.match.shotNumber,
    angle: Math.atan2(target.z - cue.z, target.x - cue.x),
    power: 0.85,
  });
  await shooter.wait(
    () =>
      shooter.received.some(
        (m) => m.type === "shot-ack" && m.id === shotId && m.accepted,
      ),
    "shot accepted",
  );
  await two.wait(
    () =>
      two.received.some(
        (m) =>
          m.type === "state" &&
          m.tables.some((t) => t.id === tableId && t.match.phase === "rolling"),
      ),
    "shot broadcast to opponent",
  );
  console.log(
    "Production smoke passed: assets, browser entry/chat, anonymous snapshots, seats and shot.",
  );
} finally {
  for (const peer of peers) {
    if (peer.readyState === WebSocket.OPEN)
      peer.send(JSON.stringify({ type: "leave" } satisfies ClientMessage));
    peer.close();
  }
  await browser.close();
}
