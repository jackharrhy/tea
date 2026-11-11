import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { request } from "node:http";
import { tableSeatPosition } from "@harrhy/pool-simulation/geometry";
import {
  INPUT_DT,
  type ClientMessage,
  type ServerMessage,
} from "@harrhy/pool-protocol";
import { Hall } from "../../server/hall";
import { GameRecorder } from "../../server/recordings";
import { createUpdateControl } from "../../server/update-control";
import { preUpdate } from "../../server/pre-update";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0).toReversed()) dispose();
});
function fixture() {
  const db = new Database(":memory:");
  const recorder = new GameRecorder(db, { log() {} });
  const hall = new Hall((table, winner, players) => {
    db.run(
      "INSERT INTO matches(table_id,winner,players,finished_at) VALUES(?,?,?,?)",
      [table, winner, JSON.stringify(players), Date.now()],
    );
  }, recorder);
  cleanup.push(() => {
    hall.dispose();
    db.close();
  });
  const server = createUpdateControl(hall, 0);
  cleanup.push(() => {
    void server.stop(true);
  });
  const players = [0, 1].map((i) => {
    const messages: ServerMessage[] = [];
    const peer = {
      send(raw: string) {
        messages.push(JSON.parse(raw));
      },
      close() {},
    };
    const id = hall.connect(peer, `Gate test ${i}`)!;
    return { id, peer, messages };
  });
  const table = hall.tables[0]!;
  function command(i: number, message: ClientMessage) {
    const p = players[i]!;
    hall.handle(p.id, p.peer, message);
  }
  function join(i: number) {
    const guest = hall.guests.get(players[i]!.id)!;
    const point = tableSeatPosition(table.id, i as 0 | 1);
    guest.state.x = hall.world.components.Position.x[guest.eid] = point.x;
    guest.state.z = hall.world.components.Position.z[guest.eid] = point.z;
    command(i, { type: "join", table: table.id });
  }
  function stored() {
    return [
      "matches",
      "recorded_games",
      "recorded_shots",
      "recorded_chunks",
      "recorded_diagnostics",
    ].map((name) => db.query(`SELECT * FROM ${name} ORDER BY rowid`).all());
  }
  return { hall, db, server, players, table, command, join, stored };
}

test("settled but unfinished human games deny updates without changing the game or recordings", async () => {
  const f = fixture();
  f.join(0);
  f.join(1);
  f.command(0, {
    type: "shot",
    id: "gate-shot",
    table: f.table.id,
    turn: f.table.match.shotNumber,
    angle: 0,
    power: 0.05,
  });
  for (let i = 0; f.table.match.phase === "rolling" && i < 1200; i++)
    f.hall.update(INPUT_DT);
  expect(f.table.match.phase).toBe("ball-in-hand");
  const game = structuredClone(f.table.match),
    recorded = f.stored();
  expect(await preUpdate(f.server.port!)).toBe(75);
  expect(f.table.match).toEqual(game);
  expect(f.stored()).toEqual(recorded);
  // A rejected drain does not lock the ongoing game.
  f.command(f.table.match.turn, {
    type: "place",
    table: f.table.id,
    turn: f.table.match.shotNumber,
    x: 0,
    z: 0,
  });
  f.command(f.table.match.turn, {
    type: "shot",
    id: "gate-next",
    table: f.table.id,
    turn: f.table.match.shotNumber,
    angle: 0.1,
    power: 0.05,
  });
  expect(f.table.match.phase).toBe("rolling");
});

test("offline and orphaned unfinished seats still deny updates", async () => {
  const f = fixture();
  f.join(0);
  f.join(1);
  for (const p of f.players) f.hall.disconnect(p.id, p.peer);
  expect([...f.hall.guests.values()].every((g) => !g.peer)).toBe(true);
  const game = structuredClone(f.table.match),
    recorded = f.stored();
  expect(await preUpdate(f.server.port!)).toBe(75);
  f.hall.guests.delete(f.players[0]!.id);
  expect(await preUpdate(f.server.port!)).toBe(75);
  expect(f.table.match).toEqual(game);
  expect(f.stored()).toEqual(recorded);
});

test("idle drain latches before a queued join; retries stay closed until explicit local resume", async () => {
  const f = fixture();
  f.join(0);
  expect(await preUpdate(f.server.port!)).toBe(0);
  f.join(1);
  expect(f.table.match.phase).toBe("waiting");
  expect(f.table.match.players[1]).toBeNull();
  expect(f.players[1]!.messages.at(-1)).toMatchObject({ type: "error" });
  expect(await preUpdate(f.server.port!)).toBe(0);
  f.join(1);
  expect(f.table.match.players[1]).toBeNull();
  expect(await preUpdate(f.server.port!, "resume")).toBe(0);
  f.join(1);
  expect(f.table.match.phase).toBe("aiming");
  expect(await preUpdate(f.server.port!)).toBe(75);
});

