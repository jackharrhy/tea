import { afterEach, expect, test } from "vitest";
import { PoolPhysics } from "../src/engine";
import {
  BALL_RADIUS,
  createRack,
  createShotResult,
  shotPower,
  type Ball,
  type PoolSound,
} from "../src/physics";
import { FELT_Y, POCKETS } from "../src/physical-table";

const engines: PoolPhysics[] = [];
const ball = (id: number, x: number, z: number, vx = 0): Ball => ({
  id,
  x,
  z,
  vx,
  vz: 0,
  pocketed: false,
});
function engine(balls: Ball[]) {
  const physics = new PoolPhysics(balls);
  engines.push(physics);
  return physics;
}
afterEach(() => {
  for (const physics of engines.splice(0)) physics.dispose();
});
function collect(physics: PoolPhysics, seconds: number) {
  const sounds: PoolSound[] = [];
  const result = createShotResult();
  for (let i = 0; i < seconds * 120; i++) {
    physics.step(1 / 120, result);
    expect(physics.sounds.length).toBeLessThanOrEqual(32);
    sounds.push(...physics.sounds);
  }
  return sounds;
}

test("cue is queued once for positive time and cleared by restore, reset and replacement strike", () => {
  const physics = engine([ball(0, 0, 0)]);
  physics.strike(0, shotPower(1));
  physics.step(0, createShotResult());
  expect(physics.sounds).toEqual([]);
  physics.step(1 / 240, createShotResult());
  expect(physics.sounds.filter((s) => s.kind === "cue")).toEqual([
    { kind: "cue", ballId: 0, x: 0, y: FELT_Y + BALL_RADIUS, z: 0, speed: 1 },
  ]);
  expect(collect(physics, 0.02).some((s) => s.kind === "cue")).toBe(false);
  physics.strike(0, 1);
  physics.restore(structuredClone(physics.balls));
  expect(collect(physics, 0.02).some((s) => s.kind === "cue")).toBe(false);
  physics.strike(0, 1);
  physics.reset([ball(0, 0, 0)]);
  expect(collect(physics, 0.02).some((s) => s.kind === "cue")).toBe(false);
  physics.strike(0, 1);
  physics.strike(0, shotPower(0.5));
  const cues = collect(physics, 0.02).filter((s) => s.kind === "cue");
  expect(cues).toHaveLength(1);
  expect(cues[0]!.speed).toBeCloseTo(0.5);
});

test("native ball and cushion hits expose impact position and approach speed", () => {
  const physics = engine([ball(0, -0.12, 0, 1), ball(1, 0, 0)]);
  const sounds = collect(physics, 1);
  const hit = sounds.find((s) => s.kind === "ball")!;
  expect(hit.ballId).toBe(0);
  expect(hit.otherBallId).toBe(1);
  expect(hit.speed).toBeGreaterThan(0.8);
  expect(hit.speed).toBeLessThan(1.1);
  expect(Math.abs(hit.x)).toBeLessThan(0.04);
  expect([hit.x, hit.y, hit.z].every(Number.isFinite)).toBe(true);
  const rail = engine([ball(2, 0.45, 0.3, 1)]);
  expect(
    collect(rail, 0.5).some((s) => s.kind === "cushion" && s.speed > 0.5),
  ).toBe(true);
});

test("pocket capture emits once and physical return contacts use return kind", () => {
  const pocket = POCKETS[1]!;
  const physics = engine([ball(1, pocket.x, pocket.z)]);
  const sounds = collect(physics, 5);
  expect(sounds.filter((s) => s.kind === "pocket")).toHaveLength(1);
  expect(sounds.some((s) => s.kind === "return")).toBe(true);
  expect(physics.recoveryCount).toBe(0);
});

test("resting rack has no contact buzz and a break stays bounded", () => {
  const physics = engine(createRack());
  collect(physics, 1);
  expect(collect(physics, 2)).toEqual([]);
  physics.strike(Math.PI / 2, 1);
  const sounds = collect(physics, 3);
  expect(sounds.some((s) => s.kind === "ball")).toBe(true);
  expect(sounds.every((s) => s.speed >= 0.04)).toBe(true);
});

test("recovery and restoration do not synthesize impact sounds", () => {
  const physics = engine([ball(0, 5, 0)]);
  expect(collect(physics, 0.5)).toEqual([]);
  expect(physics.recoveryCount).toBe(1);
  physics.restore(structuredClone(physics.balls));
  expect(physics.sounds).toEqual([]);
});

test("a real felt landing is audible without counting as a rule cushion", () => {
  const physics = engine([ball(0, 0, 0)]);
  const snapshot = structuredClone(physics.balls);
  snapshot[0]!.y += 0.1;
  physics.restore(snapshot);
  const result = createShotResult();
  result.firstContact = 1;
  const sounds: PoolSound[] = [];
  for (let i = 0; i < 60; i++) {
    physics.step(1 / 120, result);
    sounds.push(...physics.sounds);
  }
  expect(sounds.some((s) => s.kind === "cushion" && s.speed > 0.5)).toBe(true);
  expect(result.railAfterContact).toBe(false);
});
