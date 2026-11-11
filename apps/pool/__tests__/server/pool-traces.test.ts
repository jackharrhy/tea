import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import { eq } from "drizzle-orm";
import {
  type PoolTrace,
  type PoolTraceMessage,
  MAX_POOL_TRACE_RAW_BYTES,
} from "@harrhy/pool-protocol";
import { type PhysicalBall } from "@harrhy/pool";
import {
  GameRecorder,
  exportClientTraces,
  exportRecording,
} from "../../server/recordings";
import { database, recordedClientTraces, recordedShots } from "../../server/db";
import { Hall, type Peer } from "../../server/hall";
import { tableSeatPosition } from "@harrhy/pool-simulation/geometry";

const ball: PhysicalBall = {
  id: 0,
  x: 0,
  y: 0.808575,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  w: [0, 0, 0],
  q: [0, 0, 0, 1],
  pocketed: false,
  stage: "table",
  revision: 1,
};
function trace(id = "trace", turn = 1): PoolTrace {
  return {
    formatVersion: 1,
    id,
    transmissions: [0],
    context: {
      command: {
        id: `command-${turn}`,
        table: "1",
        turn,
        angle: 0,
        power: 0.5,
      },
      rack: 2,
      gravity: [0, -9.81, 0],
      initial: [ball],
      initialSnapshot: { tick: 1, time: 0, receivedAt: 0 },
      cueContactAt: 0,
      sentAt: 0,
      clientBuild: "test",
      physicsBuild: "test",
      userAgent: "test",
    },
    trigger: { at: 100, error: 0.1, reason: "large-correction" },
    window: { start: 0, end: 200, partial: false },
    acknowledgements: [],
    packets: [],
    frames: [],
    corrections: [
      {
        at: 100,
        error: 0.1,
        serverTick: 6,
        serverTime: 100,
        alignedTick: 6,
        replayedTick: 6,
        predicted: [ball],
        authoritative: [ball],
        replayed: [ball],
        renderedBefore: [],
        renderedAfter: [],
      },
    ],
    omitted: { frames: 0, packets: 0, corrections: 0 },
  };
}
function message(value = trace()): PoolTraceMessage {
  return {
    type: "pool-trace",
    id: value.id,
    table: value.context.command.table,
    turn: value.context.command.turn,
    rack: value.context.rack,
    commandId: value.context.command.id,
    payload: gzipSync(JSON.stringify(value)).toString("base64"),
  };
}
const reporter = { playerId: "player", seat: 0, tick: 8 };
function setup(options: ConstructorParameters<typeof GameRecorder>[1] = {}) {
  const sqlite = new Database(":memory:");
  const logs: Record<string, unknown>[] = [];
  const recorder = new GameRecorder(sqlite, {
    log: (e) => logs.push(e),
    ...options,
  });
  const db = database(sqlite);
  const start = (
    turn = 1,
    rack: number | undefined = 2,
    id: string | undefined = `command-${turn}`,
  ) => {
    recorder.startShot(
      "1",
      { id, number: turn, seat: 0, bot: false, angle: 0, power: 0.5 },
      [ball],
      undefined,
      rack,
    );
    return db
      .select()
      .from(recordedShots)
      .all()
      .find((row) => row.header.command.number === turn)!.id;
  };
  return { sqlite, db, recorder, logs, start };
}

