import { expect, test } from "vitest";
import { PoolPhysics } from "../src/engine";
import { BALL_RADIUS, createRack, createShotResult } from "../src/physics";
import { FELT_Y } from "../src/physical-table";

test.each([
  { offset: 0, dt: 1 / 60, warmup: 2 },
  { offset: 0.025, dt: 1 / 37, warmup: 0 },
  { offset: -0.025, dt: 1 / 60, warmup: 2 },
])(
  "a full break transfers energy through a separated rack: %j",
  ({ offset, dt, warmup }) => {
    const initial = createRack();
    const physics = new PoolPhysics(initial);
    try {
      const result = createShotResult();
      for (let t = 0; t < warmup; t += 1 / 60) physics.step(1 / 60, result);
      physics.strike(Math.PI / 2 + offset, 1);
      let separation = Infinity;
      let spread = 0;
      const rails = new Set<number>();
      for (let t = 0; t < 10; t += dt) {
        physics.step(dt, result);
        const balls = physics.balls.filter((b) => !b.pocketed);
        if (t < 1)
          for (let i = 0; i < balls.length; i++)
            for (let j = i + 1; j < balls.length; j++) {
              const a = balls[i]!,
                b = balls[j]!;
              separation = Math.min(
                separation,
                Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
              );
            }
        spread = Math.max(
          spread,
          physics.balls.filter(
            (b) =>
              b.id !== 0 &&
              Math.hypot(b.x - initial[b.id]!.x, b.z - initial[b.id]!.z) > 0.3,
          ).length,
        );
        for (const sound of physics.sounds)
          if (sound.kind === "cushion") rails.add(sound.ballId);
        expect(
          physics.events.some((e) => e.type === "recovery" && !e.wasPocketed),
        ).toBe(false);
      }
      expect(result.firstContact).toBe(1);
      expect(separation).toBeGreaterThan(BALL_RADIUS * 2 * 0.9);
      expect(spread).toBeGreaterThanOrEqual(8);
      expect(rails.size).toBeGreaterThanOrEqual(4);
      expect(physics.step(0, result)).toBe(false);
    } finally {
      physics.dispose();
    }
  },
);

test("cloth rolling deceleration is near 0.1 m/s² rather than 0.3 m/s²", () => {
  const physics = new PoolPhysics([
    {
      id: 0,
      x: -0.5,
      z: 0,
      y: FELT_Y + BALL_RADIUS,
      vx: 1,
      vy: 0,
      vz: 0,
      w: [0, 0, -1 / BALL_RADIUS],
      q: [0, 0, 0, 1],
      pocketed: false,
      stage: "table",
      revision: 0,
    },
  ]);
  try {
    const result = createShotResult();
    for (let i = 0; i < 24; i++) physics.step(1 / 240, result);
    const before = physics.balls[0]!.vx;
    for (let i = 0; i < 96; i++) physics.step(1 / 240, result);
    const deceleration = (before - physics.balls[0]!.vx) / 0.4;
    expect(deceleration).toBeGreaterThan(0.07);
    expect(deceleration).toBeLessThan(0.13);
  } finally {
    physics.dispose();
  }
});

test("equal-mass head-on impact transfers speed without creating energy", () => {
  const physics = new PoolPhysics([
    { id: 0, x: -0.3, z: 0, vx: 2, vz: 0, pocketed: false },
    { id: 1, x: 0, z: 0, vx: 0, vz: 0, pocketed: false },
  ]);
  try {
    const result = createShotResult();
    let incoming = 2;
    for (let i = 0; i < 120 && result.firstContact === null; i++) {
      incoming = physics.balls[0]!.vx;
      physics.step(1 / 240, result);
    }
    expect(result.firstContact).toBe(1);
    const [cue, target] = physics.balls;
    expect(target!.vx).toBeGreaterThan(incoming * 0.9);
    expect(Math.abs(cue!.vx)).toBeLessThan(incoming * 0.12);
    const energyRatio =
      physics.balls.reduce(
        (sum, b) => sum + b.vx ** 2 + b.vy ** 2 + b.vz ** 2,
        0,
      ) /
      incoming ** 2;
    expect(energyRatio).toBeGreaterThan(0.85);
    expect(energyRatio).toBeLessThan(1.03);
  } finally {
    physics.dispose();
  }
});
