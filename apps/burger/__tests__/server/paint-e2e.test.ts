import { expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { removeEntity } from "bitecs";
import { runMigrations } from "../../server/db";
import { initWorld } from "../../server/world";
import {
  createServer,
  getPlayerConnections,
  resetPaintCounters,
} from "../../server/network.server";
import { createPlayer } from "../../server/players";
import { createSession } from "../../server/auth/sessions";
import type { AuthConfig } from "../../server/auth/config";
import { MAX_PAINTS_PER_TICK, TILE_SIZE } from "@tea/burger-core";

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
  // Pre-seed catalog with stable ids 1 (floor) and 2 (wall) so paints
  // validate against world.catalogIds. initWorld will sync atlas.toml on top
  // but our seeds (with these ids) match the toml's id 1/2/3 set.
  // Note: atlas.toml currently maps id 1 = wall, id 2 = counter, id 3 = floor.
  // We use those ids directly to avoid divergence.
  world = initWorld(db);
  // The seeded catalog from atlas.toml gives us catalogIds {1, 2, 3}; ids 1
  // ("wall") and 2 ("counter") are solid; id 3 ("floor") is not.

  port = 5800 + Math.floor(Math.random() * 200);
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
  for (const [, c] of getPlayerConnections()) {
    try {
      removeEntity(world, c.eid);
    } catch {
      // ignore
    }
  }
  getPlayerConnections().clear();
  db.close();
});

