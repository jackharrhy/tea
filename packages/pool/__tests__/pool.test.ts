import { describe, expect, test } from "vitest";
import {
  BALL_RADIUS,
  TABLE_HALF_WIDTH,
  TABLE_HALF_LENGTH,
  createRack,
  createShotResult,
  canPlaceCue,
  placeCue,
  createMatch,
  startMatch,
  resolveShot,
  type Ball,
  type ShotResult,
} from "../src/index";

import { shotSpeed, shotPower } from "../src/physics";
import { POCKETS } from "../src/physical-table";
import { PoolPhysics } from "../src/engine";

const ball = (id: number, x = 0, z = 0, vx = 0, vz = 0): Ball => ({
  id,
  x,
  z,
  vx,
  vz,
  pocketed: false,
});
const shot = (
  firstContact: number | null,
  potted: readonly number[] = [],
  railAfterContact = false,
): ShotResult => ({ firstContact, potted: [...potted], railAfterContact });
function match() {
  const state = createMatch();
  startMatch(state, ["A", "B"]);
  state.phase = "rolling";
  return state;
}
function pot(balls: Ball[], ...ids: number[]) {
  for (const b of balls) if (ids.includes(b.id)) b.pocketed = true;
}

describe("physics", () => {
  test("shot power gives gentle taps, a 7.5 m/s cap and an inverse speed mapping", () => {
    expect(shotSpeed(0.05)).toBeCloseTo(0.0754, 3);
    expect(shotSpeed(0.5)).toBeCloseTo(1.895, 3);
    expect(shotSpeed(1)).toBe(7.5);
    expect(shotSpeed(-1)).toBe(0);
    expect(shotSpeed(2)).toBe(7.5);
    expect(shotPower(-1)).toBe(0);
    expect(shotPower(8)).toBe(1);
    for (const power of [0, 0.05, 0.25, 0.5, 0.75, 1])
      expect(shotPower(shotSpeed(power))).toBeCloseTo(power, 12);
  });

  test("rack is separated and independently allocated", () => {
    const balls = createRack();
    const initial = structuredClone(balls);
    expect(new Set(balls.map((b) => b.id)).size).toBe(16);
    for (let i = 0; i < balls.length; i++)
      for (let j = i + 1; j < balls.length; j++) {
        expect(
          Math.hypot(balls[i]!.x - balls[j]!.x, balls[i]!.z - balls[j]!.z),
        ).toBeGreaterThanOrEqual(2 * BALL_RADIUS);
      }
    balls[0]!.x = 1;
    expect(createRack()).toEqual(initial);
  });

  test("glancing rigid-body contact deflects the cue and object in opposite directions", () => {
    const engine = new PoolPhysics([
      ball(0, -0.3, 0.5, 4),
      ball(2, 0, 0.5 + BALL_RADIUS),
    ]);
    try {
      const result = createShotResult();
      engine.step(0.1, result);
      expect(result.firstContact).toBe(2);
      expect(engine.balls[1]!.vx).toBeGreaterThan(0);
      expect(engine.balls[1]!.vz).toBeGreaterThan(0);
      expect(engine.balls[0]!.vz).toBeLessThan(0);
    } finally {
      engine.dispose();
    }
  });

  test("a rail before first contact does not qualify when the cue later hits an object", () => {
    const engine = new PoolPhysics([
      ball(0, TABLE_HALF_WIDTH - BALL_RADIUS - 0.01, 0.35, 3),
      ball(1, TABLE_HALF_WIDTH - 0.2, 0.35),
    ]);
    try {
      const result = createShotResult();
      engine.step(0.04, result);
      expect(engine.balls[0]!.vx).toBeLessThan(0);
      expect(result.firstContact).toBeNull();
      expect(result.railAfterContact).toBe(false);
      let moving = true;
      for (
        let frame = 0;
        moving && result.firstContact === null && frame < 4800;
        frame++
      )
        moving = engine.step(1 / 240, result);
      expect(result.firstContact).toBe(1);
      expect(result.railAfterContact).toBe(false);
    } finally {
      engine.dispose();
    }
  });

  test("solid cushion faces rebound balls without recording a pot", () => {
    for (const initial of [
      ball(1, TABLE_HALF_WIDTH - BALL_RADIUS - 0.01, 0.5, 0.5),
      ball(1, 0, TABLE_HALF_LENGTH - BALL_RADIUS - 0.01, 0, 0.5),
    ]) {
      const engine = new PoolPhysics([initial]);
      try {
        const result = shot(1);
        engine.step(0.1, result);
        const rebound = engine.balls[0]!;
        expect(initial.vx ? rebound.vx : rebound.vz).toBeLessThan(0);
        expect(result.potted).toEqual([]);
        expect(result.railAfterContact).toBe(true);
      } finally {
        engine.dispose();
      }
    }
  });

  test("placement rejects overlaps, pockets, and nonfinite coordinates without mutation", () => {
    const balls = createRack();
    pot(balls, 0);
    const before = structuredClone(balls);
    expect(placeCue(balls, balls[1]!.x, balls[1]!.z)).toBe(false);
    expect(canPlaceCue(balls, POCKETS[1]!.x, POCKETS[1]!.z)).toBe(false);
    expect(placeCue(balls, NaN, 0)).toBe(false);
    expect(placeCue(balls, TABLE_HALF_WIDTH, -1)).toBe(false);
    expect(balls).toEqual(before);
    expect(placeCue(balls, 0, -1)).toBe(true);
    expect(balls[0]).toMatchObject({
      x: 0,
      z: -1,
      pocketed: false,
      vx: 0,
      vz: 0,
    });
  });
});

