import { expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { removeEntity } from "bitecs";
import { MESSAGE_TYPES } from "@tea/burger-core";
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
  port = 6300 + Math.floor(Math.random() * 100);
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

// Lenient response shape: every field is optional, every value is typed
// as a reasonable union. Avoids per-call type parameters in this e2e file
// while keeping access-site typechecking honest.
type Resp = {
  id?: number;
  name?: string;
  zones?: { id: number; name?: string; cells?: [number, number][] }[];
  member_user_ids?: string[];
  cell_count?: number;
  added?: number;
  removed?: number;
  dropped?: number;
  users?: { id: string; display_name: string | null }[];
  ok?: boolean;
};

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
  const data = (await res.json().catch(() => null)) as Resp;
  return { status: res.status, data };
};

test("non-admin GET /api/zones returns 403", async () => {
  const sess = setupSession(db, false);
  const { status } = await req("GET", "/api/zones", undefined, sess);
  expect(status).toBe(403);
});

test("admin GET /api/zones returns empty list initially", async () => {
  const sess = setupSession(db, true);
  const { status, data } = await req("GET", "/api/zones", undefined, sess);
  expect(status).toBe(200);
  expect(data).toEqual({ zones: [] });
});

test("admin POST /api/zones creates zone", async () => {
  const sess = setupSession(db, true);
  const r = await req("POST", "/api/zones", { name: "kitchen" }, sess);
  expect(r.status).toBe(200);
  expect(r.data.name).toBe("kitchen");
  expect(typeof r.data.id).toBe("number");
});

test("admin POST /api/zones rejects duplicate name with 409", async () => {
  const sess = setupSession(db, true);
  await req("POST", "/api/zones", { name: "kitchen" }, sess);
  const r2 = await req("POST", "/api/zones", { name: "kitchen" }, sess);
  expect(r2.status).toBe(409);
});

test("admin PATCH /api/zones/:id renames", async () => {
  const sess = setupSession(db, true);
  const c = await req("POST", "/api/zones", { name: "a" }, sess);
  const r = await req("PATCH", `/api/zones/${c.data.id}`, { name: "b" }, sess);
  expect(r.status).toBe(200);
  expect(r.data.name).toBe("b");
});

test("admin DELETE /api/zones/:id removes the zone", async () => {
  const sess = setupSession(db, true);
  const c = await req("POST", "/api/zones", { name: "z" }, sess);
  const d = await req("DELETE", `/api/zones/${c.data.id}`, undefined, sess);
  expect(d.status).toBe(200);
  const list = await req("GET", "/api/zones", undefined, sess);
  expect(list.data.zones).toEqual([]);
});

test("admin PUT /api/zones/:id/cells adds + removes cells", async () => {
  const sess = setupSession(db, true);
  const c = await req("POST", "/api/zones", { name: "z" }, sess);
  const put = await req(
    "PUT",
    `/api/zones/${c.data.id}/cells`,
    {
      add: [
        [16, 16],
        [48, 16],
      ],
      remove: [],
    },
    sess,
  );
  expect(put.status).toBe(200);
  expect(put.data.added).toBe(2);

  const put2 = await req(
    "PUT",
    `/api/zones/${c.data.id}/cells`,
    { add: [], remove: [[16, 16]] },
    sess,
  );
  expect(put2.data.removed).toBe(1);

  expect(world.zones.get(c.data.id!)?.cells.size).toBe(1);
});

test("admin PUT /api/zones/:id/members replaces membership", async () => {
  const sess = setupSession(db, true);
  setupSession(db, false, "alice");
  setupSession(db, false, "bob");
  const c = await req("POST", "/api/zones", { name: "z" }, sess);
  const r = await req(
    "PUT",
    `/api/zones/${c.data.id}/members`,
    { user_ids: ["alice", "ghost"] },
    sess,
  );
  expect(r.status).toBe(200);
  expect(r.data.member_user_ids).toEqual(["alice"]);
  expect(r.data.dropped).toBe(1);
});

