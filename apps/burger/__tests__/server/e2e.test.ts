import { expect, test, beforeEach, afterEach } from "bun:test";
import { removeEntity } from "bitecs";
import { Database } from "bun:sqlite";
import {
  applyInputToVelocity,
  moveAndSlide,
  SERVER_TICK_RATE_MS,
  PROTOCOL_VERSION,
  MAX_INPUT_MSEC,
  MAX_INPUTS_PER_TICK,
  MESSAGE_TYPES,
  PLAYER_SPEED,
  type PlayerState,
} from "@harrhy/burger-core";
import {
  createServer,
  getPlayerConnections,
  processPlayerInputs,
  broadcastGameState,
} from "../../server/network.server";
import { createPlayer } from "../../server/players";
import { runMigrations } from "../../server/db";
import { createSession } from "../../server/auth/sessions";
import type { AuthConfig } from "../../server/auth/config";
import { initWorld, type World as TestWorld } from "../../server/world";

const tick = (world: TestWorld) => {
  const { Position, Velocity } = world.components;
  processPlayerInputs((eid, cmd) => {
    const v = applyInputToVelocity(
      Velocity.x[eid]!,
      Velocity.y[eid]!,
      cmd,
      SERVER_TICK_RATE_MS,
    );
    Velocity.x[eid] = v.vx;
    Velocity.y[eid] = v.vy;
    const p = moveAndSlide(
      world,
      Position.x[eid]!,
      Position.y[eid]!,
      Velocity.x[eid]!,
      Velocity.y[eid]!,
      SERVER_TICK_RATE_MS,
    );
    Position.x[eid] = p.x;
    Position.y[eid] = p.y;
  });
  const states: PlayerState[] = [];
  for (const [, c] of getPlayerConnections()) {
    states.push({
      eid: c.eid,
      x: Position.x[c.eid]!,
      y: Position.y[c.eid]!,
      vx: Velocity.x[c.eid]!,
      vy: Velocity.y[c.eid]!,
      lastInputSeq: c.lastAckedSeq,
    });
  }
  broadcastGameState({ playerStates: states });
};

let app: ReturnType<typeof createServer>;
let world: TestWorld;
let port: number;
let db: Database;
let sessionId: string;

const authConfig: AuthConfig = {
  issuerUrl: "http://auth.test",
  burgerUrl: "http://localhost:5000",
  clientId: "burger",
  projectId: "burger-project",
  isProduction: false,
};

beforeEach(() => {
  port = 5500 + Math.floor(Math.random() * 500);

  db = new Database(":memory:");
  runMigrations(db);
  // Seed a user + session.
  const userId = "test-user-1";
  db.run(
    "INSERT INTO users (id, fourm_id, username, display_name, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [userId, "fourm-1", "tester", "Tester", 0, Date.now()],
  );
  sessionId = createSession(db, userId);

  world = initWorld(db);

  app = createServer({
    port,
    world,
    db,
    authConfig,
    onPlayerJoin: (displayName: string) => createPlayer(world, displayName),
    onPlayerLeave: (eid) => removeEntity(world, eid),
  });
});

afterEach(async () => {
  // Stop server. Elysia 1.4.x exposes `app.stop()`; fall back to `app.server?.stop()`.
  // Force-close active connections so a half-closed WS (one we rejected from
  // `open()` with ws.close(4001)) doesn't make stop() hang.
  // Bun's stop(true) can still hang in some half-upgraded states; cap with a
  // race so the test suite doesn't lock up.
  const a = app as unknown as {
    stop?: (force?: boolean) => Promise<unknown>;
    server?: { stop?: (force?: boolean) => unknown };
  };
  const stopPromise = (async () => {
    if (typeof a.stop === "function") {
      await a.stop.call(app, true);
    } else if (typeof a.server?.stop === "function") {
      await a.server.stop.call(a.server, true);
    }
  })();
  await Promise.race([
    stopPromise,
    new Promise<void>((r) => setTimeout(r, 500)),
  ]);
  // Drain shared module state.
  for (const [, c] of getPlayerConnections()) {
    try {
      removeEntity(world, c.eid);
    } catch {
      // ignore — entity may already be removed by close handler
    }
  }
  getPlayerConnections().clear();
  db.close();
});

