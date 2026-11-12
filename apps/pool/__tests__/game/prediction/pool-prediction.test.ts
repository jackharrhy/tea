import { expect, test, spyOn } from "bun:test";
import { PoolPhysics } from "@harrhy/pool/engine";
import { createMatch, createShotResult, shotPower } from "@harrhy/pool";
import { POCKETS } from "@harrhy/pool/table";
import { INPUT_DT } from "@harrhy/pool-protocol";
import type { TableState, Snapshot } from "@harrhy/pool-protocol";
import { PoolPrediction } from "../../../app/game/prediction/pool-prediction";
import type { MotionEntity } from "../../../app/game/prediction/net-state";

const command = { id: "one", table: "a", turn: 0, angle: 0, power: 0.4 };
const ack = { ...command, accepted: true, time: 10000 };
function setup() {
  const p = POCKETS[0]!;
  const engine = new PoolPhysics([
    { id: 0, x: -0.3, z: 0.5, vx: 0, vz: 0, pocketed: false },
    { id: 1, x: 0, z: 0.5, vx: 0, vz: 0, pocketed: false },
    { id: 2, x: p.x, z: p.z, vx: 0, vz: 0, pocketed: false },
    { id: 3, x: 0, z: 0, vx: 0, vz: 0, pocketed: true },
  ]);
  const table: TableState = {
    id: "a",
    rack: 1,
    rematchReady: [],
    match: { ...createMatch(), phase: "aiming" },
    balls: structuredClone(engine.balls),
  };
  const errors: number[] = [];
  return {
    engine,
    table,
    errors,
    prediction: new PoolPrediction((_table, _turn, error) =>
      errors.push(error),
    ),
  };
}
function poses(table: TableState): MotionEntity[] {
  return table.balls.map((b) => ({
    id: `ball:a:${b.id}`,
    x: b.x,
    y: b.y,
    z: b.z,
    q: { x: b.q[0], y: b.q[1], z: b.q[2], w: b.q[3] },
    epoch: `1:${b.revision}`,
  }));
}
function snapshot(table: TableState, time: number): Snapshot {
  return {
    type: "state",
    tick: Math.round(time / (INPUT_DT * 1000)),
    time,
    players: [],
    tables: [structuredClone(table)],
  };
}

function expectPosesClose(
  actual: MotionEntity[],
  expected: MotionEntity[],
): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    const a = actual[i]!,
      b = expected[i]!;
    expect(a.id).toBe(b.id);
    expect(a.epoch).toBe(b.epoch);
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(1e-6);
    if (a.q && b.q)
      expect(
        Math.abs(a.q.x * b.q.x + a.q.y * b.q.y + a.q.z * b.q.z + a.q.w * b.q.w),
      ).toBeCloseTo(1, 5);
  }
}

test("future contact holds initial poses; collision and pocket drop precede acknowledgement", () => {
  const { engine, table, prediction } = setup();
  try {
    const shot = { ...command, power: shotPower(3.2) };
    expect(prediction.start(table, shot, 40)).toBe(true);
    const authority = poses(table);
    const extra = { id: "player:x", x: 9, y: 0, z: 0, epoch: "0" };
    authority.push(extra);
    expect(prediction.sample(0, 0, authority)).toEqual(authority);
    expect(prediction.sample(39, 0.039, authority)).toEqual(authority);
    prediction.ingest(snapshot(table, 9990), 50);
    const result = prediction.sample(340, 0.3, authority);
    expect(result.find((p) => p.id === "ball:a:1")!.x).toBeGreaterThan(0.1);
    expect(result.find((p) => p.id === "ball:a:2")!.y).toBeLessThan(
      table.balls[2]!.y - 0.05,
    );
    expect(result.find((p) => p.id === "ball:a:3")).toEqual(authority[3]);
    expect(result.find((p) => p.id === "player:x")).toBe(extra);
    expect(prediction.active).toBe(true);
  } finally {
    prediction.cancel();
    engine.dispose();
  }
});

