import { expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import {
  poolTraceSchema,
  parseClientMessage,
  MAX_CLIENT_MESSAGE_LENGTH,
  type PoolTrace,
  type PoolTraceCorrection,
  type Snapshot,
} from "@tea/pool-protocol";
import type { PhysicalBall } from "@tea/pool";
import { PoolTraceCapture, encodePoolTrace } from "../../app/game/pool-trace";
const ball: PhysicalBall = {
  id: 0,
  x: 0,
  y: 0.808575,
  z: 0,
  vx: 1,
  vy: 0,
  vz: 0,
  q: [0, 0, 0, 1],
  w: [0, 0, 0],
  stage: "table",
  revision: 1,
  pocketed: false,
};
const context = (id = "shot"): PoolTrace["context"] => ({
  command: { id, table: "1", turn: 3, angle: 0, power: 0.5 },
  gravity: [0, -9.81, 0],
  rack: 1,
  initial: [structuredClone(ball)],
  initialSnapshot: { tick: 9, time: 150, receivedAt: 0 },
  sentAt: 0,
  cueContactAt: 100,
  clientBuild: "client-test",
  physicsBuild: "pool-v2/box3d@test",
  userAgent: "test",
});
const correction = (at: number, error = 0.2): PoolTraceCorrection => ({
  at,
  error,
  serverTick: 120,
  serverTime: 2000,
  alignedTick: 20,
  replayedTick: 24,
  predicted: [structuredClone(ball)],
  authoritative: [{ ...structuredClone(ball), x: error }],
  replayed: [{ ...structuredClone(ball), x: error + 0.03 }],
  renderedBefore: [],
  renderedAfter: [],
});
const snapshot = (time: number): Snapshot => ({
  type: "state",
  time,
  tick: Math.round((time * 60) / 1000),
  players: [],
  tables: [
    {
      id: "1",
      rack: 1,
      rematchReady: [],
      match: {
        phase: "rolling",
        players: [null, null],
        turn: 0,
        groups: [null, null],
        winner: null,
        message: "",
        shotNumber: 3,
      },
      balls: [structuredClone(ball)],
    },
  ],
});
function capture() {
  const c = new PoolTraceCapture();
  c.begin(context(), 0);
  for (let now = 0; now <= 3000; now += 25) {
    c.frame(
      now,
      now === 2500 ? 400 : 25,
      {
        tick: Math.floor((now * 60) / 1000),
        droppedSteps: now >= 2500 ? 3 : 0,
        balls: [ball],
      },
      [{ id: "ball:1:0", x: ball.x, y: ball.y, z: ball.z, epoch: "1:1" }],
    );
    if (now % 50 === 0) c.packet(snapshot(now), now);
  }
  c.acknowledge(
    {
      type: "shot-ack",
      id: "shot",
      table: "1",
      turn: 3,
      accepted: true,
      time: 1000,
    },
    120,
  );
  c.correction(correction(3000));
  return c;
}
test("keeps a bounded two-second lead-in and one-second aftermath with exact initial state", () => {
  const c = capture();
  expect(c.take(3999)).toBeNull();
  for (let now = 3050; now <= 4000; now += 50) {
    c.packet(snapshot(now), now);
    c.frame(now, 50, { tick: now, droppedSteps: 3, balls: [ball] }, []);
  }
  const trace = c.take(4000)!;
  expect(poolTraceSchema.safeParse(trace).success).toBe(true);
  expect(trace.window).toEqual({ start: 1000, end: 4000, partial: false });
  expect(trace.frames[0].at).toBe(1000);
  expect(trace.frames.at(-1)!.at).toBe(4000);
  expect(
    trace.frames.some((f) => f.rawFrameMs === 400 && f.droppedSteps === 3),
  ).toBe(true);
  expect(trace.frames.length).toBeLessThanOrEqual(64);
  expect(trace.packets.length).toBeLessThanOrEqual(128);
  expect(trace.context.initial[0].x).toBe(0);
  expect(c.take(5000)).toBeNull();
});
test("quiet play stays local and repeated small restores trigger only within their time window", () => {
  const c = new PoolTraceCapture();
  c.begin(context(), 0);
  c.correction(correction(0, 0.02));
  c.correction(correction(1100, 0.03));
  expect(c.take(1200)).toBeNull();
  c.correction(correction(1400, 0.03));
  c.correction(correction(1600, 0.03));
  const trace = c.take(2600)!;
  expect(trace.trigger.reason).toBe("repeated-corrections");
  expect(trace.trigger.at).toBe(1600);
  expect(poolTraceSchema.safeParse(trace).success).toBe(true);
});
test("deduplicates shots, enforces cooldown and does not mix a new rack into a pending incident", () => {
  const c = capture();
  c.sent("shot", 3100);
  const next = snapshot(3200);
  next.tables[0].rack = 2;
  c.packet(next, 3200);
  const trace = c.take(3200)!;
  expect(trace.window.partial).toBe(true);
  expect(trace.transmissions).toEqual([0, 3100]);
  expect(trace.packets.at(-1)!.serverTick).not.toBe(next.tick);
  c.begin(context("another"), 3300);
  c.correction(correction(3400));
  expect(c.take(4400)).toBeNull();
  c.begin(context("shot"), 40000);
  c.correction(correction(40100));
  expect(c.take(41100)).toBeNull();
  c.begin(context("later"), 42000);
  c.correction(correction(42100));
  expect(c.take(43100)).not.toBeNull();
  c.reset();
  expect(c.take(44000)).toBeNull();
});
test("copies evidence before native physics or the renderer can mutate it and retains late packet timing", () => {
  const c = new PoolTraceCapture(),
    initial = context();
  c.begin(initial, 0);
  initial.initial[0].x = 99;
  const event = correction(2000);
  c.correction(event);
  event.predicted[0].x = 88;
  const first = snapshot(1950),
    late = snapshot(1900);
  c.packet(first, 2050);
  c.packet(late, 2100, false);
  const trace = c.take(3000)!;
  expect(trace.context.initial[0].x).toBe(0);
  expect(trace.corrections[0].predicted[0].x).toBe(0);
  expect(trace.packets.map((p) => p.serverTime)).toEqual([1950, 1900]);
  expect(trace.packets[1].gapMs).toBe(50);
  expect(trace.packets[1].accepted).toBe(false);
  expect(poolTraceSchema.safeParse(trace).success).toBe(true);
});
test("compressed trace survives wire validation and ordinary message limits remain small", async () => {
  const trace = capture().take(4000)!;
  const message = await encodePoolTrace(trace);
  expect(message).not.toBeNull();
  expect(parseClientMessage(JSON.stringify(message))).toEqual(message);
  const decoded = JSON.parse(
    gunzipSync(Buffer.from(message!.payload, "base64")).toString(),
  );
  expect(decoded).toEqual(trace);
  expect(
    parseClientMessage(
      JSON.stringify({
        type: "chat",
        text: "x",
        padding: "x".repeat(MAX_CLIENT_MESSAGE_LENGTH),
      }),
    ),
  ).toBeNull();
  const invalid = structuredClone(trace);
  invalid.frames[0].at = 999;
  expect(poolTraceSchema.safeParse(invalid).success).toBe(false);
});

test("large correction histories keep their trigger instead of losing the incident", async () => {
  let seed = 19;
  const random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const states = (): PhysicalBall[] =>
    Array.from({ length: 16 }, (_, id) => {
      const q = [random(), random(), random(), random()];
      const length = Math.hypot(...q);
      return {
        ...ball,
        id,
        x: random(),
        y: 0.8 + random(),
        z: random(),
        vx: random(),
        vy: random(),
        vz: random(),
        w: [random(), random(), random()],
        q: q.map((v) => v / length) as PhysicalBall["q"],
      };
    });
  const trace = capture().take(4000)!;
  trace.frames = Array.from({ length: 64 }, (_, i) => ({
    at: 1000 + (i * 3000) / 63,
    rawFrameMs: 16,
    simulationTick: i,
    droppedSteps: 0,
    predicted: states(),
    rendered: [],
  }));
  trace.packets = Array.from({ length: 128 }, (_, i) => ({
    receivedAt: 1000 + (i * 3000) / 127,
    serverTick: i,
    serverTime: i * 33,
    estimatedOffsetMs: 0,
    gapMs: 33,
    rack: 1,
    accepted: true,
    turn: 3,
    phase: "rolling",
    balls: states(),
  }));
  trace.corrections = Array.from({ length: 31 }, (_, i) => ({
    ...correction(1000 + i * 100, 0.03 + random() * 0.5),
    predicted: states(),
    authoritative: states(),
    replayed: states(),
  }));
  for (const reason of ["large-correction", "repeated-corrections"] as const) {
    trace.trigger = {
      at: 3000,
      error: reason === "large-correction" ? 0.2 : 0.03,
      reason,
    };
    trace.corrections[20].error = trace.trigger.error;
    const encoded = await encodePoolTrace(trace);
    expect(encoded).not.toBeNull();
    const decoded = JSON.parse(
      gunzipSync(Buffer.from(encoded!.payload, "base64")).toString(),
    );
    expect(poolTraceSchema.safeParse(decoded).success).toBe(true);
    expect(decoded.omitted.corrections).toBeGreaterThan(0);
    expect(decoded.corrections).toContainEqual(trace.corrections[20]);
    expect(decoded.context.initial).toEqual(trace.context.initial);
  }
});
