import { expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { query, removeEntity } from "bitecs";
import { runMigrations } from "../../server/db";
import { initWorld } from "../../server/world";
import { createServer, getPlayerConnections } from "../../server/network.server";
import { spawnAiPlayers } from "../../server/ai";
import { createPlayer } from "../../server/players";
import { createSession } from "../../server/auth/sessions";
import type { AuthConfig } from "../../server/auth/config";

let db: Database;
let world: ReturnType<typeof initWorld>;
let app: ReturnType<typeof createServer>;
let port: number;

const authConfig: AuthConfig = {
  issuerUrl: "http://auth.test",
  burgerUrl: "http://localhost:5000",
  clientId: "burger",
  projectId: "burger-project",
  isProduction: false,
};

const setupSession = (database: Database, isAdmin: boolean): string => {
  const userId = isAdmin ? "admin1" : "user1";
  database.run(
    "INSERT INTO users (id, fourm_id, username, display_name, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [userId, `fid-${userId}`, userId, userId, isAdmin ? 1 : 0, Date.now()],
  );
  return createSession(database, userId);
};

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
  world = initWorld(db);
  spawnAiPlayers(world);
  port = 6100 + Math.floor(Math.random() * 100);
  app = createServer({
    port,
    world,
    db,
    authConfig,
    onPlayerJoin: (name) => createPlayer(world, name),
    onPlayerLeave: (eid) => removeEntity(world, eid),
  });
});

afterEach(async () => {
  const a = app as unknown as {
    stop?: (force?: boolean) => Promise<unknown>;
    server?: { stop?: (force?: boolean) => unknown };
  };
  const stopPromise = (async () => {
    if (typeof a.stop === "function") await a.stop.call(app, true);
    else if (typeof a.server?.stop === "function")
      await a.server.stop.call(a.server, true);
  })();
  await Promise.race([
    stopPromise,
    new Promise<void>((r) => setTimeout(r, 500)),
  ]);
  for (const [, c] of getPlayerConnections()) {
    try {
      removeEntity(world, c.eid);
    } catch {}
  }
  getPlayerConnections().clear();
  db.close();
});

const post = async (path: string, sessionId?: string) => {
  const headers: Record<string, string> = {};
  if (sessionId) headers.Cookie = `burger_session=${sessionId}`;
  const res = await fetch(`http://localhost:${port}${path}`, {
    method: "POST",
    headers,
  });
  const data = await res.json();
  return { status: res.status, data };
};

test("non-admin POST /api/bots/reset returns 403", async () => {
  const sess = setupSession(db, false);
  const { status } = await post("/api/bots/reset", sess);
  expect(status).toBe(403);
});

test("admin POST /api/bots/reset moves bots back inside spawn zone", async () => {
  const sess = setupSession(db, true);

  // Move all bots far outside the spawn zone first.
  const { Position, Bot } = world.components;
  const { spawnZone } = world;
  const farX = spawnZone.x + spawnZone.w + 1000;
  const farY = spawnZone.y + spawnZone.h + 1000;
  const botEids = query(world, [Bot]);
  for (const eid of botEids) {
    Position.x[eid] = farX;
    Position.y[eid] = farY;
  }

  const { status, data } = await post("/api/bots/reset", sess);
  expect(status).toBe(200);
  expect(data).toMatchObject({ ok: true });
  expect((data as { count: number }).count).toBeGreaterThan(0);

  // Verify all bots are now inside the spawn zone.
  for (const eid of botEids) {
    const x = Position.x[eid]!;
    const y = Position.y[eid]!;
    expect(x).toBeGreaterThanOrEqual(spawnZone.x);
    expect(x).toBeLessThanOrEqual(spawnZone.x + spawnZone.w);
    expect(y).toBeGreaterThanOrEqual(spawnZone.y);
    expect(y).toBeLessThanOrEqual(spawnZone.y + spawnZone.h);
  }
});