test("jittered identical traces compare historical poses without restores or world recreation", () => {
  const { engine, table, prediction, errors } = setup();
  const restore = spyOn(PoolPhysics.prototype, "restore");
  const reset = spyOn(PoolPhysics.prototype, "reset");
  try {
    prediction.start(table, command, 40);
    prediction.acknowledge(ack, 120);
    engine.strike(command.angle, command.power);
    const result = createShotResult();
    const queue: { packet: Snapshot; due: number }[] = [];
    for (let i = 1; i <= 100; i++) {
      const previous = structuredClone(engine.balls);
      engine.step(INPUT_DT, result);
      const now = 40 + i * INPUT_DT * 1000;
      table.balls = structuredClone(engine.balls);
      // Unrelated return-tray motion must neither render locally nor trigger restores.
      Object.assign(table.balls[3]!, {
        x: i % 2,
        y: 0.4,
        q: [1, 0, 0, 0],
        revision: i,
      });
      table.match.phase = "rolling";
      if (i % 2 === 0)
        queue.push({
          packet: snapshot(table, ack.time + i * INPUT_DT * 1000),
          due: now + [30, 95, 45][i % 3]!,
        });
      for (const entry of queue.filter((e) => e.due <= now))
        prediction.ingest(entry.packet, now);
      queue.splice(0, queue.length, ...queue.filter((e) => e.due > now));
      const rendered = prediction.sample(now, INPUT_DT, poses(table));
      expect(rendered[0]!.x).toBeCloseTo(previous[0]!.x, 5);
      expect(rendered[3]).toEqual(poses(table)[3]);
      const q = rendered[1]!.q!;
      expect(
        Math.abs(
          q.x * previous[1]!.q[0] +
            q.y * previous[1]!.q[1] +
            q.z * previous[1]!.q[2] +
            q.w * previous[1]!.q[3],
        ),
      ).toBeCloseTo(1, 5);
      prediction.acknowledge(ack, now);
    }
    expect(prediction.correctionCount).toBe(0);
    expect(errors).toEqual([]);
    expect(restore).not.toHaveBeenCalled();
    expect(reset).toHaveBeenCalledTimes(1);
  } finally {
    prediction.cancel();
    engine.dispose();
    restore.mockRestore();
    reset.mockRestore();
  }
});

test("genuine correction reuses world, preserves render continuity, and resolves to buffered authority", () => {
  const { engine, table, prediction, errors } = setup();
  const restore = spyOn(PoolPhysics.prototype, "restore");
  const dispose = spyOn(PoolPhysics.prototype, "dispose");
  try {
    prediction.start(table, command, 0);
    prediction.acknowledge(ack, 100);
    engine.strike(command.angle, command.power);
    for (let i = 0; i < 12; i++) engine.step(INPUT_DT, createShotResult());
    table.balls = structuredClone(engine.balls);
    table.balls[1]!.x += 0.1;
    table.match.phase = "rolling";
    const authority = poses(table);
    const before = prediction.sample(200, 0.2, authority);
    prediction.ingest(snapshot(table, 10200), 200);
    expect(prediction.correctionCount).toBe(1);
    expect(errors[0]).toBeCloseTo(0.1, 6);
    expect(restore).toHaveBeenCalledTimes(1);
    expectPosesClose(prediction.sample(200, 0, authority), before);
    const current = prediction.sample(300, 0.1, authority);
    table.match.shotNumber++;
    table.match.phase = "aiming";
    prediction.ingest(snapshot(table, 10300), 300);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(prediction.sample(300, 0, authority)).toEqual(current);
    expect(prediction.sample(500, 0.2, authority)).toEqual(authority);
    expect(prediction.active).toBe(false);
  } finally {
    prediction.cancel();
    engine.dispose();
    restore.mockRestore();
    dispose.mockRestore();
  }
});

test("rejection, timeout, rack reset, disappearance and cancel release native worlds", () => {
  const { engine, table, prediction } = setup();
  const dispose = spyOn(PoolPhysics.prototype, "dispose");
  try {
    prediction.start(table, command, 0);
    prediction.acknowledge({ ...ack, id: "other", accepted: false }, 10);
    expect(prediction.active).toBe(true);
    prediction.acknowledge({ ...ack, accepted: false }, 20);
    expect(prediction.active).toBe(true);
    prediction.sample(200, 0.18, poses(table));
    expect(prediction.active).toBe(false);
    prediction.start(table, command, 0);
    for (let now = 100; now <= 3000; now += 100)
      prediction.sample(now, 0.1, poses(table));
    expect(prediction.active).toBe(true);
    prediction.sample(3001, 0.001, poses(table));
    expect(prediction.active).toBe(false);
    prediction.start(table, command, 0);
    prediction.ingest(snapshot({ ...table, rack: 2 }, 11000), 100);
    expect(prediction.active).toBe(false);
    prediction.start(table, command, 0);
    prediction.ingest({ ...snapshot(table, 12000), tables: [] }, 100);
    expect(prediction.active).toBe(false);
    prediction.start(table, command, 0);
    prediction.cancel();
    prediction.cancel();
    expect(dispose).toHaveBeenCalledTimes(5);
    expect(prediction.sample(100, 0.1, poses(table))).toEqual(poses(table));
  } finally {
    dispose.mockRestore();
    prediction.cancel();
    engine.dispose();
  }
});

