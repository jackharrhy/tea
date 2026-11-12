import { describe, expect, test } from "bun:test";
import {
  addAvatar,
  createMovementWorld,
  stepAvatar,
} from "@harrhy/pool-simulation";
import { WALK_SPEED } from "@harrhy/pool-simulation/geometry";
import {
  INPUT_DT,
  LocalPrediction,
  RemoteMotion,
} from "../../../app/game/prediction/net-state";
import type { MotionEntity } from "../../../app/game/prediction/net-state";

const entity = (x: number, epoch = "rack:1/place:0"): MotionEntity => ({
  id: "ball:1:0",
  x,
  y: 1,
  z: 0,
  epoch,
});

const path = (t: number) => (t < 600 ? t / 1000 : 0.6 + (t - 600) / 2000);

describe("LocalPrediction", () => {
  test("replays only unacknowledged fixed steps through shared collisions", () => {
    const local = new LocalPrediction({ x: 0, z: 6.1, seq: 0 });
    const world = createMovementWorld();
    const avatar = addAvatar(world, 0, 6.1);
    let authoritative = { x: 0, z: 6.1 };
    for (let seq = 1; seq <= 90; seq++) {
      local.predict({ seq, x: 1, z: -1 });
      if (seq <= 45) authoritative = stepAvatar(world, avatar, 1, -1, INPUT_DT);
    }
    const rendered = local.sample(0);
    authoritative.x -= 0.2;
    world.components.Position.x[avatar] = authoritative.x;
    local.reconcile({ ...authoritative, seq: 45 });
    let expected = authoritative;
    for (let seq = 46; seq <= 90; seq++)
      expected = stepAvatar(world, avatar, 1, -1, INPUT_DT);
    expect(local.position()).toEqual(expected);
    expect(local.pendingCount).toBe(45);
    expect(local.sample(0).x).toBeCloseTo(rendered.x, 10);
    expect(local.sample(0).z).toBeCloseTo(rendered.z, 10);
    expect(local.sample(1).x).toBeCloseTo(expected.x, 5);
    local.reconcile({ x: 9, z: 9, seq: 44 });
    expect(local.position()).toEqual(expected);
  });

  test("bounded pending inputs apply backpressure and recover after acknowledgement", () => {
    const local = new LocalPrediction({ x: 0, z: 0, seq: 0 });
    for (let seq = 1; seq <= 120; seq++)
      expect(local.predict({ seq, x: 0, z: 0 })).toBe(true);
    expect(local.predict({ seq: 121, x: 1, z: 0 })).toBe(false);
    expect(local.pendingCount).toBe(120);
    expect(local.position()).toEqual({ x: 0, z: 0 });
    local.reconcile({ x: 0, z: 0, seq: 60 });
    expect(local.predict({ seq: 121, x: 1, z: 0 })).toBe(true);
    expect(local.predict({ seq: 121, x: 1, z: 0 })).toBe(false);
  });

  test("explicit teleports clear prediction; large corrections snap render error", () => {
    const local = new LocalPrediction({ x: 0, z: 6.1, seq: 0, revision: 0 });
    local.predict({ seq: 1, x: 1, z: 0 });
    local.reconcile({ x: 0.5, z: 6.1, seq: 0, table: "1", revision: 1 });
    expect(local.sample(0)).toEqual({ x: 0.5, z: 6.1 });
    expect(local.pendingCount).toBe(0);
    expect(local.predict({ seq: 2, x: 1, z: 0 })).toBe(false);
    local.reconcile({ x: 0, z: 6.1, seq: 0, revision: 2 });
    local.predict({ seq: 2, x: 1, z: 0 });
    local.reconcile({ x: 0.2, z: 6.1, seq: 0, revision: 3 });
    expect(local.sample(0)).toEqual({ x: 0.2, z: 6.1 });
    local.reconcile({ x: 0, z: 6.1, seq: 0, revision: 2 });
    expect(local.position().x).toBe(0.2);
    local.predict({ seq: 3, x: 1, z: 0 });
    local.reconcile({ x: -6, z: 6.1, seq: 1, revision: 3 });
    expect(local.pendingCount).toBe(1);
    expect(local.sample(0)).toEqual(local.position());
  });
});

