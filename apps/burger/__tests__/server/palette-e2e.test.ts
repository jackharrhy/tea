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

const setupSession = (
  database: Database,
  isAdmin: boolean,
  id?: string,
): string => {
  const userId = id ?? (isAdmin ? "admin1" : "user1");
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
  port = 6200 + Math.floor(Math.random() * 100);
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

const req = async (
  method: string,
  path: string,
  body: unknown,
  sessionId?: string,
) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (sessionId) headers.Cookie = `burger_session=${sessionId}`;
  const res = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
};

test("non-admin GET /api/palette returns 200 with own (empty) palette", async () => {
  const sess = setupSession(db, false);
  const { status, data } = await req("GET", "/api/palette", undefined, sess);
  expect(status).toBe(200);
  expect(data).toEqual({ ok: true, ids: [] });
});

test("non-admin PUT /api/palette persists own palette", async () => {
  const sess = setupSession(db, false);
  const put = await req("PUT", "/api/palette", { ids: [1, 2] }, sess);
  expect(put.status).toBe(200);
  expect(put.data).toEqual({ ok: true, ids: [1, 2] });

  const get = await req("GET", "/api/palette", undefined, sess);
  expect(get.data).toEqual({ ok: true, ids: [1, 2] });
});

test("unauthenticated GET /api/palette returns 403", async () => {
  const { status } = await req("GET", "/api/palette", undefined);
  expect(status).toBe(403);
});

test("non-admin cannot modify another user's palette", async () => {
  const sessAlice = setupSession(db, false, "alice");
  const sessBob = setupSession(db, false, "bob");
  // Alice sets her palette.
  await req("PUT", "/api/palette", { ids: [1] }, sessAlice);
  // Bob's GET reflects Bob's empty palette, not Alice's.
  const bobGet = await req("GET", "/api/palette", undefined, sessBob);
  expect(bobGet.data).toEqual({ ok: true, ids: [] });
});

test("admin GET /api/palette returns empty initially", async () => {
  const sess = setupSession(db, true);
  const { status, data } = await req("GET", "/api/palette", undefined, sess);
  expect(status).toBe(200);
  expect(data).toEqual({ ok: true, ids: [] });
});

test("admin PUT /api/palette persists; subsequent GET returns same ids", async () => {
  const sess = setupSession(db, true);
  const put = await req("PUT", "/api/palette", { ids: [1, 2] }, sess);
  expect(put.status).toBe(200);
  expect(put.data).toEqual({ ok: true, ids: [1, 2] });

  const get = await req("GET", "/api/palette", undefined, sess);
  expect(get.data).toEqual({ ok: true, ids: [1, 2] });
});

test("admin PUT /api/palette rejects ids not in catalog", async () => {
  const sess = setupSession(db, true);
  const put = await req("PUT", "/api/palette", { ids: [9999] }, sess);
  expect(put.status).toBe(400);
});

test("admin PUT /api/palette rejects more than 9 ids", async () => {
  const sess = setupSession(db, true);
  // atlas.toml seeds catalog ids 1-54; pick high ids to avoid collisions and
  // submit 10 of them to exercise the length cap (not the catalog-membership
  // cap, which is tested separately).
  for (let i = 100; i <= 109; i++) {
    db.run(
      "INSERT INTO tile_catalog (id, type, src_x, src_y, label) VALUES (?, 'floor', ?, 0, ?)",
      [i, (i - 100) * 32, `t${i}`],
    );
    world.catalogIds.add(i);
  }
  const ids = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109];
  const put = await req("PUT", "/api/palette", { ids }, sess);
  expect(put.status).toBe(400);
});