test("suspended client abandons prediction instead of unbounded catch-up", () => {
  const { engine, table, prediction } = setup();
  const step = spyOn(PoolPhysics.prototype, "step");
  try {
    prediction.start(table, command, 0);
    prediction.acknowledge(ack, 50);
    prediction.sample(1100, 1.1, poses(table));
    expect(step).not.toHaveBeenCalled();
    expect(prediction.active).toBe(false);
  } finally {
    step.mockRestore();
    prediction.cancel();
    engine.dispose();
  }
});

test("rolling before ack confirms the original turn; late ack reconciles the retained snapshot", () => {
  const { engine, table, prediction, errors } = setup();
  const restore = spyOn(PoolPhysics.prototype, "restore");
  try {
    prediction.start(table, command, 40);
    engine.strike(command.angle, command.power);
    for (let i = 0; i < 6; i++) engine.step(INPUT_DT, createShotResult());
    table.balls = structuredClone(engine.balls);
    table.match.phase = "rolling";
    prediction.ingest(snapshot(table, 10100), 180);
    expect(prediction.active).toBe(true);
    prediction.sample(180, 0.14, poses(table));
    prediction.acknowledge(ack, 200);
    expect(prediction.correctionCount).toBe(0);
    expect(errors).toEqual([]);
    expect(restore).not.toHaveBeenCalled();
    expect(prediction.active).toBe(true);
    prediction.ingest(snapshot({ ...table, rack: 2 }, 10050), 210);
    expect(prediction.active).toBe(true);
  } finally {
    restore.mockRestore();
    prediction.cancel();
    engine.dispose();
  }
});

test("240 Hz rendering advances uniformly between fixed ticks with normalized sphere rotation", () => {
  const { engine, table, prediction } = setup();
  table.balls = [table.balls[0]!];
  table.balls[0]!.x = -0.4;
  table.balls[0]!.q = [0, 0, Math.sin(1.55), Math.cos(1.55)];
  const reference = new PoolPhysics(table.balls);
  const step = spyOn(PoolPhysics.prototype, "step");
  try {
    prediction.start(table, command, 40);
    reference.strike(command.angle, command.power);
    const frames = [structuredClone(reference.balls[0]!)];
    for (let tick = 1; tick <= 15; tick++) {
      reference.step(INPUT_DT, createShotResult());
      frames.push(structuredClone(reference.balls[0]!));
    }
    step.mockClear();
    const authority = poses(table);
    let previous = prediction.sample(40, 0, authority)[0]!;
    const distances: number[] = [];
    for (let frame = 1; frame <= 60; frame++) {
      const now = 40 + (frame * 1000) / 240;
      const pose = prediction.sample(now, 1 / 240, authority)[0]!;
      const renderTick = Math.max(0, frame / 4 - 1);
      const before = frames[Math.floor(renderTick)]!;
      const after = frames[Math.ceil(renderTick)]!;
      const alpha = renderTick % 1;
      expect(pose.x).toBeCloseTo(before.x + (after.x - before.x) * alpha, 6);
      if (frame > 4) {
        distances.push(pose.x - previous.x);
        expect(pose.x).toBeGreaterThan(previous.x + 0.001);
        const q = pose.q!;
        expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 5);
        const priorQ = previous.q!;
        expect(
          Math.abs(
            q.x * priorQ.x + q.y * priorQ.y + q.z * priorQ.z + q.w * priorQ.w,
          ),
        ).toBeGreaterThan(0.99);
      }
      previous = pose;
    }
    expect(Math.max(...distances) / Math.min(...distances)).toBeLessThan(1.5);
    expect(step).toHaveBeenCalledTimes(15);
    expect(prediction.correctionCount).toBe(0);
  } finally {
    step.mockRestore();
    prediction.cancel();
    reference.dispose();
    engine.dispose();
  }
});