describe("rules", () => {
  test("legal pot assigns groups and retains turn; legal dry shot passes", () => {
    const state = match();
    const balls = createRack();
    pot(balls, 9);
    resolveShot(state, balls, shot(1, [9]));
    expect(state.groups).toEqual(["stripe", "solid"]);
    expect(state.turn).toBe(0);
    resolveShot(state, balls, shot(10, [], true));
    expect(state.turn).toBe(1);
    expect(state.shotNumber).toBe(2);
  });

  test.each([shot(null), shot(8, [], true), shot(1), shot(1, [0, 2])])(
    "open-table foul gives ball in hand without assignment: %j",
    (result) => {
      const state = match();
      const balls = createRack();
      pot(balls, ...result.potted);
      resolveShot(state, balls, result);
      expect(state.phase).toBe("ball-in-hand");
      expect(state.turn).toBe(1);
      expect(state.groups).toEqual([null, null]);
    },
  );

  test("wrong group first is a foul even when own ball falls", () => {
    const state = match();
    state.groups = ["solid", "stripe"];
    const balls = createRack();
    pot(balls, 1);
    resolveShot(state, balls, shot(9, [1]));
    expect(state.phase).toBe("ball-in-hand");
    expect(state.turn).toBe(1);
  });

  test.each([
    { cleared: true, potted: [8], first: 8, winner: "A" },
    { cleared: true, potted: [8, 0], first: 8, winner: "B" },
    { cleared: true, potted: [8], first: 9, winner: "B" },
    { cleared: false, potted: [8], first: 1, winner: "B" },
    { cleared: true, potted: [7, 8], first: 7, winner: "B" },
  ])("eight outcome: %j", ({ cleared, potted, first, winner }) => {
    const state = match();
    state.groups = ["solid", "stripe"];
    const balls = createRack();
    if (cleared) pot(balls, 1, 2, 3, 4, 5, 6, 7);
    pot(balls, ...potted);
    resolveShot(state, balls, shot(first, potted));
    expect(state.phase).toBe("finished");
    expect(state.winner).toBe(winner);
    resolveShot(state, balls, shot(null));
    expect(state.shotNumber).toBe(1);
  });

  test("eight contact requires a cleared group even when the eight stays up", () => {
    for (const cleared of [false, true]) {
      const state = match();
      state.groups = ["solid", "stripe"];
      const balls = createRack();
      if (cleared) pot(balls, 1, 2, 3, 4, 5, 6, 7);
      resolveShot(state, balls, shot(8, [], true));
      expect(state.phase).toBe(cleared ? "aiming" : "ball-in-hand");
      expect(state.turn).toBe(1);
      expect(state.winner).toBeNull();
    }
  });

  test("scratch through physics gives ball in hand and cue can be restored for the next shot", () => {
    const state = match();
    const engine = new PoolPhysics(createRack());
    try {
      expect(engine.placeCue(TABLE_HALF_WIDTH - 0.2, 0)).toBe(true);
      engine.strike(0, 0.2);
      const result = createShotResult();
      let moving = true;
      for (let frame = 0; moving && frame < 1200; frame++)
        moving = engine.step(1 / 60, result);
      expect(moving).toBe(false);
      expect(result.potted).toEqual([0]);
      resolveShot(state, engine.balls, result);
      expect(state.phase).toBe("ball-in-hand");
      expect(state.turn).toBe(1);
      expect(engine.placeCue(0, -1)).toBe(true);
      expect(engine.balls[0]).toMatchObject({ pocketed: false, vx: 0, vz: 0 });
      engine.strike(Math.PI / 2, 0.2);
      expect(engine.step(0.1, createShotResult())).toBe(true);
      expect(engine.balls[0]!.z).toBeGreaterThan(-1);
    } finally {
      engine.dispose();
    }
  });

  test("eight on simplified break loses; start resets prior match", () => {
    const state = match();
    const balls = createRack();
    pot(balls, 8);
    resolveShot(state, balls, shot(1, [8]));
    expect(state.winner).toBe("B");
    startMatch(state, ["C", "D"]);
    expect(state).toMatchObject({
      phase: "aiming",
      winner: null,
      shotNumber: 0,
      groups: [null, null],
    });
  });
});
