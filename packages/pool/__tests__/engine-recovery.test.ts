import { expect, test } from "vitest";
import { PoolPhysics } from "../src/engine";
import {
  createRack,
  shotPower,
  createShotResult,
  BALL_RADIUS,
} from "../src/physics";
import type { Ball, PhysicalBall } from "../src/physics";
import {
  FELT_Y,
  POCKETS,
  TABLE_BOUNDS,
  RETURN_TRAY,
  RETURNS,
} from "../src/physical-table";

const ball = (id: number, x: number, z: number, vx = 0, vz = 0): Ball => ({
  id,
  x,
  z,
  vx,
  vz,
  pocketed: false,
});

function advance(
  engine: PoolPhysics,
  seconds: number,
  result = createShotResult(),
) {
  for (let i = 0; i < seconds * 120; i++) engine.step(1 / 120, result);
  return result;
}

function contained(b: PhysicalBall): boolean {
  return (
    [b.x, b.y, b.z, b.vx, b.vy, b.vz, ...b.q, ...b.w].every(Number.isFinite) &&
    b.y > 0 &&
    b.y <
      Math.max(...RETURNS.map((part) => part.center[1] + part.size[1] / 2)) +
        BALL_RADIUS &&
    Math.abs(b.x) + BALL_RADIUS < TABLE_BOUNDS.x &&
    Math.abs(b.z) + BALL_RADIUS < TABLE_BOUNDS.z
  );
}

test("an out-of-bounds body uses an observable teleport recovery exactly once", () => {
  const engine = new PoolPhysics([ball(0, 5, 0)]);
  try {
    const revision = engine.balls[0]!.revision;
    const result = advance(engine, 2);
    expect(engine.recoveryCount).toBe(1);
    expect(engine.lastRecovery?.ballId).toBe(0);
    expect(engine.lastRecovery!.from[0]).toBeGreaterThan(4);
    expect(engine.balls[0]!.revision).toBeGreaterThan(revision);
    expect(engine.balls[0]!.stage).toBe("table");
    expect(contained(engine.balls[0]!)).toBe(true);
    expect(result.potted).toEqual([]);
    expect(engine.step(0, result)).toBe(false);
  } finally {
    engine.dispose();
  }
});

test("stored initialization and recovery use the collector's three-column packing", () => {
  const initial = createRack().map((b) => ({ ...b, pocketed: true }));
  const engine = new PoolPhysics(initial);
  try {
    advance(engine, 2);
    expect(
      engine.balls.every((b) => b.stage === "stored" && contained(b)),
    ).toBe(true);
    expect(engine.recoveryCount).toBe(0);
    const snapshot = structuredClone(engine.balls);
    snapshot[15]!.x = 5;
    engine.restore(snapshot);
    advance(engine, 2);
    expect(engine.recoveryCount).toBe(1);
    for (const b of engine.balls) {
      expect(b.stage).toBe("stored");
      expect(b.x - BALL_RADIUS).toBeGreaterThanOrEqual(
        RETURN_TRAY.minX - 0.001,
      );
      expect(b.x + BALL_RADIUS).toBeLessThanOrEqual(RETURN_TRAY.maxX + 0.001);
      expect(b.z - BALL_RADIUS).toBeGreaterThanOrEqual(
        RETURN_TRAY.minZ - 0.001,
      );
      expect(b.z + BALL_RADIUS).toBeLessThanOrEqual(RETURN_TRAY.maxZ + 0.001);
    }
  } finally {
    engine.dispose();
  }
});

test.each([-1, 1])(
  "a full sphere crossing a side mouth is captured before bounds recovery: %i",
  (side) => {
    const engine = new PoolPhysics([ball(0, 0, 0)]);
    try {
      engine.restore([
        {
          ...engine.balls[0]!,
          x: side * (TABLE_BOUNDS.x - BALL_RADIUS + 0.0005),
          y: FELT_Y - BALL_RADIUS + 0.000001,
          vx: side,
          vy: -1,
          stage: "falling",
        },
      ]);
      const result = createShotResult();
      engine.step(0.00001, result);
      expect(result.potted).toEqual([0]);
      expect(engine.balls[0]!.stage).toBe("stored");
      expect(engine.recoveryCount).toBe(1);
      expect(engine.events.map((event) => event.type)).toEqual([
        "pocket",
        "recovery",
      ]);
      expect(engine.events[0]).toMatchObject({
        ballId: 0,
        reason: "below-pocket-mouth",
        stage: "falling",
        wasPocketed: false,
      });
      expect(engine.events[1]).toMatchObject({
        ballId: 0,
        reason: "outside-cabinet",
        stage: "return",
        wasPocketed: true,
        from: engine.lastRecovery!.from,
        to: engine.lastRecovery!.to,
      });
      const capture = engine.events[0]!;
      expect(capture.position[1] + BALL_RADIUS).toBeLessThan(FELT_Y);
      engine.step(1 / 60, result);
      expect(engine.events).toEqual([]);
      expect(capture.wasPocketed).toBe(false);
      expect(result.potted).toEqual([0]);
    } finally {
      engine.dispose();
    }
  },
);