describe("RemoteMotion", () => {
  test("latency and jitter bursts follow a piecewise linear path without rewind", () => {
    const motion = new RemoteMotion();
    const packets = Array.from({ length: 41 }, (_, i) => ({
      time: i * 50,
      arrival: i * 50 + 40 + (i >= 12 && i <= 15 ? 90 : [0, 12, 25, 8][i % 4]),
    })).toSorted((a, b) => a.arrival - b.arrival);
    let previous = 0;
    let newest = 0;
    for (let now = 40; now <= 2150; now += 10) {
      while (packets.length && packets[0].arrival <= now) {
        const p = packets.shift()!;
        newest = Math.max(newest, p.time);
        motion.ingest(
          1_700_000_000_000 + p.time,
          [entity(path(p.time))],
          p.arrival,
        );
      }
      const pose = motion.sample(now)[0];
      expect(pose.x).toBeGreaterThanOrEqual(previous - 1e-10);
      expect(pose.x - previous).toBeLessThanOrEqual(0.06);
      if (now >= 165) {
        const ideal = path(Math.min(newest, now - 165));
        expect(pose.x).toBeLessThanOrEqual(ideal + 1e-8);
        // An underrun rebuilds the buffer through bounded catch-up, rather than jumping.
        expect(ideal - pose.x).toBeLessThan(0.04);
      }
      previous = pose.x;
    }
    expect(motion.sample(100_000)[0].x).toBe(path(2000));
  });

  test("final rolling endpoint survives aiming, outage and backwards local clock", () => {
    const motion = new RemoteMotion(100);
    expect(motion.sample(0)).toEqual([]);
    motion.ingest(0, [entity(0)], 40);
    motion.ingest(50, [entity(0.5)], 90);
    motion.ingest(100, [entity(0.75)], 140); // final position, now aiming; epoch unchanged
    expect(motion.sample(215)[0].x).toBeCloseTo(0.625);
    expect(motion.sample(200)[0].x).toBeCloseTo(0.625);
    expect(motion.sample(240)[0].x).toBe(0.75);
    expect(motion.sample(20_000)[0].x).toBe(0.75);
  });

  test("epoch changes and large teleports snap; reordered packets cannot resurrect old epochs", () => {
    const motion = new RemoteMotion();
    motion.ingest(0, [entity(0)], 0);
    motion.ingest(50, [entity(0.5)], 50);
    expect(motion.sample(150)[0].x).toBeCloseTo(0.25);
    motion.ingest(100, [entity(0.6, "rack:1/place:1")], 160);
    expect(motion.sample(160)[0].x).toBe(0.6);
    motion.ingest(75, [entity(0.55)], 170);
    expect(motion.sample(170)[0].epoch).toBe("rack:1/place:1");
    motion.ingest(150, [entity(7, "rack:1/place:1")], 180);
    expect(motion.sample(180)[0].x).toBe(7);
    motion.ingest(200, [], 220);
    expect(motion.sample(220)).toEqual([]);
  });

  test("yaw wraps and quaternions slerp along the short arc", () => {
    const motion = new RemoteMotion(100);
    const a = {
      ...entity(0),
      yaw: Math.PI - 0.1,
      q: { x: 0, y: 0, z: 0, w: 1 },
    };
    const b = {
      ...entity(1),
      yaw: -Math.PI + 0.1,
      q: { x: 0, y: -Math.SQRT1_2, z: 0, w: -Math.SQRT1_2 },
    };
    motion.ingest(0, [a], 0);
    motion.ingest(100, [b], 100);
    const pose = motion.sample(150)[0];
    expect(Math.cos(pose.yaw!)).toBeCloseTo(-1, 8);
    expect(Math.abs(pose.q!.y)).toBeCloseTo(Math.sin(Math.PI / 8), 8);
    expect(Math.abs(pose.q!.w)).toBeCloseTo(Math.cos(Math.PI / 8), 8);
    expect(pose.x).toBe(0.5);
    pose.q!.w = 0;
    expect(motion.sample(150)[0].q!.w).not.toBe(0);
  });

  test("long sessions retain bounded interpolation history and freeze at the latest pose", () => {
    const motion = new RemoteMotion();
    for (let i = 0; i < 300; i++) {
      motion.ingest(i * 50, [entity(i / 100)], i * 50);
      expect(Number.isFinite(motion.sample(i * 50)[0].x)).toBe(true);
    }
    expect(motion.sample(100_000)[0].x).toBe(2.99);
  });
});

test("snapshot underrun freezes the playback clock and resumes without a catch-up jump", () => {
  const motion = new RemoteMotion(100);
  motion.ingest(0, [entity(0)], 0);
  motion.ingest(100, [entity(0.1)], 100);
  expect(motion.sample(1000)[0].x).toBe(0.1);
  motion.ingest(1000, [entity(1)], 1001);
  const resumed = motion.sample(1010)[0].x;
  expect(resumed).toBeGreaterThanOrEqual(0.1);
  expect(resumed).toBeLessThanOrEqual(0.112);
  expect(motion.sample(1020)[0].x - resumed).toBeLessThanOrEqual(0.012);
});

test("retired commands leave prediction even if no later input is ever applied", () => {
  const local = new LocalPrediction({ x: 0, z: 0, seq: 0 });
  for (let seq = 1; seq <= 6; seq++) local.predict({ seq, x: 1, z: 0 });
  local.reconcile({ x: 0, z: 0, seq: 0, retiredSeq: 6 });
  expect(local.pendingCount).toBe(0);
  expect(local.position()).toEqual({ x: 0, z: 0 });
  expect(local.sample(2).x).toBeCloseTo(0, 7);
  local.predict({ seq: 7, x: 1, z: 0 });
  local.reconcile({ x: 0, z: 0, seq: 0, retiredSeq: 6 });
  expect(local.pendingCount).toBe(1);
  expect(local.position().x).toBeCloseTo(WALK_SPEED * INPUT_DT);
});

