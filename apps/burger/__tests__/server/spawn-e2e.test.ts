import { expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { removeEntity } from "bitecs";
import { runMigrations } from "../../server/db";
import { initWorld } from "../../server/world";
import { createServer, getPlayerConnections } from "../../server/network.server";
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
  port = 6000 + Math.floor(Math.random() * 100);
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

const post = async (path: string, body: unknown, sessionId?: string) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (sessionId) headers.Cookie = `burger_session=${sessionId}`;
  const res = await fetch(`http://localhost:${port}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
};

const get = async (path: string) => {
  const res = await fetch(`http://localhost:${port}${path}`);
  const data = await res.json();
  return { status: res.status, data };
};

test("GET /api/settings/spawn returns the current zone", async () => {
  const { status, data } = await get("/api/settings/spawn");
  expect(status).toBe(200);
  // Default spawn is centered: (2048 - 128) / 2 = 960.
  expect(data).toEqual({ x: 960, y: 960, w: 128, h: 128 });
});

test("non-admin POST /api/settings/spawn returns 403", async () => {
  const sess = setupSession(db, false);
  const { status } = await post(
    "/api/settings/spawn",
    { x: 64, y: 64, w: 128, h: 128 },
    sess,
  );
  expect(status).toBe(403);
});

test("admin POST /api/settings/spawn persists and mutates world", async () => {
  const sess = setupSession(db, true);
  const { status, data } = await post(
    "/api/settings/spawn",
    { x: 256, y: 512, w: 64, h: 96 },
    sess,
  );
  expect(status).toBe(200);
  expect(data).toMatchObject({ ok: true });

  // In-memory world updated immediately.
  expect(world.spawnZone).toEqual({ x: 256, y: 512, w: 64, h: 96 });

  // settings table persisted.
  const rows = db
    .query(
      "SELECT key, value FROM settings WHERE key IN ('spawn_x','spawn_y','spawn_w','spawn_h') ORDER BY key",
    )
    .all() as { key: string; value: string }[];
  expect(rows).toEqual([
    { key: "spawn_h", value: "96" },
    { key: "spawn_w", value: "64" },
    { key: "spawn_x", value: "256" },
    { key: "spawn_y", value: "512" },
  ]);
});

test("admin POST with zone past world bounds returns 400", async () => {
  const sess = setupSession(db, true);
  const { status, data } = await post(
    "/api/settings/spawn",
    { x: 0, y: 0, w: 99999, h: 99999 },
    sess,
  );
  expect(status).toBe(400);
  expect(data).toMatchObject({ ok: false });
});
