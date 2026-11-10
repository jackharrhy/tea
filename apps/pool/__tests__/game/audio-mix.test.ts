import { describe, expect, test } from "bun:test";
import type { PhysicalBall, PoolSound } from "@tea/pool";
import { FELT_Y, MESH_REST_OFFSET, FELT_LIP_DROP } from "@tea/pool/table";
import {
  AudioEventGate,
  consumeHeard,
  impactMix,
  isFeltLanding,
  rollingMix,
  spatialMix,
  type HeardSound,
  type SoundEvent,
} from "../../app/game/audio-mix";

const sound: PoolSound = {
  kind: "ball",
  ballId: 0,
  otherBallId: 3,
  x: 0,
  y: 0.8,
  z: 0,
  speed: 1,
};
const event = (id: number, time: number): SoundEvent => ({
  ...sound,
  id,
  time,
  turn: 4,
});
const context = { tableId: "1", rack: 2, turn: 4 };
const heard = (): HeardSound => ({
  ...context,
  sound,
  heardAt: 100,
  source: "predicted",
});

describe("server event baseline", () => {
  test("late join, repeated snapshots and stale simulation timestamps stay silent", () => {
    const gate = new AudioEventGate();
    gate.begin(1000, 50000);
    expect(gate.events("1", 2, [event(1, 980)], 1000)).toEqual([]);
    expect(gate.events("1", 2, [event(1, 980), event(2, 1005)], 1010)).toEqual([
      event(2, 1005),
    ]);
    expect(gate.events("1", 2, [event(2, 1005)], 1020)).toEqual([]);
    expect(gate.events("1", 2, [event(3, 1000)], 1300)).toEqual([]);
    expect(gate.events("1", 2, [event(4, 1400)], 1300)).toEqual([]);
  });

  test("reset, rack change and server clock reversal establish fresh baselines", () => {
    const gate = new AudioEventGate();
    gate.begin(1000, 1000);
    gate.events("1", 2, [], 1000);
    expect(gate.events("1", 2, [event(1, 1000)], 1000)).toHaveLength(1);
    expect(gate.events("1", 3, [event(1, 1000)], 1000)).toEqual([]);
    gate.heard.push(heard());
    gate.begin(20, 1100);
    expect(gate.heard).toHaveLength(0);
    expect(gate.events("1", 3, [event(2, 20)], 20)).toEqual([]);
    gate.reset();
    expect(gate.events("1", 3, [event(3, 30)], 30)).toEqual([]);
  });
});

describe("predicted occurrences", () => {
  test("one heard occurrence consumes one matching event even with reversed ball pair", () => {
    const entries = [heard()];
    expect(
      consumeHeard(
        entries,
        context,
        { ...sound, ballId: 3, otherBallId: 0 },
        600,
      ),
    ).toBe(true);
    expect(consumeHeard(entries, context, sound, 610)).toBe(false);
  });

  test("other epochs, unpredicted collisions and spatially different contacts remain audible", () => {
    const entries = [heard()];
    for (const changed of [{ tableId: "2" }, { rack: 3 }, { turn: 5 }])
      expect(
        consumeHeard(entries, { ...context, ...changed }, sound, 600),
      ).toBe(false);
    expect(
      consumeHeard(entries, context, { ...sound, otherBallId: 4 }, 600),
    ).toBe(false);
    expect(
      consumeHeard(entries, context, { ...sound, kind: "cushion" }, 600),
    ).toBe(false);
    expect(consumeHeard(entries, context, { ...sound, x: 1 }, 600)).toBe(false);
    expect(entries).toHaveLength(1);
    expect(consumeHeard(entries, context, sound, 3101)).toBe(false);
  });
});

test("impacts follow physical speed with quieter muffled cabinet events", () => {
  expect(impactMix({ ...sound, speed: 0 }).gain).toBe(0);
  expect(impactMix({ ...sound, speed: NaN }).gain).toBe(0);
  expect(impactMix({ ...sound, speed: 0.2 }).gain).toBeLessThan(
    impactMix(sound).gain,
  );
  expect(impactMix({ ...sound, speed: 1e9 }).gain).toBeLessThan(1);
  const cabinet = impactMix({ ...sound, kind: "return" });
  expect(cabinet.gain).toBeLessThan(impactMix(sound).gain);
  expect(cabinet.cutoff).toBeLessThan(impactMix(sound).cutoff);
});

test("pockets have a deeper body while return contacts stay subordinate", () => {
  const pocket = impactMix({ ...sound, kind: "pocket" });
  const cabinet = impactMix({ ...sound, kind: "return" });
  expect(pocket.rate).toBeLessThan(cabinet.rate);
  expect(pocket.cutoff).toBeLessThan(impactMix(sound).cutoff);
  expect(cabinet.gain).toBeLessThan(pocket.gain);
});

test("center dominates modest spatial cues with the same distance loss", () => {
  const near = spatialMix(1);
  const far = spatialMix(12);
  expect(near.dry).toBeGreaterThan(near.spatial);
  expect(near.spatial).toBeGreaterThan(0);
  expect(near.dry + near.spatial).toBeLessThanOrEqual(1);
  expect(far.dry).toBeLessThan(near.dry);
  expect(far.spatial).toBeLessThan(near.spatial);
  expect(far.dry / near.dry).toBeCloseTo(far.spatial / near.spatial);
  expect(spatialMix(0)).toEqual(near);
  expect(spatialMix(NaN)).toEqual({ dry: 0, spatial: 0 });
});