test("rejection blends moving poses to authority once and disposes physics immediately", () => {
  const { engine, table, prediction } = setup();
  const dispose = spyOn(PoolPhysics.prototype, "dispose");
  try {
    prediction.start(table, command, 0);
    const authority = poses(table);
    const before = prediction.sample(200, 0.2, authority);
    prediction.acknowledge({ ...ack, accepted: false }, 200);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(prediction.active).toBe(true);
    expectPosesClose(prediction.sample(200, 0, authority), before);
    prediction.acknowledge({ ...ack, accepted: false }, 250);
    const middle = prediction.sample(290, 0.09, authority);
    expect(middle[1]!.x).toBeCloseTo((before[1]!.x + authority[1]!.x) / 2, 6);
    expect(prediction.sample(380, 0.09, authority)).toEqual(authority);
    expect(prediction.active).toBe(false);
    expect(dispose).toHaveBeenCalledTimes(1);
  } finally {
    dispose.mockRestore();
    prediction.cancel();
    engine.dispose();
  }
});

test("900 ms local lead still reconciles within budget, including server strike time zero", () => {
  const { engine, table, prediction } = setup();
  const step = spyOn(PoolPhysics.prototype, "step");
  try {
    prediction.start(table, command, 0);
    prediction.acknowledge({ ...ack, time: 0 }, 500);
    engine.strike(command.angle, command.power);
    for (let i = 0; i < 6; i++) engine.step(INPUT_DT, createShotResult());
    table.balls = structuredClone(engine.balls);
    table.balls[1]!.x += 0.1;
    table.match.phase = "rolling";
    const authority = poses(table);
    for (let now = 100; now <= 1000; now += 100)
      prediction.sample(now, 0.1, authority);
    const before = prediction.sample(1000, 0, authority);
    step.mockClear();
    prediction.ingest(snapshot(table, 100), 1000);
    expect(prediction.active).toBe(true);
    expect(prediction.correctionCount).toBe(1);
    expect(step).toHaveBeenCalledTimes(54);
    expectPosesClose(prediction.sample(1000, 0, authority), before);
    prediction.acknowledge({ ...ack, time: 0 }, 1010);
    prediction.ingest(snapshot(table, 100), 1010);
    expect(prediction.correctionCount).toBe(1);
    expect(step).toHaveBeenCalledTimes(54);
  } finally {
    step.mockRestore();
    prediction.cancel();
    engine.dispose();
  }
});

test("quaternion-only differences do not restore spheres, but changed angular velocity does", () => {
  const { engine, table, prediction } = setup();
  try {
    prediction.start(table, command, 0);
    prediction.acknowledge(ack, 0);
    engine.strike(command.angle, command.power);
    for (let i = 0; i < 12; i++) engine.step(INPUT_DT, createShotResult());
    table.match.phase = "rolling";
    table.balls = structuredClone(engine.balls);
    table.balls[1]!.q = [1, 0, 0, 0];
    prediction.sample(200, 0.2, poses(table));
    prediction.ingest(snapshot(table, 10200), 200);
    expect(prediction.correctionCount).toBe(0);
    for (let i = 0; i < 6; i++) engine.step(INPUT_DT, createShotResult());
    table.balls = structuredClone(engine.balls);
    table.balls[1]!.w[1] += 5;
    prediction.ingest(snapshot(table, 10300), 300);
    expect(prediction.correctionCount).toBe(1);
  } finally {
    prediction.cancel();
    engine.dispose();
  }
});