test("join-first versus drain-first races never admit a game after a successful drain", async () => {
  for (const joinFirst of [true, false]) {
    const f = fixture();
    f.join(0);
    let result: 0 | 75;
    if (joinFirst) {
      const pending = preUpdate(f.server.port!);
      f.join(1);
      result = await pending;
      expect(result).toBe(75);
      expect(f.table.match.phase).toBe("aiming");
    } else {
      result = await preUpdate(f.server.port!);
      queueMicrotask(() => f.join(1));
      await Promise.resolve();
      expect(result).toBe(0);
      expect(f.table.match.phase).toBe("waiting");
    }
  }
});

test("finished results survive drain and rematches cannot restart until explicit resume", async () => {
  const f = fixture();
  f.join(0);
  f.join(1);
  f.command(1, { type: "leave" });
  f.join(1);
  expect(f.table.match.phase).toBe("finished");
  const recorded = f.stored(),
    rack = f.table.rack;
  expect(await preUpdate(f.server.port!)).toBe(0);
  for (const i of [0, 1])
    f.command(i, {
      type: "rematch",
      table: f.table.id,
      turn: f.table.match.shotNumber,
    });
  expect(f.table.rack).toBe(rack);
  expect(f.stored()).toEqual(recorded);
  expect(await preUpdate(f.server.port!, "resume")).toBe(0);
  for (const i of [0, 1])
    f.command(i, {
      type: "rematch",
      table: f.table.id,
      turn: f.table.match.shotNumber,
    });
  expect(f.table.rack).toBe(rack + 1);
  expect(f.table.match.phase).toBe("aiming");
  expect(f.db.query("SELECT count(*) n FROM matches").get()).toEqual({ n: 1 });
});

test("unknown match phases fail closed", async () => {
  const f = fixture();
  Object.assign(f.table.match, { phase: "future-phase" });
  expect(await preUpdate(f.server.port!)).toBe(75);
});

test("control checks actual socket peer and denies browser origins and wrong methods", async () => {
  const f = fixture();
  const remote = await new Promise<number>((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port: f.server.port!,
        localAddress: "127.0.0.2",
        path: "/drain",
        method: "POST",
        headers: { "X-Forwarded-For": "127.0.0.1", Forwarded: "for=127.0.0.1" },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode!);
      },
    );
    req.on("error", reject);
    req.end();
  });
  expect(remote).toBe(403);
  expect(
    (
      await fetch(`http://127.0.0.1:${f.server.port}/drain`, {
        method: "POST",
        headers: { origin: "https://evil.test" },
      })
    ).status,
  ).toBe(403);
  expect((await fetch(`http://127.0.0.1:${f.server.port}/drain`)).status).toBe(
    405,
  );
  f.join(0);
  f.join(1);
  expect(f.table.match.phase).toBe("aiming");
});

test("hook returns EX_TEMPFAIL for API errors, malformed/unknown receipts, redirects and unavailable control", async () => {
  for (const response of [
    () => new Response("bad", { status: 503 }),
    () => Response.json({ version: 1, state: "drained" }, { status: 202 }),
    () => new Response("not json"),
    () => Response.json({ version: 1, state: "busy" }),
    () => Response.json({ version: 2, state: "drained" }),
    () => Response.json({ version: 1, state: "drained", unexpected: true }),
    () => new Response(null, { status: 302, headers: { location: "/drain" } }),
  ]) {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: response,
    });
    try {
      expect(await preUpdate(server.port!)).toBe(75);
    } finally {
      await server.stop(true);
    }
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(),
  });
  const port = server.port!;
  await server.stop(true);
  expect(await preUpdate(port)).toBe(75);
  expect(await preUpdate(0)).toBe(75);
});

test("hung control fails closed and the actual hook process uses exit 75", async () => {
  const f = fixture();
  f.join(0);
  let finish: ((response: Response) => void) | undefined;
  const hung = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => {
      f.hall.drainForUpdate();
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    },
  });
  try {
    expect(await preUpdate(hung.port!)).toBe(75);
  } finally {
    finish?.(new Response());
    await hung.stop(true);
  }
  f.join(1);
  expect(f.table.match.phase).toBe("waiting");
  expect(await preUpdate(f.server.port!, "resume")).toBe(0);
  f.join(1);
  expect(f.table.match.phase).toBe("aiming");
  const child = Bun.spawn(
    [
      process.execPath,
      new URL("../../server/pre-update.ts", import.meta.url).pathname,
    ],
    {
      env: { ...process.env, UPDATE_CONTROL_PORT: String(f.server.port) },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  expect(await child.exited).toBe(75);
  expect(await new Response(child.stdout).text()).toContain("Update deferred");
});

test("hook command maps an unreadable entrypoint to EX_TEMPFAIL", async () => {
  const child = Bun.spawn(
    [
      "sh",
      "-c",
      '"$@" || exit 75',
      "update-hook",
      process.execPath,
      "/nonexistent/8ball-pre-update.js",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(await child.exited).toBe(75);
});
