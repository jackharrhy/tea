import { describe, expect, test } from "bun:test";
import { PresentationBuffer } from "../../web/src/presentation";
import {
  PHYSICS_HZ,
  NETWORK_FLAG_AWAKE,
  NETWORK_FLAG_HELD,
  RENDER_INTERPOLATION_MIN_TICKS,
  type NetworkBodyState,
  type NetworkPlayerState,
} from "@tea/gurgur-engine";
import {
  correctedPredictionPose,
  reconcilePredictionCorrection,
} from "../../web/src/prediction-correction";

const renderDelayMs = (RENDER_INTERPOLATION_MIN_TICKS / PHYSICS_HZ) * 1_000;

const state = (sequence: number, x: number): NetworkBodyState => ({
  kind: "body",
  id: { index: 1, generation: 1 },
  authorityVersion: 1,
  stateSequence: sequence,
  sourceTick: sequence * 2,
  position: { x, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  linearVelocity: { x: 1, y: 0, z: 0 },
  angularVelocity: { x: 0, y: 0, z: 0 },
  flags: 0,
});

const yaw = (angle: number) => ({
  x: 0,
  y: Math.sin(angle / 2),
  z: 0,
  w: Math.cos(angle / 2),
});

const playerState = (sequence: number, x: number): NetworkPlayerState => ({
  ...state(sequence, x),
  kind: "player",
  yaw: 0,
  verticalVelocity: 0,
  grounded: true,
  crouched: false,
  lastJumpCounter: 0,
  stepCooldown: 0,
});

describe("source-tick proxy presentation", () => {
  test("raises adaptive render delay on measured lateness without stepping its timeline backwards", () => {
    const presentation = new PresentationBuffer();
    expect(presentation.diagnostics().networkDelayTicks).toBe(4);
    presentation.updateClock(20, 1_000, 0);
    presentation.pushNetwork(
      [{ ...state(6, 6), sourceTick: 12, flags: 1 }],
      1_000,
    );
    presentation.pushNetwork(
      [{ ...state(10, 10), sourceTick: 20, flags: 1 }],
      1_000.1,
    );
    const before = presentation.sample(1_000)[0]!.position.x;
    presentation.sample(1_050);
    const diagnostics = presentation.diagnostics();
    const after = presentation.sample(1_051)[0]!.position.x;
    expect(diagnostics.desiredNetworkDelayTicks).toBe(8);
    expect(diagnostics.networkDelayTicks).toBeGreaterThan(4);
    expect(diagnostics.networkDelayTicks).toBeLessThanOrEqual(8);
    expect(after).toBeGreaterThanOrEqual(before);
  });

  test("adapts each authority track without making one late actor delay every host body", () => {
    const presentation = new PresentationBuffer();
    presentation.pushNetwork(
      [
        {
          ...state(4, 4),
          id: { index: 1, generation: 1 },
          sourceTick: 8,
          flags: 1,
        },
        {
          ...state(7, 7),
          id: { index: 2, generation: 1 },
          sourceTick: 15,
          flags: 1,
        },
      ],
      900,
    );
    presentation.updateClock(20, 1_000, 0);
    presentation.pushNetwork(
      [
        {
          ...state(6, 6),
          id: { index: 1, generation: 1 },
          sourceTick: 12,
          flags: 1,
        },
        {
          ...state(9, 9),
          id: { index: 2, generation: 1 },
          sourceTick: 19,
          flags: 1,
        },
      ],
      1_000,
    );
    presentation.sample(1_010);
    expect(
      presentation.trackDelayTicks({ index: 1, generation: 1 }),
    ).toBeGreaterThan(4);
    expect(presentation.trackDelayTicks({ index: 2, generation: 1 })).toBe(4);
  });

  test("buffers grounded walking players whose encoded velocities do not include horizontal movement", () => {
    const presentation = new PresentationBuffer();
    presentation.updateClock(0, 0, 0);
    const arrivals = Array.from({ length: 32 }, (_, sequence) => {
      const sourceAtMs = sequence * (1_000 / 30);
      const player: NetworkPlayerState = {
        ...state(sequence, sourceAtMs / 200),
        kind: "player",
        linearVelocity: { x: 0, y: 0, z: 0 },
        yaw: 0,
        verticalVelocity: 0,
        grounded: true,
        crouched: false,
        lastJumpCounter: 0,
        stepCooldown: 0,
      };
      return {
        atMs: sourceAtMs + 75 + [0, 20, -20, 10, -10][sequence % 5]!,
        state: player,
      };
    }).toSorted((left, right) => left.atMs - right.atMs);
    let previous: number | null = null;
    let eligible = 0;
    let advancing = 0;
    for (let frame = 0; frame <= 60; frame += 1) {
      const nowMs = frame * (1_000 / 60);
      while (arrivals.length > 0 && arrivals[0]!.atMs <= nowMs) {
        const arrival = arrivals.shift()!;
        presentation.pushNetwork([arrival.state], arrival.atMs);
      }
      const player = presentation.sample(nowMs)[0];
      if (!player || nowMs <= 180) continue;
      if (previous !== null) {
        eligible += 1;
        if (player.position.x - previous > 1e-5) advancing += 1;
      }
      previous = player.position.x;
    }
    expect(advancing).toBe(eligible);
    expect(presentation.trackDelayTicks(state(0, 0).id)).toBeGreaterThan(4);
  });

  test("turns 30 Hz state into continuous 60 and 120 Hz motion", () => {
    for (const displayHz of [60, 120]) {
      const presentation = new PresentationBuffer();
      presentation.updateClock(0, 0, 0);
      for (let sequence = 0; sequence <= 12; sequence += 1) {
        const time = sequence * (1_000 / 30);
        presentation.pushNetwork([state(sequence, time / 1_000)], time);
      }
      const values: number[] = [];
      for (let time = renderDelayMs; time <= 400; time += 1_000 / displayHz)
        values.push(presentation.sample(time)[0]!.position.x);
      const movingFrames = values
        .slice(1)
        .filter((value, index) => value > values[index]! + 1e-6).length;
      expect(movingFrames / (values.length - 1)).toBeGreaterThan(0.95);
    }
  });

  test("holds the newest sample rather than extrapolating and clears on authority change", () => {
    const presentation = new PresentationBuffer();
    presentation.pushNetwork([state(0, 0)], 0);
    presentation.pushNetwork([state(1, 1)], 33);
    expect(presentation.sample(10_000)[0]!.position.x).toBe(1);
    presentation.replaceReliable(state(0, 7), 100);
    expect(presentation.sample(100)[0]!.position.x).toBe(7);
  });

  test("fills a brief remote player packet gap and stops extrapolating after three ticks", () => {
    const presentation = new PresentationBuffer();
    presentation.updateClock(0, 0, 0);
    presentation.pushNetwork([playerState(0, 0)], 0);
    presentation.pushNetwork([playerState(1, 0.1)], 1_000 / 30);
    const at = (tick: number) =>
      presentation.sample((tick / PHYSICS_HZ) * 1_000)[0]!.position.x;
    expect(at(7)).toBeCloseTo(0.15);
    expect(at(8)).toBeCloseTo(0.2);
    expect(at(9)).toBeCloseTo(0.25);
    expect(at(10)).toBeCloseTo(0.25);
  });

  test("a late stop packet settles an extrapolated remote player without a frame snap", () => {
    const presentation = new PresentationBuffer();
    presentation.updateClock(0, 0, 0);
    presentation.pushNetwork([playerState(0, 0)], 0);
    presentation.pushNetwork(
      [{ ...playerState(1, 0.1), rotation: yaw(0.2) }],
      1_000 / 30,
    );
    const arrivalMs = (10 / PHYSICS_HZ) * 1_000;
    const before = presentation.sample(arrivalMs)[0]!;
    presentation.pushNetwork(
      [{ ...playerState(2, 0.1), sourceTick: 4, rotation: yaw(0.2) }],
      arrivalMs,
    );
    const after = presentation.sample(arrivalMs)[0]!;
    expect(after.position.x).toBeCloseTo(before.position.x);
    expect(after.rotation.y).toBeCloseTo(before.rotation.y);
    expect(presentation.sample(arrivalMs + 60)[0]!.position.x).toBeGreaterThan(
      0.1,
    );
    const settled = presentation.sample(arrivalMs + 130)[0]!;
    expect(settled.position.x).toBeCloseTo(0.1);
    expect(settled.rotation.y).toBeCloseTo(yaw(0.2).y);
  });

  test("remote players and held props use one playback delay while loose bodies stay independent", () => {
    const presentation = new PresentationBuffer();
    presentation.updateClock(20, 1_000, 0);
    presentation.pushNetwork(
      [
        { ...playerState(6, 6), sourceTick: 12 },
        {
          ...state(10, 10),
          id: { index: 2, generation: 1 },
          flags: NETWORK_FLAG_HELD,
        },
        {
          ...state(10, 10),
          id: { index: 3, generation: 1 },
          flags: NETWORK_FLAG_AWAKE,
        },
      ],
      1_000,
    );
    presentation.pushNetwork(
      [
        { ...playerState(7, 7), sourceTick: 14 },
        {
          ...state(11, 11),
          id: { index: 2, generation: 1 },
          flags: NETWORK_FLAG_HELD,
        },
        {
          ...state(11, 11),
          id: { index: 3, generation: 1 },
          flags: NETWORK_FLAG_AWAKE,
        },
      ],
      1_000.1,
    );
    presentation.sample(1_020);
    const playerDelay = presentation.trackDelayTicks({
      index: 1,
      generation: 1,
    })!;
    expect(playerDelay).toBeGreaterThan(4);
    expect(presentation.trackDelayTicks({ index: 2, generation: 1 })).toBe(
      playerDelay,
    );
    expect(presentation.trackDelayTicks({ index: 3, generation: 1 })).toBe(4);
  });

  test("keeps authoritative corrections beneath a local track and removes both together", () => {
    const presentation = new PresentationBuffer();
    presentation.pushNetwork([state(1, 3)], 10);
    presentation.pushLocal([state(2, 9)], 20);
    expect(presentation.sample(20)[0]!.position.x).toBe(9);
    expect(presentation.latestNetwork(state(1, 0).id)?.position.x).toBe(3);
    presentation.pushNetwork([state(3, 5)], 30);
    expect(presentation.sample(30)[0]!.position.x).toBe(9);
    expect(presentation.latestNetwork(state(1, 0).id)?.position.x).toBe(5);
    presentation.remove(state(1, 0).id);
    expect(presentation.latestNetwork(state(1, 0).id)).toBeNull();
    expect(presentation.latestLocal(state(1, 0).id)).toBeNull();
    expect(presentation.sample(40)).toEqual([]);
  });

  test("renders a reconciled local pose even when its sequence is unchanged", () => {
    const presentation = new PresentationBuffer();
    presentation.pushLocal([state(10, 10)], 100);
    presentation.pushLocal([state(10, 7)], 100, true);
    expect(presentation.sample(110)[0]!.position.x).toBe(7);
  });

  test("accepts a local replay timeline reset and immediately advances from it", () => {
    const presentation = new PresentationBuffer();
    presentation.pushLocal([state(10, 10)], 100);
    presentation.pushLocal([state(8, 7)], 100, true);
    expect(presentation.sample(110)[0]!.position.x).toBe(7);
    presentation.pushLocal([state(9, 8)], 120);
    expect(presentation.latestLocal(state(9, 0).id)!.position.x).toBe(8);
    expect(presentation.sample(140)[0]!.position.x).toBe(8);
  });

  test("keeps a release checkpoint newer than an independently delivered state cluster", () => {
    const presentation = new PresentationBuffer();
    presentation.replaceReliable(state(10, 10), 100);
    presentation.pushNetwork([state(9, 90)], 110);
    presentation.pushNetwork([{ ...state(11, 90), authorityVersion: 0 }], 120);
    presentation.pushNetwork([{ ...state(8, 90), sourceTick: 22 }], 130);
    expect(presentation.latestNetwork(state(0, 0).id)!.position.x).toBe(10);
    expect(presentation.sample(200)[0]!.position.x).toBe(10);
    presentation.pushNetwork([{ ...state(0, 20), authorityVersion: 2 }], 210);
    expect(presentation.latestNetwork(state(0, 0).id)!.position.x).toBe(20);
    expect(presentation.sample(210)[0]!.position.x).toBe(20);
  });

  test("samples source cadence instead of compressing a late packet burst", () => {
    const presentation = new PresentationBuffer();
    presentation.updateClock(0, 0, 0);
    presentation.pushNetwork([state(0, 0)], 0);
    presentation.pushNetwork([state(1, 1)], 33);
    presentation.pushNetwork([state(2, 2)], 100);
    presentation.pushNetwork([state(3, 3)], 100.1);

    const immediatelyBeforeBurst = presentation.sample(renderDelayMs + 49.9)[0]!
      .position.x;
    const immediatelyAfterBurst = presentation.sample(renderDelayMs + 50.1)[0]!
      .position.x;

    expect(immediatelyBeforeBurst).toBeCloseTo(1.497, 2);
    expect(immediatelyAfterBurst).toBeCloseTo(1.503, 2);
    expect(immediatelyAfterBurst - immediatelyBeforeBurst).toBeLessThan(0.01);
  });
});

describe("fixed-step predicted-body presentation", () => {
  const stepMs = 1_000 / 60;

  test("uses fixed production timestamps for batched updates at 60 and 120 Hz", () => {
    for (const displayHz of [60, 120]) {
      const presentation = new PresentationBuffer();
      presentation.pushLocal([state(0, 0)], 0);
      // The worker can deliver both completed steps in one main-thread turn.
      presentation.pushLocal([state(1, 0.1)], stepMs);
      presentation.pushLocal([state(2, 0.2)], 2 * stepMs);
      let nextTick = 3;
      for (let frame = 0; frame < 12; frame += 1) {
        const nowMs = 2.5 * stepMs + frame * (1_000 / displayHz);
        while (nextTick * stepMs <= nowMs) {
          presentation.pushLocal(
            [state(nextTick, nextTick * 0.1)],
            nextTick * stepMs,
          );
          nextTick += 1;
        }
        expect(presentation.sample(nowMs)[0]!.position.x).toBeCloseTo(
          (nowMs / stepMs - 1) * 0.1,
        );
      }
      expect(presentation.sample(10_000)[0]!.position.x).toBeCloseTo(
        (nextTick - 1) * 0.1,
      );
    }
  });

  test("local player and held prop share the immediate timeline while loose props interpolate", () => {
    const presentation = new PresentationBuffer();
    const player = (sequence: number): NetworkPlayerState => ({
      ...state(sequence, sequence),
      kind: "player",
      id: { index: 2, generation: 1 },
      yaw: 0,
      verticalVelocity: 0,
      grounded: true,
      crouched: false,
      lastJumpCounter: 0,
      stepCooldown: 0,
    });
    const held = (sequence: number) => ({
      ...state(sequence, sequence),
      id: { index: 3, generation: 1 },
      flags: NETWORK_FLAG_HELD,
    });
    presentation.pushLocal([state(0, 0), player(0), held(0)], 0);
    presentation.pushLocal([state(1, 1), player(1), held(1)], stepMs);
    const samples = presentation.sample(1.5 * stepMs);
    expect(
      samples.find((sample) => sample.id.index === 1)!.position.x,
    ).toBeCloseTo(0.5);
    expect(
      samples.find((sample) => sample.id.index === 2)!.position.x,
    ).toBeCloseTo(1.5);
    expect(
      samples.find((sample) => sample.id.index === 3)!.position.x,
    ).toBeCloseTo(1.5);
    expect(
      presentation.sample(10 * stepMs).find((sample) => sample.id.index === 2)!
        .position.x,
    ).toBe(2);
  });

  test("rebases both interpolation endpoints before applying a reconciliation offset", () => {
    const presentation = new PresentationBuffer();
    presentation.pushLocal([state(0, 0)], 0);
    presentation.pushLocal([{ ...state(1, 0.1), rotation: yaw(0.1) }], stepMs);
    const nowMs = 1.5 * stepMs;
    const before = presentation.sample(nowMs)[0]!;
    const previous = presentation.latestLocal(state(0, 0).id)!;
    const reconciled = { ...state(1, 1.1), rotation: yaw(0.5) };
    const correction = reconcilePredictionCorrection(
      previous,
      reconciled,
      null,
      nowMs,
      true,
    )!;
    presentation.pushLocal([reconciled], stepMs, true);
    const after = presentation.sample(nowMs)[0]!;
    expect(after.position.x).toBeCloseTo(1.05);
    const rendered = correctedPredictionPose(after, correction, nowMs);
    expect(rendered.position.x).toBeCloseTo(before.position.x);
    expect(rendered.rotation.y).toBeCloseTo(before.rotation.y);
    expect(rendered.rotation.w).toBeCloseTo(before.rotation.w);
    presentation.pushLocal(
      [{ ...state(2, 1.2), rotation: yaw(0.6) }],
      2 * stepMs,
    );
    expect(presentation.sample(2.5 * stepMs)[0]!.position.x).toBeCloseTo(1.15);
  });
});