const connect = (serverPort: number, session: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${serverPort}/ws`, {
      headers: { Cookie: `burger_session=${session}` },
    } as unknown as ConstructorParameters<typeof WebSocket>[1]);
    ws.binaryType = "arraybuffer";
    const timer = setTimeout(
      () => reject(new Error("WebSocket connect timeout")),
      2000,
    );
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.addEventListener("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const collectMessages = (ws: WebSocket): { messages: Uint8Array[] } => {
  const messages: Uint8Array[] = [];
  ws.addEventListener("message", (e) =>
    messages.push(new Uint8Array(e.data as ArrayBuffer)),
  );
  return { messages };
};

test("server sends YOUR_EID with correct protocol version and bounds", async () => {
  const ws = await connect(port, sessionId);
  const { messages } = collectMessages(ws);
  await sleep(100);
  const yourEid = messages.find((m) => m[0] === MESSAGE_TYPES.YOUR_EID);
  expect(yourEid).toBeDefined();
  // Strip the message-type tag byte; remaining 24 bytes are
  // [version, eid, bounds.x, bounds.y, bounds.w, bounds.h].
  const view = new Int32Array(yourEid!.slice(1).buffer);
  expect(view.length).toBe(6);
  expect(view[0]).toBe(PROTOCOL_VERSION);
  expect(view[1]).toBeGreaterThan(0);
  // bounds default to {0,0,0,0} in test worlds — assert shape/integers, not values.
  expect(Number.isInteger(view[2])).toBe(true);
  expect(Number.isInteger(view[3])).toBe(true);
  expect(Number.isInteger(view[4])).toBe(true);
  expect(Number.isInteger(view[5])).toBe(true);
  ws.close();
  await sleep(50);
});

test("server moves player right when right inputs are sent", async () => {
  const ws = await connect(port, sessionId);
  await sleep(50);
  // Capture starting position of the (single) connected player.
  let startX = 0;
  for (const [, c] of getPlayerConnections())
    startX = world.components.Position.x[c.eid]!;
  // Send 30 valid right inputs at the server tick rate (the canonical
  // legitimate dt for a 60Hz client).
  for (let i = 1; i <= 30; i++) {
    ws.send(
      JSON.stringify({
        type: "input",
        seq: i,
        msec: SERVER_TICK_RATE_MS,
        up: false,
        down: false,
        left: false,
        right: true,
        interact: false,
      }),
    );
  }
  await sleep(50);
  // Drive ~5 ticks server-side (capped at 8 inputs/tick = 40 inputs total drained).
  for (let i = 0; i < 5; i++) tick(world);
  let endX = startX;
  for (const [, c] of getPlayerConnections())
    endX = world.components.Position.x[c.eid]!;
  expect(endX).toBeGreaterThan(startX);
  ws.close();
  await sleep(50);
});

test("malicious client cannot speed-hack via input flood (per-tick cap holds)", async () => {
  const ws = await connect(port, sessionId);
  await sleep(50);
  // Capture start position — spawn is randomized within world.spawnZone.
  let startX = 0;
  for (const [, c] of getPlayerConnections())
    startX = world.components.Position.x[c.eid]!;
  // Flood 1000 right inputs at the maximum-allowed dt (the validator clamps
  // anything bigger). Combined with the per-tick cap, this is the most a
  // malicious client could do in one tick.
  for (let i = 1; i <= 1000; i++) {
    ws.send(
      JSON.stringify({
        type: "input",
        seq: i,
        msec: MAX_INPUT_MSEC,
        up: false,
        down: false,
        left: false,
        right: true,
        interact: false,
      }),
    );
  }
  await sleep(100);
  // Single tick: should process at most MAX_INPUTS_PER_TICK inputs.
  tick(world);
  let endX = startX;
  for (const [, c] of getPlayerConnections())
    endX = world.components.Position.x[c.eid]!;
  // Loose upper bound: even if every input reached steady-state PLAYER_SPEED,
  // the player can't move further than MAX_INPUTS_PER_TICK * PLAYER_SPEED *
  // MAX_INPUT_MSEC. (MAX_INPUT_MSEC = 2 * SERVER_TICK_RATE_MS.)
  const maxPossible = MAX_INPUTS_PER_TICK * PLAYER_SPEED * MAX_INPUT_MSEC + 1;
  expect(endX - startX).toBeLessThan(maxPossible);
  ws.close();
  await sleep(50);
});

test("server rejects malformed input messages", async () => {
  const ws = await connect(port, sessionId);
  await sleep(50);
  // Send garbage. Server should ignore silently (no crash).
  ws.send("not even json");
  ws.send(JSON.stringify({ totally: "wrong" }));
  ws.send(JSON.stringify({ type: "input", seq: "string", msec: 16 }));
  ws.send(JSON.stringify({ type: "input", seq: -5, msec: 16 }));
  ws.send(JSON.stringify({ type: "input", seq: 1, msec: -1 }));
  ws.send(JSON.stringify({ type: "input", seq: 1, msec: NaN }));
  await sleep(50);
  // Then send one valid input.
  ws.send(
    JSON.stringify({
      type: "input",
      seq: 1,
      msec: SERVER_TICK_RATE_MS,
      up: false,
      down: false,
      left: false,
      right: true,
      interact: false,
    }),
  );
  await sleep(50);
  tick(world);
  // Connection should still be alive and the valid input should have been processed.
  expect(getPlayerConnections().size).toBe(1);
  for (const [, c] of getPlayerConnections()) {
    expect(c.lastAckedSeq).toBe(1);
  }
  ws.close();
  await sleep(50);
});

test("server rejects replayed sequence numbers", async () => {
  const ws = await connect(port, sessionId);
  await sleep(50);
  // Send seq 1, then seq 1 again, then seq 2.
  for (const seq of [1, 1, 2]) {
    ws.send(
      JSON.stringify({
        type: "input",
        seq,
        msec: SERVER_TICK_RATE_MS,
        up: false,
        down: false,
        left: false,
        right: true,
        interact: false,
      }),
    );
  }
  await sleep(50);
  tick(world);
  // Only the original 1 and the 2 should have been queued (replay of 1 dropped).
  for (const [, c] of getPlayerConnections()) {
    expect(c.lastAckedSeq).toBe(2);
  }
  ws.close();
  await sleep(50);
});

test("disconnect cleans up server-side state", async () => {
  const ws = await connect(port, sessionId);
  await sleep(50);
  expect(getPlayerConnections().size).toBe(1);
  ws.close();
  await sleep(100);
  expect(getPlayerConnections().size).toBe(0);
});

test("unauthenticated connection is rejected with code 4001", async () => {
  const result = await new Promise<{ code: number }>((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    ws.addEventListener("close", (e) => resolve({ code: e.code }));
  });
  expect(result.code).toBe(4001);
  // Server must not register a player for the rejected connection.
  expect(getPlayerConnections().size).toBe(0);
});

test("invalid session id is rejected with code 4001", async () => {
  const result = await new Promise<{ code: number }>((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`, {
      headers: { Cookie: "burger_session=does-not-exist" },
    } as unknown as ConstructorParameters<typeof WebSocket>[1]);
    ws.addEventListener("close", (e) => resolve({ code: e.code }));
  });
  expect(result.code).toBe(4001);
  expect(getPlayerConnections().size).toBe(0);
});