const connect = (p: number, sid: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${p}/ws`, {
      headers: { Cookie: `burger_session=${sid}` },
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

// Cell-center convention: paint coords are HALF + n*TILE_SIZE.
const HALF = TILE_SIZE / 2;
const A_X = HALF; // first cell center
const A_Y = HALF + TILE_SIZE; // second cell center down

test("non-admin paint is rejected", async () => {
  const sess = setupSession(db, false);
  const ws = await connect(port, sess);
  await sleep(50);
  ws.send(JSON.stringify({ type: "paint", x: A_X, y: A_Y, tileId: 3 }));
  await sleep(50);
  const row = db
    .query("SELECT * FROM tiles WHERE x = ? AND y = ?")
    .get(A_X, A_Y);
  expect(row).toBeNull();
  ws.close();
  await sleep(50);
});

test("admin paint creates tile in DB and tile_edits log", async () => {
  const sess = setupSession(db, true);
  const ws = await connect(port, sess);
  await sleep(50);
  ws.send(JSON.stringify({ type: "paint", x: A_X, y: A_Y, tileId: 3 }));
  await sleep(50);
  const tile = db
    .query("SELECT tile_id FROM tiles WHERE x = ? AND y = ?")
    .get(A_X, A_Y) as { tile_id: number } | null;
  expect(tile?.tile_id).toBe(3);
  const edit = db
    .query("SELECT * FROM tile_edits WHERE x = ? AND y = ?")
    .get(A_X, A_Y) as { new_tile_id: number; user_id: string } | null;
  expect(edit?.new_tile_id).toBe(3);
  expect(edit?.user_id).toBe("admin1");
  ws.close();
  await sleep(50);
});

test("admin paint replaces existing tile", async () => {
  const sess = setupSession(db, true);
  const ws = await connect(port, sess);
  await sleep(50);
  ws.send(JSON.stringify({ type: "paint", x: A_X, y: A_Y, tileId: 3 }));
  await sleep(50);
  ws.send(JSON.stringify({ type: "paint", x: A_X, y: A_Y, tileId: 1 }));
  await sleep(50);
  const tile = db
    .query("SELECT tile_id FROM tiles WHERE x = ? AND y = ?")
    .get(A_X, A_Y) as { tile_id: number } | null;
  expect(tile?.tile_id).toBe(1);
  const edits = db
    .query("SELECT COUNT(*) as c FROM tile_edits WHERE x = ? AND y = ?")
    .get(A_X, A_Y) as { c: number };
  expect(edits.c).toBe(2);
  ws.close();
  await sleep(50);
});

test("admin paint with null tileId erases", async () => {
  const sess = setupSession(db, true);
  const ws = await connect(port, sess);
  await sleep(50);
  ws.send(JSON.stringify({ type: "paint", x: A_X, y: A_Y, tileId: 3 }));
  await sleep(50);
  ws.send(JSON.stringify({ type: "paint", x: A_X, y: A_Y, tileId: null }));
  await sleep(50);
  const tile = db
    .query("SELECT * FROM tiles WHERE x = ? AND y = ?")
    .get(A_X, A_Y);
  expect(tile).toBeNull();
  ws.close();
  await sleep(50);
});

test("admin paint at out-of-bounds coords is rejected", async () => {
  const sess = setupSession(db, true);
  const ws = await connect(port, sess);
  await sleep(50);
  ws.send(JSON.stringify({ type: "paint", x: -HALF, y: -HALF, tileId: 3 }));
  ws.send(
    JSON.stringify({
      type: "paint",
      x: world.bounds.w + HALF,
      y: HALF,
      tileId: 3,
    }),
  );
  await sleep(50);
  const count = db.query("SELECT COUNT(*) as c FROM tiles").get() as {
    c: number;
  };
  expect(count.c).toBe(0);
  ws.close();
  await sleep(50);
});

test("admin paint with bad tileId rejected", async () => {
  const sess = setupSession(db, true);
  const ws = await connect(port, sess);
  await sleep(50);
  ws.send(JSON.stringify({ type: "paint", x: A_X, y: A_Y, tileId: 999 }));
  await sleep(50);
  const count = db.query("SELECT COUNT(*) as c FROM tiles").get() as {
    c: number;
  };
  expect(count.c).toBe(0);
  ws.close();
  await sleep(50);
});

test("non-admin paint inside a zone they belong to succeeds", async () => {
  const sess = setupSession(db, false);
  db.run("INSERT INTO zones (id, name, created_at) VALUES (10, 'z', 0)");
  db.run("INSERT INTO zone_cells (zone_id, x, y) VALUES (10, ?, ?)", [
    A_X,
    A_Y,
  ]);
  db.run(
    "INSERT INTO zone_members (zone_id, user_id, added_at) VALUES (10, 'user1', 0)",
  );
  // canPaint reads from world.zones / cellToZone, so we mirror our DB writes
  // there. There's no runtime reload helper (loadZones runs only at initWorld).
  world.zones.set(10, {
    id: 10,
    name: "z",
    cells: new Set([`${A_X},${A_Y}`]),
    members: new Set(["user1"]),
  });
  world.cellToZone.set(`${A_X},${A_Y}`, 10);

  const ws = await connect(port, sess);
  await sleep(50);
  ws.send(JSON.stringify({ type: "paint", x: A_X, y: A_Y, tileId: 3 }));
  await sleep(50);
  const tile = db
    .query("SELECT tile_id FROM tiles WHERE x = ? AND y = ?")
    .get(A_X, A_Y) as { tile_id: number } | null;
  expect(tile?.tile_id).toBe(3);
  ws.close();
  await sleep(50);
});

test("non-admin paint outside any zone is rejected", async () => {
  const sess = setupSession(db, false);
  const ws = await connect(port, sess);
  await sleep(50);
  ws.send(JSON.stringify({ type: "paint", x: A_X, y: A_Y, tileId: 3 }));
  await sleep(50);
  const tile = db
    .query("SELECT * FROM tiles WHERE x = ? AND y = ?")
    .get(A_X, A_Y);
  expect(tile).toBeNull();
  ws.close();
  await sleep(50);
});

test("non-admin paint inside another user's zone is rejected", async () => {
  const sess = setupSession(db, false);
  db.run("INSERT INTO zones (id, name, created_at) VALUES (11, 'z', 0)");
  db.run("INSERT INTO zone_cells (zone_id, x, y) VALUES (11, ?, ?)", [
    A_X,
    A_Y,
  ]);
  db.run(
    "INSERT INTO users (id, fourm_id, username, display_name, is_admin, created_at) VALUES ('bob', 'fid-bob', 'bob', 'bob', 0, 0)",
  );
  db.run(
    "INSERT INTO zone_members (zone_id, user_id, added_at) VALUES (11, 'bob', 0)",
  );
  world.zones.set(11, {
    id: 11,
    name: "z",
    cells: new Set([`${A_X},${A_Y}`]),
    members: new Set(["bob"]),
  });
  world.cellToZone.set(`${A_X},${A_Y}`, 11);

  const ws = await connect(port, sess);
  await sleep(50);
  ws.send(JSON.stringify({ type: "paint", x: A_X, y: A_Y, tileId: 3 }));
  await sleep(50);
  const tile = db
    .query("SELECT * FROM tiles WHERE x = ? AND y = ?")
    .get(A_X, A_Y);
  expect(tile).toBeNull();
  ws.close();
  await sleep(50);
});

test("rate limit: more than MAX_PAINTS_PER_TICK in one batch landed only N", async () => {
  const sess = setupSession(db, true);
  const ws = await connect(port, sess);
  await sleep(50);
  // Send 50 paints at distinct cell centers in one batch (all faster than
  // the server's tick rate). They all arrive within the same tick window.
  // Stay inside default bounds (64 tiles wide).
  for (let i = 0; i < 50; i++) {
    ws.send(
      JSON.stringify({
        type: "paint",
        x: HALF + i * TILE_SIZE,
        y: HALF,
        tileId: 3,
      }),
    );
  }
  await sleep(50);
  const c1 = db.query("SELECT COUNT(*) as c FROM tiles").get() as {
    c: number;
  };
  expect(c1.c).toBeLessThanOrEqual(MAX_PAINTS_PER_TICK);
  // Simulating one tick boundary: reset counters. New paints can land. Send
  // one more paint at a previously-unattempted coord to confirm it lands.
  resetPaintCounters();
  ws.send(
    JSON.stringify({
      type: "paint",
      x: HALF + 60 * TILE_SIZE,
      y: HALF,
      tileId: 3,
    }),
  );
  await sleep(50);
  const c2 = db.query("SELECT COUNT(*) as c FROM tiles").get() as {
    c: number;
  };
  expect(c2.c).toBeGreaterThan(c1.c);
  ws.close();
  await sleep(50);
});