test.each(["table", "falling"] as const)(
  "a fully below-bed ball away from a mouth is an anomaly, not a pot: %s",
  (stage) => {
    const engine = new PoolPhysics([ball(0, 0, 0.4)]);
    try {
      engine.restore([
        {
          ...engine.balls[0]!,
          y: FELT_Y - BALL_RADIUS - 0.01,
          vy: -0.1,
          stage,
        },
      ]);
      const result = createShotResult();
      engine.step(1 / 60, result);
      expect(result.potted).toEqual([]);
      expect(engine.balls[0]!.pocketed).toBe(false);
      expect(engine.balls[0]!.stage).toBe("table");
      expect(engine.events.map((event) => event.type)).toEqual([
        "below-bed",
        "recovery",
      ]);
      expect(engine.events[0]).toMatchObject({
        reason: "outside-pocket-mouth",
        stage,
        wasPocketed: false,
      });
      expect(engine.events[1]).toMatchObject({
        reason: "below-bed",
        wasPocketed: false,
      });
      expect(engine.events[0]!.position[1] + BALL_RADIUS).toBeLessThan(FELT_Y);
      expect(engine.events[0]!.velocity[1]).toBeLessThan(0);
      advance(engine, 2, result);
      expect(engine.recoveryCount).toBe(1);
      expect(engine.step(0, result)).toBe(false);
      expect(engine.events).toEqual([]);
    } finally {
      engine.dispose();
    }
  },
);

test("an escaped airborne ball remains unpocketed even after brushing a mouth", () => {
  const engine = new PoolPhysics([ball(0, 0, 0.4)]);
  try {
    engine.restore([
      {
        ...engine.balls[0]!,
        x: TABLE_BOUNDS.x + 0.01,
        y: FELT_Y + 0.2,
        vx: 1,
        vy: 0.1,
        stage: "falling",
      },
    ]);
    const result = createShotResult();
    engine.step(1 / 60, result);
    expect(result.potted).toEqual([]);
    expect(engine.balls[0]!.pocketed).toBe(false);
    expect(engine.events).toHaveLength(1);
    expect(engine.events[0]).toMatchObject({
      type: "recovery",
      reason: "outside-cabinet",
      wasPocketed: false,
    });
  } finally {
    engine.dispose();
  }
});

test("a snapshot already below a pocket has no evidence of a new downward capture", () => {
  const pocket = POCKETS[1]!;
  const engine = new PoolPhysics([ball(0, pocket.x, pocket.z)]);
  try {
    engine.restore([
      {
        ...engine.balls[0]!,
        y: FELT_Y - BALL_RADIUS - 0.01,
        vy: 0.1,
      },
    ]);
    const result = createShotResult();
    engine.step(1 / 60, result);
    expect(result.potted).toEqual([]);
    expect(engine.events[0]).toMatchObject({
      type: "below-bed",
      reason: "no-pocket-crossing",
    });
    expect(engine.events[1]).toMatchObject({
      type: "recovery",
      wasPocketed: false,
    });
    expect(engine.balls[0]!.stage).toBe("table");
  } finally {
    engine.dispose();
  }
});

test("a recovered unpocketed falling cue rolls and settles like a fresh cue", () => {
  const recovered = new PoolPhysics([ball(0, 0.13, 0.27)]);
  let fresh: PoolPhysics | undefined;
  try {
    recovered.restore([
      {
        ...recovered.balls[0]!,
        x: 5,
        y: FELT_Y + BALL_RADIUS - 0.012,
        stage: "falling",
      },
    ]);
    recovered.step(1 / 60, createShotResult());
    expect(recovered.recoveryCount).toBe(1);
    expect(recovered.balls[0]).toMatchObject({
      pocketed: false,
      stage: "table",
    });
    fresh = new PoolPhysics(structuredClone(recovered.balls));

    const shots = [recovered, fresh].map((engine) => {
      // Restoring or placing the recovered cue here would hide stale material.
      advance(engine, 1);
      const start = { x: engine.balls[0]!.x, z: engine.balls[0]!.z };
      engine.strike(Math.PI / 2, shotPower(0.45));
      const result = createShotResult();
      let settledAt = Infinity;
      for (let tick = 0; tick < 10 * 60; tick++) {
        const moving = engine.step(1 / 60, result);
        if (!moving && settledAt === Infinity) settledAt = (tick + 1) / 60;
        if (settledAt !== Infinity) expect(moving).toBe(false);
      }
      expect(result.potted).toEqual([]);
      expect(engine.step(0, result)).toBe(false);
      const end = engine.balls[0]!;
      return {
        distance: Math.hypot(end.x - start.x, end.z - start.z),
        settledAt,
      };
    });

    expect(shots[1]!.distance).toBeGreaterThan(0.05);
    expect(shots[1]!.distance).toBeLessThan(0.8);
    expect(shots[0]!.settledAt).toBeLessThan(5);
    expect(Math.abs(shots[0]!.distance - shots[1]!.distance)).toBeLessThan(
      0.001,
    );
    expect(Math.abs(shots[0]!.settledAt - shots[1]!.settledAt)).toBeLessThan(
      0.05,
    );
    expect(recovered.recoveryCount).toBe(1);
    expect(fresh.recoveryCount).toBe(0);
  } finally {
    recovered.dispose();
    fresh?.dispose();
  }
});
