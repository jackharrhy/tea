import { expect, test } from "vitest";
import { PoolPhysics } from "../src/engine";
import {
  createRack,
  shotPower,
  createShotResult,
  BALL_RADIUS,
  TABLE_HALF_WIDTH,
  TABLE_HALF_LENGTH,
} from "../src/physics";
import type { Ball, PhysicalBall } from "../src/physics";
import {
  FELT_Y,
  POCKETS,
  TABLE_BOUNDS,
  isInReturnTray,
  TRAY_FLOOR_Y,
  RETURNS,
  FELT_LIP_WIDTH,
  FELT_LIP_DROP,
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

test("rack rests, a real break registers contact and rails, then settles", () => {
  const engine = new PoolPhysics(createRack());
  try {
    const result = advance(engine, 2);
    expect(engine.step(0, result)).toBe(false);
    expect(
      engine.balls.every((b) => Math.abs(b.y - (FELT_Y + BALL_RADIUS)) < 0.005),
    ).toBe(true);
    engine.strike(Math.PI / 2, 1);
    advance(engine, 15, result);
    expect(result.firstContact).toBe(1);
    expect(result.railAfterContact).toBe(true);
    expect(engine.step(0, result)).toBe(false);
  } finally {
    engine.dispose();
  }
});

test("fast opposing spheres collide without passing through each other", () => {
  const engine = new PoolPhysics([
    ball(0, -0.3, 0.5, 8),
    ball(1, 0.3, 0.5, -8),
  ]);
  try {
    const result = advance(engine, 0.1);
    expect(result.firstContact).toBe(1);
    expect(engine.balls[0]!.vx).toBeLessThan(0);
    expect(engine.balls[1]!.vx).toBeGreaterThan(0);
  } finally {
    engine.dispose();
  }
});

test("all six holes drop balls once, returns stay contained and do not hold the turn", () => {
  const engine = new PoolPhysics(POCKETS.map((p, i) => ball(i, p.x, p.z)));
  try {
    const result = createShotResult();
    expect(engine.step(1 / 120, result)).toBe(true);
    expect(result.potted).toEqual([]);
    advance(engine, 1, result);
    expect(result.potted.toSorted((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(engine.balls.every((b) => b.y < FELT_Y)).toBe(true);
    expect(engine.step(0, result)).toBe(false);
    expect(result.firstContact).toBeNull();
    advance(engine, 25, result);
    expect(result.potted.length).toBe(6);
    expect(engine.recoveryCount).toBe(0);
    for (const b of engine.balls) {
      expect(b.y).toBeGreaterThan(0);
      expect(b.y).toBeLessThan(FELT_Y);
      expect(Math.abs(b.x)).toBeLessThan(TABLE_BOUNDS.x);
      expect(isInReturnTray(b.x, b.y, b.z)).toBe(true);
      expect(b.z).toBeGreaterThan(-TABLE_BOUNDS.z);
      expect(b.stage).toBe("stored");
    }
  } finally {
    engine.dispose();
  }
});

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

test("curved pocket shoulders support balls where the former square cutouts removed felt", () => {
  const engine = new PoolPhysics([
    ball(0, TABLE_HALF_WIDTH - BALL_RADIUS, 0.09),
    ball(1, -TABLE_HALF_WIDTH + BALL_RADIUS, -0.09),
    ball(2, TABLE_HALF_WIDTH - 0.1, TABLE_HALF_LENGTH - 0.1),
    ball(3, -TABLE_HALF_WIDTH + 0.1, -TABLE_HALF_LENGTH + 0.1),
  ]);
  try {
    const result = advance(engine, 2);
    expect(result.potted).toEqual([]);
    expect(engine.recoveryCount).toBe(0);
    for (const b of engine.balls) {
      expect(b.stage).toBe("table");
      expect(b.y).toBeCloseTo(FELT_Y + BALL_RADIUS, 2);
    }
  } finally {
    engine.dispose();
  }
});

test("maximum-power legal center shots remain physically contained and settle", () => {
  for (let direction = 0; direction < 24; direction++) {
    const engine = new PoolPhysics([ball(0, 0, 0)]);
    try {
      expect(engine.placeCue(0, 0)).toBe(true);
      const revision = engine.balls[0]!.revision;
      engine.strike((direction * Math.PI) / 12, 1);
      expect(Math.hypot(engine.balls[0]!.vx, engine.balls[0]!.vz)).toBeCloseTo(
        7.5,
        5,
      );
      const result = createShotResult();
      let bounded = true;
      for (let step = 0; step < 1800; step++) {
        engine.step(1 / 120, result);
        bounded &&= contained(engine.balls[0]!);
      }
      expect({
        direction,
        bounded,
        recoveries: engine.recoveryCount,
        active: engine.step(0, result),
      }).toEqual({ direction, bounded: true, recoveries: 0, active: false });
      expect(engine.balls[0]!.revision).toBe(revision);
      expect(engine.balls[0]!.stage).not.toBe("falling");
    } finally {
      engine.dispose();
    }
  }
});

test.each(
  POCKETS.flatMap((pocket) =>
    [3, 5].flatMap((speed) =>
      [-0.025, 0, 0.025].map((offset) => ({ pocket, speed, offset })),
    ),
  ),
)(
  "mouth approach captures clear centers and contains glances: %j",
  ({ pocket, speed, offset }) => {
    const angle = Math.atan2(Math.sign(pocket.z), Math.sign(pocket.x));
    const engine = new PoolPhysics([ball(0, 0, 0)]);
    try {
      expect(
        engine.placeCue(
          pocket.x - 0.25 * Math.cos(angle) - offset * Math.sin(angle),
          pocket.z - 0.25 * Math.sin(angle) + offset * Math.cos(angle),
        ),
      ).toBe(true);
      const revision = engine.balls[0]!.revision;
      engine.strike(angle, shotPower(speed));
      const result = createShotResult();
      let bounded = true;
      let maxReturnY = 0;
      for (let step = 0; step < 2400; step++) {
        engine.step(1 / 120, result);
        const b = engine.balls[0]!;
        bounded &&= contained(b);
        if (b.pocketed) maxReturnY = Math.max(maxReturnY, b.y);
      }
      const label = { speed, offset, pocket };
      expect({
        ...label,
        bounded,
        recoveries: engine.recoveryCount,
        active: engine.step(0, result),
      }).toEqual({ ...label, bounded: true, recoveries: 0, active: false });
      if (offset === 0) expect(result.potted).toEqual([0]);
      expect(maxReturnY).toBeLessThan(FELT_Y);
      expect(engine.balls[0]!.revision).toBe(revision);
      expect(engine.balls[0]!.stage).not.toBe("falling");
      if (engine.balls[0]!.pocketed) {
        expect(result.potted).toEqual([0]);
        expect(engine.balls[0]!.stage).toBe("stored");
      } else {
        expect(engine.balls[0]!.y).toBeGreaterThan(FELT_Y);
        expect(engine.balls[0]!.stage).toBe("table");
      }
    } finally {
      engine.dispose();
    }
  },
);

test("a restored jaw-rebound snapshot returns to table without changing its revision", () => {
  const engine = new PoolPhysics([ball(0, 0, 0)]);
  try {
    const revision = engine.balls[0]!.revision;
    engine.restore([
      {
        ...engine.balls[0]!,
        x: TABLE_HALF_WIDTH + 0.015,
        z: 0.02,
        y: FELT_Y + BALL_RADIUS - 0.012,
        vx: -0.6,
        vy: 0.8,
        stage: "falling",
      },
    ]);
    const result = createShotResult();
    let fell = engine.balls[0]!.stage === "falling";
    let recoveredToTable = false;
    for (let step = 0; step < 2400; step++) {
      engine.step(1 / 120, result);
      const b = engine.balls[0]!;
      if (fell && !b.pocketed && b.stage === "table") recoveredToTable = true;
      fell ||= b.stage === "falling";
    }
    expect(fell).toBe(true);
    expect(recoveredToTable).toBe(true);
    expect(engine.balls[0]!.revision).toBe(revision);
    expect(engine.step(0, result)).toBe(false);
    expect(engine.recoveryCount).toBe(0);
  } finally {
    engine.dispose();
  }
});

test("captured balls cannot rebound into live balls", () => {
  const angle = (-20 * Math.PI) / 180;
  const pocket = POCKETS.find((p) => p.x > 0 && p.z === 0)!;
  const engine = new PoolPhysics([
    ball(0, pocket.x - 0.25 * Math.cos(angle), -0.25 * Math.sin(angle)),
    ball(1, TABLE_HALF_WIDTH - BALL_RADIUS - 0.01, 0.35),
  ]);
  try {
    engine.strike(angle, 1);
    const result = createShotResult();
    let peakLiveSpeed = 0;
    for (let step = 0; step < 2880; step++) {
      engine.step(1 / 480, result);
      if (engine.balls[0]!.pocketed)
        peakLiveSpeed = Math.max(
          peakLiveSpeed,
          Math.hypot(engine.balls[1]!.vx, engine.balls[1]!.vz),
        );
    }
    expect(result.potted).toContain(0);
    expect(peakLiveSpeed).toBeLessThan(0.001);
    expect(engine.recoveryCount).toBe(0);
  } finally {
    engine.dispose();
  }
});

test.each(
  [0.6, 0.7].flatMap((x) => [-0.22, 0.22].map((distance) => ({ x, distance }))),
)(
  "tray front lip retains a stored ball rolling toward a side opening: %j",
  ({ x, distance }) => {
    const initial: PhysicalBall = {
      ...ball(0, x, distance, 0, Math.sign(distance) * 0.4),
      y: TRAY_FLOOR_Y + BALL_RADIUS,
      vy: 0,
      q: [0, 0, 0, 1],
      w: [(Math.sign(distance) * 0.4) / BALL_RADIUS, 0, 0],
      pocketed: true,
      stage: "stored",
      revision: 1,
    };
    const engine = new PoolPhysics([initial]);
    try {
      const result = createShotResult();
      for (let tick = 0; tick < 20 * 120; tick++) {
        engine.step(1 / 120, result);
        const b = engine.balls[0]!;
        expect(b.stage).toBe("stored");
        expect(isInReturnTray(b.x, b.y, b.z)).toBe(true);
        expect(b.y).toBeGreaterThan(TRAY_FLOOR_Y);
        expect(contained(b)).toBe(true);
      }
      expect(engine.recoveryCount).toBe(0);
      expect(engine.balls[0]!.revision).toBe(initial.revision);
      expect(result.potted).toEqual([]);
    } finally {
      engine.dispose();
    }
  },
);

test("cue replacement validates felt and separation, resets motion and increments revision", () => {
  const engine = new PoolPhysics([ball(0, POCKETS[1]!.x, 0), ball(1, 0, 0)]);
  try {
    advance(engine, 1);
    const revision = engine.balls[0]!.revision;
    expect(engine.placeCue(POCKETS[1]!.x, 0)).toBe(false);
    expect(engine.placeCue(0, 0)).toBe(false);
    expect(engine.placeCue(0, -1)).toBe(true);
    expect(engine.balls[0]).toMatchObject({
      pocketed: false,
      stage: "table",
      vx: 0,
      vy: 0,
      vz: 0,
    });
    expect(engine.balls[0]!.revision).toBeGreaterThan(revision);
    engine.reset([ball(0, 0, -1)]);
    expect(engine.balls).toHaveLength(1);
  } finally {
    engine.dispose();
  }
  engine.dispose();
  expect(() => engine.step(0, createShotResult())).toThrow("disposed");
});

test("physical snapshots preserve height, pocket position, velocity and full sphere rotation", () => {
  const source = new PoolPhysics([ball(0, 0, 0), ball(1, POCKETS[1]!.x, 0)]);
  let restored: PoolPhysics | undefined;
  try {
    source.strike(0.3, 0.5);
    advance(source, 0.2);
    const snapshot = structuredClone(source.balls);
    snapshot[1]!.pocketed = true;
    snapshot[1]!.stage = "return";
    restored = new PoolPhysics(snapshot);
    expect(restored.balls).toEqual(snapshot);
    advance(restored, 0.1);
    restored.restore(snapshot);
    expect(restored.balls).toEqual(snapshot);
    restored.step(0, createShotResult());
    expect(restored.balls[0]!.q).toEqual(snapshot[0]!.q);
  } finally {
    source.dispose();
    restored?.dispose();
  }
});

test("rolling snapshots restore actual spin and preserve subsequent motion", () => {
  const source = new PoolPhysics([ball(0, -0.35, 0.25)]);
  const restored = new PoolPhysics([ball(0, 0.35, -0.25)]);
  let reset: PoolPhysics | undefined;
  try {
    source.strike(0.25, shotPower(0.96));
    advance(source, 0.5);
    const snapshot = structuredClone(source.balls);
    const saved = structuredClone(snapshot);
    expect(snapshot[0]!.w[2]).toBeLessThan(-5);
    expect(snapshot[0]!.w[0]).toBeGreaterThan(1);
    restored.restore(snapshot);
    reset = new PoolPhysics(snapshot);
    expect(restored.balls[0]!.w).toEqual(snapshot[0]!.w);
    expect(reset.balls[0]!.w).toEqual(snapshot[0]!.w);
    for (let tick = 0; tick < 30; tick++) {
      for (const engine of [source, restored, reset])
        engine.step(1 / 60, createShotResult());
      for (const engine of [restored, reset]) {
        const a = engine.balls[0]!,
          b = source.balls[0]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(0.003);
        expect(Math.hypot(a.vx - b.vx, a.vz - b.vz)).toBeLessThan(0.002);
        expect(Math.abs(a.vy - b.vy)).toBeLessThan(0.05);
        expect(Math.hypot(...a.w.map((w, i) => w - b.w[i]!))).toBeLessThan(0.2);
      }
    }
    expect(snapshot).toEqual(saved);
  } finally {
    source.dispose();
    restored.dispose();
    reset?.dispose();
  }
});

for (const pocket of POCKETS) {
  test(`slow lip ball falls while adjacent flat bed stays stable: ${pocket.x}, ${pocket.z}`, () => {
    const angle = Math.atan2(Math.sign(pocket.z), Math.sign(pocket.x));
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    const edgeDistance = pocket.radius + FELT_LIP_WIDTH * 0.35;
    const bedDistance = pocket.radius + FELT_LIP_WIDTH + BALL_RADIUS;
    const edge = new PoolPhysics([
      ball(
        0,
        pocket.x - edgeDistance * nx,
        pocket.z - edgeDistance * nz,
        0.015 * nx,
        0.015 * nz,
      ),
    ]);
    const bed = new PoolPhysics([
      ball(0, pocket.x - bedDistance * nx, pocket.z - bedDistance * nz),
    ]);
    try {
      edge.restore([
        {
          ...edge.balls[0]!,
          w: [(0.015 * nz) / BALL_RADIUS, 0, (-0.015 * nx) / BALL_RADIUS],
        },
      ]);
      const result = createShotResult();
      const bedResult = createShotResult();
      const start = { ...bed.balls[0]! };
      const revision = edge.balls[0]!.revision;
      let supportedLipSeen = false;
      let settledBeforeCapture = false;
      for (let tick = 0; tick < 600; tick++) {
        const moving = edge.step(1 / 60, result);
        bed.step(1 / 60, bedResult);
        const b = edge.balls[0]!;
        settledBeforeCapture ||= !b.pocketed && !moving;
        supportedLipSeen ||=
          !b.pocketed && b.y < FELT_Y + BALL_RADIUS - FELT_LIP_DROP / 4;
        expect(contained(b)).toBe(true);
      }
      expect(bedResult.potted).toEqual([]);
      expect(bed.balls[0]!.stage).toBe("table");
      expect(
        Math.hypot(bed.balls[0]!.x - start.x, bed.balls[0]!.z - start.z),
      ).toBeLessThan(0.001);
      expect(Math.abs(bed.balls[0]!.y - FELT_Y - BALL_RADIUS)).toBeLessThan(
        0.001,
      );
      expect(bed.step(0, bedResult)).toBe(false);
      expect(bed.recoveryCount).toBe(0);
      expect(settledBeforeCapture).toBe(false);
      expect(supportedLipSeen).toBe(true);
      expect(result.potted).toEqual([0]);
      expect(edge.step(0, result)).toBe(false);
      expect(edge.recoveryCount).toBe(0);
      expect(edge.balls[0]!.revision).toBe(revision);
    } finally {
      edge.dispose();
      bed.dispose();
    }
  });
}

test("all sixteen returns fit the collector after entering through the six wells", () => {
  const engine = new PoolPhysics(createRack());
  const result = createShotResult();
  try {
    for (let id = 0; id < 16; id++) {
      const snapshot = structuredClone(engine.balls);
      const b = snapshot.find((ballItem) => ballItem.id === id)!;
      const p = POCKETS[id % POCKETS.length]!;
      Object.assign(b, {
        x: p.x,
        z: p.z,
        y: FELT_Y + BALL_RADIUS,
        vx: 0,
        vy: 0,
        vz: 0,
        w: [0, 0, 0],
      });
      engine.restore(snapshot);
      for (let tick = 0; tick < 600; tick++) {
        engine.step(1 / 120, result);
        expect(engine.balls.every(contained)).toBe(true);
      }
    }
    advance(engine, 20, result);
    expect(result.potted).toHaveLength(16);
    expect(engine.recoveryCount).toBe(0);
    for (const b of engine.balls) {
      expect(b.stage).toBe("stored");
      expect(isInReturnTray(b.x, b.y, b.z)).toBe(true);
      expect(Math.abs(b.y - TRAY_FLOOR_Y - BALL_RADIUS)).toBeLessThan(0.001);
    }
  } finally {
    engine.dispose();
  }
});

test.each([-12, 12])(
  "a warmed full-power break at %i keyboard steps cannot launch off the corner shoulder",
  (steps) => {
    const engine = new PoolPhysics(createRack());
    try {
      const result = createShotResult();
      for (let tick = 0; tick < 120; tick++) engine.step(1 / 60, result);
      const revision = engine.balls[0]!.revision;
      engine.strike(Math.PI / 2 + steps * 0.025, 1);
      for (let tick = 0; tick < 1200; tick++) {
        engine.step(1 / 60, result);
        expect(engine.balls.every(contained)).toBe(true);
      }
      expect(engine.recoveryCount).toBe(0);
      expect(engine.balls[0]!.revision).toBe(revision);
      expect(result.potted).toContain(0);
      expect(engine.balls[0]!.stage).toBe("stored");
      expect(engine.step(0, result)).toBe(false);
    } finally {
      engine.dispose();
    }
  },
);

test("collector-side middle boot sends the ball inward before the screened final return", () => {
  const pocket = POCKETS.find((p) => p.x > 0 && p.z === 0)!;
  const engine = new PoolPhysics([ball(0, pocket.x, pocket.z)]);
  try {
    const revision = engine.balls[0]!.revision;
    const result = createShotResult();
    let landed = false;
    let inward = false;
    let enteredCollector = false;
    for (let tick = 0; tick < 25 * 120; tick++) {
      engine.step(1 / 120, result);
      const b = engine.balls[0]!;
      landed ||= b.y > 0.59 && b.y < 0.64 && Math.abs(b.vy) < 0.05;
      inward ||= b.x < pocket.x - 0.15 && b.y > 0.5;
      if (b.stage === "stored") {
        expect(landed).toBe(true);
        expect(inward).toBe(true);
        enteredCollector = true;
      }
      expect(contained(b)).toBe(true);
    }
    expect(enteredCollector).toBe(true);
    expect(engine.recoveryCount).toBe(0);
    expect(engine.balls[0]!.revision).toBe(revision);
    expect(result.potted).toEqual([0]);
  } finally {
    engine.dispose();
  }
});

test("six simultaneous pocket clusters deliver all sixteen balls by gravity", () => {
  const engine = new PoolPhysics(createRack());
  try {
    const snapshot = structuredClone(engine.balls);
    for (const [i, b] of snapshot.entries()) {
      const p = POCKETS[i % POCKETS.length]!;
      Object.assign(b, {
        x: p.x,
        z: p.z,
        y: FELT_Y + BALL_RADIUS + Math.floor(i / POCKETS.length) * 0.06,
        vx: 0,
        vy: 0,
        vz: 0,
        w: [0, 0, 0],
      });
    }
    engine.restore(snapshot);
    const result = createShotResult();
    for (let tick = 0; tick < 30 * 120; tick++) {
      engine.step(1 / 120, result);
      for (const b of engine.balls) {
        if (b.pocketed) expect(contained(b)).toBe(true);
        expect(b.revision).toBe(snapshot.find((s) => s.id === b.id)!.revision);
      }
    }
    expect(result.potted).toHaveLength(16);
    expect(engine.recoveryCount).toBe(0);
    expect(engine.balls.every((b) => b.stage === "stored")).toBe(true);
  } finally {
    engine.dispose();
  }
});

test.each(
  POCKETS.flatMap((pocket) =>
    [1 / 60, 1 / 37].flatMap((dt) =>
      [0, 2].map((warmup) => ({ pocket, dt, warmup })),
    ),
  ),
)(
  "full-power mouth capture survives frame timing and warmup: %j",
  ({ pocket, dt, warmup }) => {
    const angle = Math.atan2(Math.sign(pocket.z), Math.sign(pocket.x));
    const engine = new PoolPhysics([
      ball(
        0,
        pocket.x - 0.25 * Math.cos(angle),
        pocket.z - 0.25 * Math.sin(angle),
      ),
    ]);
    try {
      advance(engine, warmup);
      const revision = engine.balls[0]!.revision;
      engine.strike(angle, 1);
      expect(Math.hypot(engine.balls[0]!.vx, engine.balls[0]!.vz)).toBeCloseTo(
        7.5,
        5,
      );
      const result = createShotResult();
      let captures = 0;
      for (let time = 0; time < 8; time += dt) {
        engine.step(dt, result);
        for (const event of engine.events) {
          expect(event.type).toBe("pocket");
          expect(event.reason).toBe("below-pocket-mouth");
          expect(event.position[1] + BALL_RADIUS).toBeLessThan(FELT_Y);
          captures++;
        }
        if (engine.balls[0]!.pocketed)
          expect(engine.balls[0]!.y).toBeLessThan(FELT_Y);
      }
      expect(captures).toBe(1);
      expect(result.potted).toEqual([0]);
      expect(engine.recoveryCount).toBe(0);
      expect(engine.balls[0]!.revision).toBe(revision);
      expect(engine.step(0, result)).toBe(false);
    } finally {
      engine.dispose();
    }
  },
);