test("trace links once, exports read-only, and survives active header flushes and delayed arrival", () => {
  const { sqlite, db, recorder, logs, start } = setup();
  try {
    const id = start();
    recorder.sample("1", 6, 0.1, [ball], [{ type: "contact" }]);
    recorder.clientTrace(message(), reporter);
    recorder.clientTrace(message(trace("duplicate")), reporter);
    recorder.sample("1", 7, 0.1, [ball]);
    start(2);
    expect(db.select().from(recordedClientTraces).all()).toHaveLength(1);
    sqlite.exec("PRAGMA query_only=ON");
    expect(exportClientTraces(sqlite, id)).toEqual([
      {
        id: "trace",
        shotId: id,
        receivedAt: expect.any(Number),
        serverTick: 8,
        reporterSeat: 0,
        trace: trace(),
      },
    ]);
    const shot = exportRecording(sqlite, id).shots[0];
    expect(shot.command.id).toBe("command-1");
    expect(shot.rack).toBe(2);
    expect(shot.events).toContainEqual({
      type: "client_pool_trace",
      at: 100,
      tick: 8,
      traceId: "trace",
      error: 0.1,
      clientReported: true,
    });
    expect(shot.events.some((e) => e.type === "contact")).toBe(true);
    expect(shot.flags).toContain("client_pool_trace");
    expect(logs.filter((e) => e.event === "client_pool_trace")).toHaveLength(1);
    expect(
      logs.find((e) => e.event === "client_pool_trace"),
    ).not.toHaveProperty("trace");
    sqlite.exec("PRAGMA query_only=OFF");
    recorder.endGame("1", "finished");
    recorder.close();
    recorder.clientTrace(message(trace("late", 2)), reporter);
    expect(db.select().from(recordedClientTraces).all()).toHaveLength(2);
  } finally {
    sqlite.close();
  }
});

test("malformed gzip, oversized compressed/schema data and zip bombs never disable recording", () => {
  const { sqlite, db, recorder, logs, start } = setup();
  try {
    start();
    for (const payload of [
      Buffer.from("not gzip").toString("base64"),
      Buffer.alloc(128 * 1024 + 1).toString("base64"),
      gzipSync("x".repeat(MAX_POOL_TRACE_RAW_BYTES + 1)).toString("base64"),
      gzipSync(
        JSON.stringify({
          ...trace(),
          frames: Array.from({ length: 65 }, () => ({})),
        }),
      ).toString("base64"),
      gzipSync("{").toString("base64"),
    ]) {
      recorder.clientTrace({ ...message(), payload }, reporter);
    }
    expect(db.select().from(recordedClientTraces).all()).toHaveLength(0);
    recorder.clientTrace(message(), reporter);
    expect(db.select().from(recordedClientTraces).all()).toHaveLength(1);
    expect(logs.some((e) => e.event === "pool_recording_disabled")).toBe(false);
  } finally {
    sqlite.close();
  }
});

test("trace rejects other seats, tables, commands, turns, racks, angles, powers and envelope mismatches", () => {
  const { sqlite, db, recorder, start } = setup();
  try {
    start();
    recorder.clientTrace(message(), { ...reporter, seat: 1 });
    for (const change of [
      { table: "2" },
      { commandId: "wrong" },
      { turn: 2 },
      { rack: 3 },
      { id: "wrong" },
    ])
      recorder.clientTrace({ ...message(), ...change }, reporter);
    for (const change of [
      { table: "2" },
      { id: "wrong" },
      { turn: 2 },
      { angle: 1 },
      { power: 0.7 },
    ]) {
      const value = trace();
      Object.assign(value.context.command, change);
      recorder.clientTrace(message(value), reporter);
    }
    const wrongGravity = trace();
    wrongGravity.context.gravity = [0, -5, 0];
    recorder.clientTrace(message(wrongGravity), reporter);
    const value = trace();
    value.context.rack++;
    recorder.clientTrace(message(value), reporter);
    expect(db.select().from(recordedClientTraces).all()).toHaveLength(0);
    recorder.clientTrace(message(), reporter);
    expect(db.select().from(recordedClientTraces).all()).toHaveLength(1);
  } finally {
    sqlite.close();
  }
});

test("legacy headers without command id or rack fail closed", () => {
  for (const missing of ["id", "rack"] as const) {
    const { sqlite, db, recorder, start } = setup();
    try {
      const id = start();
      const header = db.select().from(recordedShots).get()!.header;
      if (missing === "id") delete header.command.id;
      else delete header.rack;
      db.update(recordedShots)
        .set({ header })
        .where(eq(recordedShots.id, id))
        .run();
      recorder.clientTrace(message(), reporter);
      expect(exportClientTraces(sqlite, id)).toEqual([]);
    } finally {
      sqlite.close();
    }
  }
});

