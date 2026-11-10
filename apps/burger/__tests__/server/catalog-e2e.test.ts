import { expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { removeEntity } from "bitecs";
import { runMigrations } from "../../server/db";
import { initWorld } from "../../server/world";
import {
  createServer,
  getPlayerConnections,
} from "../../server/network.server";
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
  port = 5900 + Math.floor(Math.random() * 100);
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

test("non-admin POST /api/catalog/save returns 403", async () => {
  const sess = setupSession(db, false);
  const { status } = await post(
    "/api/catalog/save",
    [{ id: 1, type: "wall", src_x: 0, src_y: 0, label: "wall" }],
    sess,
  );
  expect(status).toBe(403);
});

test("admin POST /api/catalog/save accepts valid catalog and updates DB", async () => {
  const sess = setupSession(db, true);
  const newCatalog = [
    { id: 1, type: "wall", src_x: 0, src_y: 0, label: "wall renamed" },
    { id: 2, type: "counter", src_x: 0, src_y: 32, label: "counter" },
    { id: 3, type: "floor", src_x: 32, src_y: 0, label: "floor" },
    { id: 4, type: "floor", src_x: 64, src_y: 0, label: "floor variant" },
  ];
  const { status, data } = await post("/api/catalog/save", newCatalog, sess);
  expect(status).toBe(200);
  expect(data).toEqual({ ok: true });
  const rows = db.query("SELECT id, label FROM tile_catalog ORDER BY id").all();
  expect(rows).toHaveLength(4);
  expect((rows[0] as any).label).toBe("wall renamed");
});

test("admin POST /api/catalog/save rejects deletion of an id with active tiles", async () => {
  const sess = setupSession(db, true);
  // place a tile referencing id=2
  db.run("INSERT INTO tiles (x, y, tile_id) VALUES (16, 16, 2)");
  // try to remove id=2 from catalog
  const newCatalog = [
    { id: 1, type: "wall", src_x: 0, src_y: 0, label: "wall" },
    { id: 3, type: "floor", src_x: 32, src_y: 0, label: "floor" },
  ];
  const { status, data } = await post("/api/catalog/save", newCatalog, sess);
  expect(status).toBe(409);
  expect(data).toMatchObject({ ok: false });
});

test("admin POST /api/catalog/rename succeeds and cascades", async () => {
  const sess = setupSession(db, true);
  db.run("INSERT INTO tiles (x, y, tile_id) VALUES (16, 16, 1)");
  const { status, data } = await post(
    "/api/catalog/rename",
    { from: 1, to: 99 },
    sess,
  );
  expect(status).toBe(200);
  expect(data).toEqual({ ok: true });
  const tile = db
    .query("SELECT tile_id FROM tiles WHERE x = 16 AND y = 16")
    .get();
  expect(tile).toEqual({ tile_id: 99 });
});

test("admin POST /api/catalog/rename to existing id returns 409", async () => {
  const sess = setupSession(db, true);
  const { status } = await post(
    "/api/catalog/rename",
    { from: 1, to: 2 },
    sess,
  );
  expect(status).toBe(409);
});