test("a warmed full break with 650 ms local lead converges without a restore storm", () => {
  const engine = new PoolPhysics();
  const prediction = new PoolPrediction();
  try {
    const result = createShotResult();
    for (let tick = 0; tick < 120; tick++) engine.step(INPUT_DT, result);
    const table: TableState = {
      id: "a",
      rack: 1,
      rematchReady: [],
      match: { ...createMatch(), phase: "aiming" },
      balls: structuredClone(engine.balls),
    };
    const shot = { ...command, angle: Math.PI / 2, power: 1 };
    prediction.start(table, shot, 0);
    for (let tick = 1; tick <= 39; tick++)
      prediction.sample(tick * INPUT_DT * 1000, INPUT_DT, []);
    prediction.acknowledge({ ...ack, time: 0 }, 650);
    engine.strike(shot.angle, shot.power);
    table.match.phase = "rolling";
    let resolved = false;
    for (let tick = 1; tick <= 900; tick++) {
      const moving = engine.step(INPUT_DT, result);
      const now = (tick + 39) * INPUT_DT * 1000;
      prediction.sample(now, INPUT_DT, []);
      if (tick % 2 === 0) {
        table.balls = structuredClone(engine.balls);
        prediction.ingest(snapshot(table, tick * INPUT_DT * 1000), now);
      }
      if (!moving) {
        resolved = true;
        break;
      }
    }
    expect(resolved).toBe(true);
    expect(prediction.active).toBe(true);
    expect(prediction.correctionCount).toBeLessThanOrEqual(8);
  } finally {
    prediction.cancel();
    engine.dispose();
  }
});

test("repeated corrections preserve 240 Hz forward velocity independently of the last RAF", () => {
  const { engine, table, prediction } = setup();
  const fresh = new PoolPrediction();
  const uncorrected = new PoolPrediction();
  table.balls = [table.balls[0]!];
  table.balls[0]!.x = -0.4;
  const reference = new PoolPhysics(table.balls);
  try {
    const shot = { ...command, power: shotPower(1.6) };
    for (const client of [prediction, fresh, uncorrected]) {
      client.start(table, shot, 0);
      client.acknowledge(ack, 0);
    }
    reference.strike(shot.angle, shot.power);
    const history = [structuredClone(reference.balls)];
    for (let tick = 1; tick <= 36; tick++) {
      reference.step(INPUT_DT, createShotResult());
      history.push(structuredClone(reference.balls));
    }
    const authority = poses(table);
    let previous = prediction.sample(0, 0, authority)[0]!;
    let previousReference = uncorrected.sample(0, 0, authority)[0]!;
    let count = 0;
    for (let frame = 1; frame <= 144; frame++) {
      const now = (frame * 1000) / 240;
      if (frame === 48 || frame === 80) {
        // Only fresh has rendered at receipt time. Prediction's last RAF is stale.
        const before = fresh.sample(now, 1 / 240, authority);
        table.balls = structuredClone(history[frame / 4 - 6]!);
        table.balls[0]!.z += ++count * 0.03;
        table.balls[0]!.x += count * 0.012;
        table.match.phase = "rolling";
        const packet = snapshot(table, ack.time + now - 100);
        prediction.ingest(packet, now);
        fresh.ingest(packet, now);
        expectPosesClose(fresh.sample(now, 0, authority), before);
        expect(prediction.correctionCount).toBe(count);
      }
      const rendered = prediction.sample(now, 1 / 240, authority);
      expectPosesClose(rendered, fresh.sample(now, 1 / 240, authority));
      const pose = rendered[0]!;
      const baseline = uncorrected.sample(now, 1 / 240, authority)[0]!;
      if (frame > 4) {
        const normalSpeed = (baseline.x - previousReference.x) * 240;
        const speed = (pose.x - previous.x) * 240;
        expect(speed).toBeGreaterThan(normalSpeed * 0.8);
        expect(speed).toBeLessThan(normalSpeed * 1.2);
        expect(Math.abs(pose.z - previous.z)).toBeLessThan(0.003);
      }
      previous = pose;
      previousReference = baseline;
    }
    expect(prediction.correctionCount).toBe(2);
  } finally {
    prediction.cancel();
    fresh.cancel();
    uncorrected.cancel();
    reference.dispose();
    engine.dispose();
  }
});

test("revision placement restore and rerack never report intentional position jumps", () => {
  const { engine, table, prediction, errors } = setup();
  try {
    prediction.start(table, command, 0);
    prediction.acknowledge(ack, 0);
    engine.strike(command.angle, command.power);
    for (let i = 0; i < 12; i++) engine.step(INPUT_DT, createShotResult());
    table.balls = structuredClone(engine.balls);
    table.match.phase = "rolling";
    table.balls[0]!.x += 0.5;
    table.balls[0]!.revision++;
    prediction.ingest(snapshot(table, 10200), 200);
    expect(prediction.correctionCount).toBe(1);
    expect(errors).toEqual([0]);
    table.rack++;
    prediction.ingest(snapshot(table, 10300), 300);
    expect(prediction.active).toBe(false);
    expect(errors).toEqual([0]);
  } finally {
    prediction.cancel();
    engine.dispose();
  }
});