test("trace count and compressed byte quotas prune oldest evidence, and shot deletion cascades", () => {
  for (const options of [
    { maxTraces: 2 },
    { maxTraceBytes: gzipSync(JSON.stringify(trace())).length + 10 },
  ]) {
    const { sqlite, db, recorder, start } = setup(options);
    try {
      for (let turn = 1; turn <= 4; turn++) {
        start(turn);
        recorder.sample("1", turn, 0.1, [ball]);
        recorder.clientTrace(message(trace(`trace-${turn}`, turn)), reporter);
        db.update(recordedClientTraces)
          .set({ receivedAt: turn })
          .where(eq(recordedClientTraces.id, `trace-${turn}`))
          .run();
      }
      const rows = db.select().from(recordedClientTraces).all();
      expect(rows.length).toBe("maxTraces" in options ? 2 : 1);
      expect(rows.some((row) => row.id === "trace-4")).toBe(true);
      const shots = db.select().from(recordedShots).all();
      expect(shots).toHaveLength(4);
      const first = shots.find((row) => row.header.command.number === 1)!;
      expect(exportRecording(sqlite, first.id).shots[0].frames).toHaveLength(1);
      db.delete(recordedShots).run();
      expect(db.select().from(recordedClientTraces).all()).toEqual([]);
    } finally {
      sqlite.close();
    }
  }
});

const peer = (): Peer => ({ send() {}, close() {} });

test("Hall accepts only live seated peers and rate limits across reconnects without changing gameplay", () => {
  const calls: unknown[] = [];
  const shots: unknown[][] = [];
  const recorder = {
    clientTrace: (...args: unknown[]) => calls.push(args),
    startGame() {},
    close() {},
    startShot: (...args: unknown[]) => shots.push(args),
  } as unknown as GameRecorder;
  const hall = new Hall(undefined, recorder);
  const first = peer(),
    second = peer();
  try {
    const id = hall.connect(first, "Player")!;
    const guest = hall.guests.get(id)!;
    const table = hall.tables[0];
    const report = { ...message(), table: table.id };
    hall.handle(id, first, report, 0);
    expect(calls).toHaveLength(0);
    const position = tableSeatPosition(table.id, 0);
    guest.state.x = hall.world.components.Position.x[guest.eid] = position.x;
    guest.state.z = hall.world.components.Position.z[guest.eid] = position.z;
    hall.handle(id, first, { type: "join", table: table.id }, 1);
    const before = structuredClone({
      match: table.match,
      balls: table.balls,
      rack: table.rack,
      lastCommand: table.lastCommand,
    });
    hall.handle(id, second, report, 30_000);
    hall.handle(id, first, { ...report, table: "wrong" }, 30_000);
    expect(calls).toHaveLength(0);
    hall.handle(id, first, report, 60_000);
    hall.handle(id, first, report, 60_001);
    expect(calls).toEqual([
      [report, { playerId: id, seat: 0, tick: hall.tick }],
    ]);
    expect({
      match: table.match,
      balls: table.balls,
      rack: table.rack,
      lastCommand: table.lastCommand,
    }).toEqual(before);
    hall.disconnect(id, first);
    expect(hall.connect(second, "Player", guest.token)).toBe(id);
    hall.handle(id, first, report, 90_000);
    hall.handle(id, second, report, 60_002);
    expect(calls).toHaveLength(1);
    hall.handle(id, second, report, 90_000);
    expect(calls).toHaveLength(2);
    table.match.phase = "aiming";
    table.match.turn = 0;
    table.turnAt = 90_000;
    hall.handle(
      id,
      second,
      {
        type: "shot",
        id: "human-command",
        table: table.id,
        turn: table.match.shotNumber,
        angle: 0,
        power: 0.5,
      },
      90_001,
    );
    expect(shots[0]?.[1]).toMatchObject({ id: "human-command" });
    expect(shots[0]?.[4]).toBe(table.rack);
  } finally {
    hall.dispose();
  }
});

test("export bounds decompression even for corrupted storage", () => {
  const { sqlite, db, recorder, start } = setup();
  try {
    const id = start();
    recorder.clientTrace(message(), reporter);
    db.update(recordedClientTraces)
      .set({ data: gzipSync("x".repeat(MAX_POOL_TRACE_RAW_BYTES + 1)) })
      .run();
    expect(() => exportClientTraces(sqlite, id)).toThrow();
  } finally {
    sqlite.close();
  }
});