test("admin GET /api/zones/all-cells returns per-zone cells", async () => {
  const sess = setupSession(db, true);
  const c = await req("POST", "/api/zones", { name: "z" }, sess);
  await req(
    "PUT",
    `/api/zones/${c.data.id}/cells`,
    { add: [[16, 16]], remove: [] },
    sess,
  );
  const r = await req("GET", "/api/zones/all-cells", undefined, sess);
  expect(r.status).toBe(200);
  expect(r.data.zones).toEqual([{ id: c.data.id!, cells: [[16, 16]] }]);
});

test("admin GET /api/users returns id + display_name list", async () => {
  const sess = setupSession(db, true);
  setupSession(db, false, "alice");
  const r = await req("GET", "/api/users", undefined, sess);
  expect(r.status).toBe(200);
  const ids = (r.data.users as { id: string }[]).map((u) => u.id).sort();
  expect(ids).toEqual(["admin1", "alice"]);
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

const collect = (ws: WebSocket, tag: number): Uint8Array[] => {
  const collected: Uint8Array[] = [];
  ws.addEventListener("message", (e) => {
    const buf = new Uint8Array(e.data as ArrayBuffer);
    if (buf[0] === tag) collected.push(buf.subarray(1));
  });
  return collected;
};

const parseJson = (buf: Uint8Array): unknown =>
  JSON.parse(new TextDecoder().decode(buf));

test("non-admin receives MY_ZONES on connect", async () => {
  const sess = setupSession(db, false);
  db.run("INSERT INTO zones (id, name, created_at) VALUES (50, 'z', 0)");
  db.run("INSERT INTO zone_cells (zone_id, x, y) VALUES (50, 16, 16)");
  db.run(
    "INSERT INTO zone_members (zone_id, user_id, added_at) VALUES (50, 'user1', 0)",
  );
  world.zones.set(50, {
    id: 50,
    name: "z",
    cells: new Set(["16,16"]),
    members: new Set(["user1"]),
  });
  world.cellToZone.set("16,16", 50);

  const ws = await connect(port, sess);
  const messages = collect(ws, MESSAGE_TYPES.MY_ZONES);
  await sleep(80);
  expect(messages.length).toBeGreaterThanOrEqual(1);
  const msg = parseJson(messages[0]!) as { cells: [number, number][] };
  expect(msg.cells).toEqual([[16, 16]]);
  ws.close();
  await sleep(50);
});

test("admin does not receive MY_ZONES on connect", async () => {
  const sess = setupSession(db, true);
  const ws = await connect(port, sess);
  const messages = collect(ws, MESSAGE_TYPES.MY_ZONES);
  await sleep(80);
  expect(messages.length).toBe(0);
  ws.close();
  await sleep(50);
});

test("admin receives ZONES_UPDATED after a zone mutation", async () => {
  const adminSess = setupSession(db, true);
  const ws = await connect(port, adminSess);
  const messages = collect(ws, MESSAGE_TYPES.ZONES_UPDATED);
  await sleep(50);
  await req("POST", "/api/zones", { name: "newzone" }, adminSess);
  await sleep(80);
  expect(messages.length).toBeGreaterThanOrEqual(1);
  ws.close();
  await sleep(50);
});

test("affected non-admin receives MY_ZONES when added to a zone", async () => {
  const adminSess = setupSession(db, true);
  const userSess = setupSession(db, false, "alice");
  const userWs = await connect(port, userSess);
  const messages = collect(userWs, MESSAGE_TYPES.MY_ZONES);
  await sleep(50);
  // Clear the initial empty MY_ZONES message.
  messages.length = 0;

  const c = await req("POST", "/api/zones", { name: "z" }, adminSess);
  await req(
    "PUT",
    `/api/zones/${c.data.id}/cells`,
    { add: [[16, 16]], remove: [] },
    adminSess,
  );
  await req(
    "PUT",
    `/api/zones/${c.data.id}/members`,
    { user_ids: ["alice"] },
    adminSess,
  );
  await sleep(80);
  expect(messages.length).toBeGreaterThanOrEqual(1);
  const last = parseJson(messages.at(-1)!) as { cells: [number, number][] };
  expect(last.cells).toEqual([[16, 16]]);
  userWs.close();
  await sleep(50);
});