test("gravity changes cancel stale trajectories, equal snapshots preserve them, and config survives starts", () => {
  const { engine, table, prediction } = setup();
  const setGravity = spyOn(PoolPhysics.prototype, "setGravity");
  const vector: [number, number, number] = [0.5, -8, 0.25];
  try {
    prediction.setGravity(vector);
    vector[0] = 99;
    prediction.start(table, command, 0);
    expect(setGravity).toHaveBeenLastCalledWith([0.5, -8, 0.25]);
    prediction.setGravity([0.5, -8, 0.25]);
    expect(prediction.active).toBe(true);
    prediction.setGravity([0, -9.81, 0]);
    expect(prediction.active).toBe(false);
    prediction.start(table, command, 0);
    expect(setGravity).toHaveBeenLastCalledWith([0, -9.81, 0]);
    prediction.cancel();
    prediction.start(table, command, 0);
    expect(setGravity).toHaveBeenLastCalledWith([0, -9.81, 0]);
    expect(() => prediction.setGravity([NaN, 0, 0])).toThrow(RangeError);
    expect(prediction.active).toBe(true);
  } finally {
    setGravity.mockRestore();
    prediction.cancel();
    engine.dispose();
  }
});

test("predicted contact audio starts locally and never replays already-heard correction steps", () => {
  const { engine, table } = setup();
  const heard: { table: string; rack: number; turn: number; kind: string }[] =
    [];
  const prediction = new PoolPrediction(
    undefined,
    (candidateTable, rack, turn, sound) => {
      heard.push({ table: candidateTable, rack, turn, kind: sound.kind });
    },
  );
  try {
    expect(prediction.start(table, command, 0)).toBe(true);
    prediction.sample(200, 0.2, poses(table));
    expect(heard.some((sound) => sound.kind === "cue")).toBe(true);
    expect(
      heard.every(
        (sound) => sound.table === "a" && sound.rack === 1 && sound.turn === 0,
      ),
    ).toBe(true);
    const count = heard.length;
    prediction.sample(200, 0, poses(table));
    expect(heard).toHaveLength(count);
    prediction.acknowledge(ack, 200);
    table.match.phase = "rolling";
    table.balls[0].x += 0.2;
    prediction.ingest(snapshot(table, 10050), 200);
    expect(prediction.correctionCount).toBe(1);
    expect(heard).toHaveLength(count);
    prediction.cancel();
    expect(prediction.soundContext).toBeNull();
  } finally {
    prediction.cancel();
    engine.dispose();
  }
});

test("correction trace preserves aligned physics and the displayed pose separately", () => {
  const { engine, table } = setup();
  const traces: import("@harrhy/pool-protocol").PoolTraceCorrection[] = [];
  const predictor = new PoolPrediction(undefined, undefined, (event) =>
    traces.push(structuredClone(event)),
  );
  try {
    expect(predictor.start(table, command, 0)).toBe(true);
    predictor.acknowledge(ack, 100);
    const displayed = predictor.sample(100, 0.1, poses(table));
    const authoritative = structuredClone(table);
    authoritative.match.phase = "rolling";
    authoritative.balls[0].x += 0.2;
    predictor.ingest(snapshot(authoritative, 10000 + 2 * INPUT_DT * 1000), 110);
    expect(traces).toHaveLength(1);
    const trace = traces[0];
    expect(trace.alignedTick).toBe(2);
    expect(trace.replayedTick).toBeGreaterThan(trace.alignedTick);
    expect(trace.authoritative[0].x).toBe(authoritative.balls[0].x);
    expect(trace.predicted[0].x).not.toBe(trace.authoritative[0].x);
    expect(trace.renderedBefore.find((p) => p.id === 0)!.x).toBe(
      displayed.find((p) => p.id === "ball:a:0")!.x,
    );
    expect(trace.replayed).toHaveLength(table.balls.length);
    const before = trace.predicted[0].x;
    predictor.sample(150, 0.04, poses(authoritative));
    expect(trace.predicted[0].x).toBe(before);
  } finally {
    predictor.cancel();
    engine.dispose();
  }
});