test("server-first contacts are consumed only by matching predictions in three dimensions", () => {
  const entries: HeardSound[] = [
    { ...heard(), source: "server", sound: { ...sound, y: 0.7 } },
    { ...heard(), source: "server", sound: { ...sound, y: 0.2 } },
  ];
  expect(
    consumeHeard(entries, context, { ...sound, y: 0.2 }, 200, "server"),
  ).toBe(true);
  expect(entries[0].sound.y).toBe(0.7);
  expect(
    consumeHeard(entries, context, { ...sound, y: 0.2 }, 210, "server"),
  ).toBe(false);
  expect(consumeHeard(entries, context, { ...sound, y: 0.7 }, 210)).toBe(false);
  expect(
    consumeHeard(entries, context, { ...sound, y: 0.7 }, 210, "server"),
  ).toBe(true);
});

test("slow frames retain heard contacts until delayed confirmations arrive", () => {
  const gate = new AudioEventGate();
  gate.heard.push(heard());
  gate.begin(1500, 1500);
  expect(consumeHeard(gate.heard, context, sound, 1500)).toBe(true);
  gate.heard.push(heard());
  gate.begin(3200, 3200);
  expect(gate.heard).toEqual([]);
});

test("only cushion contacts within the native cloth skin band are felt landings", () => {
  const landing: PoolSound = { ...sound, kind: "cushion", y: FELT_Y };
  for (const y of [FELT_Y, 0.77749, FELT_Y - MESH_REST_OFFSET - FELT_LIP_DROP])
    expect(isFeltLanding({ ...landing, y })).toBe(true);
  for (const y of [
    0.808,
    FELT_Y + MESH_REST_OFFSET + 0.001,
    FELT_Y - MESH_REST_OFFSET - FELT_LIP_DROP - 0.001,
    NaN,
    Infinity,
  ])
    expect(isFeltLanding({ ...landing, y })).toBe(false);
  for (const kind of ["ball", "cue", "pocket", "return"] as const)
    expect(isFeltLanding({ ...landing, kind })).toBe(false);
});

test("felt landings select a separate quiet thud without changing event identity", () => {
  const landing: PoolSound = { ...sound, kind: "cushion", y: FELT_Y };
  const original = { ...landing };
  const felt = impactMix(landing);
  const ball = impactMix({ ...landing, kind: "ball" });
  const rail = impactMix({ ...landing, y: 0.808 });
  expect(felt.sample).toBe("felt");
  expect(ball.sample).toBe("impact");
  expect(rail.sample).toBe("cushion");
  expect(felt.gain).toBeGreaterThan(0);
  expect(felt.gain).toBeLessThan(ball.gain);
  expect(felt.gain).toBeLessThan(rail.gain);
  expect(felt.cutoff).toBeLessThan(rail.cutoff);
  expect(felt.cutoff).toBeLessThan(ball.cutoff);
  expect(impactMix({ ...landing, speed: 0 }).gain).toBe(0);
  expect(impactMix({ ...landing, speed: NaN }).gain).toBe(0);
  expect(impactMix({ ...landing, speed: 0.2 }).gain).toBeLessThan(felt.gain);
  expect(landing).toEqual(original);
  const entries = [{ ...heard(), sound: landing }];
  expect(consumeHeard(entries, context, { ...landing, y: 0.77749 }, 200)).toBe(
    true,
  );
  expect(entries).toHaveLength(0);
});

test("slow ball contacts lose much more energy than hard collisions", () => {
  const slow = impactMix({ ...sound, speed: 0.25 }).gain;
  const medium = impactMix({ ...sound, speed: 1 }).gain;
  const hard = impactMix({ ...sound, speed: 4 }).gain;
  expect(slow).toBeGreaterThan(0);
  expect(medium / slow).toBeGreaterThan(1 / 0.25);
  expect(hard).toBeGreaterThan(medium);
  expect(impactMix({ ...sound, speed: 5 }).gain).toBeGreaterThanOrEqual(hard);
});

test("separate rolling beds follow velocity and stage with faint felt and stronger cabinet", () => {
  const ball: PhysicalBall = {
    id: 1,
    x: 0,
    y: FELT_Y,
    z: 0,
    vx: 1,
    vy: 0,
    vz: 0,
    q: [0, 0, 0, 1],
    w: [0, 0, 0],
    pocketed: false,
    stage: "table",
    revision: 0,
  };
  const felt = rollingMix(ball);
  const cabinet = rollingMix({ ...ball, stage: "return", pocketed: true });
  expect(felt.sample).toBe("felt");
  expect(cabinet.sample).toBe("cabinet");
  expect(felt.gain).toBeGreaterThan(0);
  expect(cabinet.gain).toBeGreaterThan(felt.gain);
  expect(rollingMix({ ...ball, vx: 0.2 }).gain).toBeLessThan(felt.gain);
  for (const stage of ["stored", "falling"] as const)
    expect(rollingMix({ ...ball, stage }).gain).toBe(0);
  expect(rollingMix({ ...ball, vx: 0 }).gain).toBe(0);
  expect(rollingMix({ ...ball, vx: NaN }).gain).toBe(0);
});

test("gentle cue strikes are duller and quieter than forceful strikes", () => {
  const soft = impactMix({ ...sound, kind: "cue", speed: 0.2 });
  const hard = impactMix({ ...sound, kind: "cue", speed: 4 });
  expect(soft.cutoff).toBeLessThan(hard.cutoff / 3);
  expect(soft.gain).toBeLessThan(hard.gain / 3);
});