test("a long acknowledgement delay is not mistaken for a teleport", () => {
  const local = new LocalPrediction({ x: 0, z: 6.1, seq: 0 });
  const world = createMovementWorld(),
    avatar = addAvatar(world, 0, 6.1);
  let authoritative = { x: 0, z: 6.1 };
  for (let seq = 1; seq <= 120; seq++) {
    local.predict({ seq, x: 0, z: -1 });
    if (seq <= 60) authoritative = stepAvatar(world, avatar, 0, -1, INPUT_DT);
  }
  const before = local.position();
  expect(
    Math.hypot(before.x - authoritative.x, before.z - authoritative.z),
  ).toBeGreaterThan(3);
  local.reconcile({ ...authoritative, seq: 60 });
  expect(local.pendingCount).toBe(60);
  expect(local.position()).toEqual(before);
});

test("a large retirement correction preserves the suffix the server will still apply", () => {
  const local = new LocalPrediction({ x: 0, z: 6.1, seq: 0 });
  for (let seq = 1; seq <= 72; seq++) local.predict({ seq, x: 0, z: -1 });
  local.reconcile({ x: 0, z: 6.1, seq: 0, retiredSeq: 60 });
  expect(local.pendingCount).toBe(12);
  expect(local.position().z).toBeCloseTo(6.1 - 12 * WALK_SPEED * INPUT_DT);
  expect(local.sample(0)).toEqual(local.position());
});

test("240 Hz rendering fills the gaps between 60 Hz predicted steps", () => {
  const local = new LocalPrediction({ x: 0, z: 0, seq: 0 });
  let previous = 0;
  for (let frame = 0; frame <= 240; frame++) {
    if (frame % 4 === 0) local.predict({ seq: frame / 4 + 1, x: 1, z: 0 });
    const pose = local.sample(1 / 240, (frame % 4) / 4);
    if (frame > 0) expect(pose.x - previous).toBeCloseTo(WALK_SPEED / 240, 8);
    previous = pose.x;
  }
  expect(previous).toBeCloseTo(WALK_SPEED, 8);
});

test("reconciliation preserves an in-between rendered pose; teleports snap both endpoints", () => {
  const local = new LocalPrediction({ x: 0, z: 0, seq: 0 });
  for (let seq = 1; seq <= 6; seq++) local.predict({ seq, x: 1, z: 0 });
  const before = local.sample(0, 0.4);
  local.reconcile({ x: 0.1, z: 0, seq: 3 });
  expect(local.sample(0, 0.4).x).toBeCloseTo(before.x, 8);
  local.reconcile({ x: -1, z: 1, seq: 6, revision: 1 });
  expect(local.sample(0, 0)).toEqual({ x: -1, z: 1 });
  expect(local.sample(0, 1)).toEqual({ x: -1, z: 1 });
});

test("prediction backpressure holds its endpoint instead of replaying the last rendered step", () => {
  const local = new LocalPrediction({ x: -WALK_SPEED, z: 0, seq: 0 });
  for (let seq = 1; seq <= 120; seq++) local.predict({ seq, x: 1, z: 0 });
  const end = local.position();
  for (let frame = 0; frame < 30; frame++) {
    expect(local.predict({ seq: 121, x: 1, z: 0 })).toBe(false);
    expect(local.sample(1 / 120, (frame % 2) / 2)).toEqual(end);
  }
  local.reconcile({ x: 0, z: 0, seq: 60 });
  expect(local.predict({ seq: 121, x: 1, z: 0 })).toBe(true);
  expect(local.sample(0, 0).x).toBeCloseTo(end.x);
  expect(local.sample(0, 1).x).toBeGreaterThan(end.x);
});

test("correction metrics use replayed displacement and exclude real revision/table teleports", () => {
  const errors: number[] = [];
  const local = new LocalPrediction({ x: 0, z: 6.1, seq: 0 }, (n) =>
    errors.push(n),
  );
  const world = createMovementWorld();
  const avatar = addAvatar(world, 0, 6.1);
  let authority = { x: 0, z: 6.1 };
  for (let seq = 1; seq <= 90; seq++) {
    local.predict({ seq, x: 0, z: -1 });
    if (seq <= 30) authority = stepAvatar(world, avatar, 0, -1, INPUT_DT);
  }
  local.reconcile({ ...authority, seq: 30 });
  expect(errors[0]).toBeLessThan(1e-8);
  local.reconcile({ ...authority, x: authority.x + 0.2, seq: 30 });
  expect(errors[1]).toBeCloseTo(0.2, 6);
  local.reconcile({ x: 5, z: 5, seq: 90, revision: 1 });
  local.reconcile({ x: 1, z: 1, seq: 90, revision: 1, table: "a" });
  local.reconcile({ x: 2, z: 2, seq: 90, revision: 2 });
  expect(errors).toHaveLength(2);
});
