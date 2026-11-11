import { describe, expect, test } from "bun:test";
import type { RecordedShot } from "@harrhy/pool/recording";
import { sampleShot, shotDuration } from "../../app/game/replay-playback";

const ball = (id: number, x: number, y: number) => ({
  id,
  x,
  y,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  pocketed: false,
  q: [0, 0, 0, 1] as [number, number, number, number],
  w: [0, 0, 0] as [number, number, number],
  stage: "table" as const,
  revision: 0,
});
const shot: RecordedShot = {
  id: "shot",
  gameId: "game",
  tableId: "table",
  startedAt: 0,
  build: { revision: "test", bun: "test", physics: "test" },
  command: { number: 1, seat: 0, bot: false, angle: 0, power: 1 },
  initial: [ball(0, 0, 1), ball(1, 2, 1)],
  frames: [
    {
      at: 100,
      dt: 100,
      tick: 1,
      balls: [ball(1, 4, 1), { ...ball(0, 2, 3), q: [0, 1, 0, 0] }],
    },
    { at: 200, dt: 100, tick: 2, balls: [ball(0, 4, 1), ball(1, 6, 1)] },
  ],
  events: [],
  flags: [],
  outcome: null,
  endReason: null,
  droppedFrames: 0,
};
describe("recorded playback", () => {
  test("interpolates hops and shortest quaternion rotation by ball ID without mutating the recording", () => {
    const snapshot = JSON.stringify(shot);
    const pose = sampleShot(shot, 50);
    expect(pose[0]!.x).toBe(1);
    expect(pose[0]!.y).toBe(2);
    expect(pose[1]!.x).toBe(3);
    expect(pose[0]!.q[1]).toBeCloseTo(Math.SQRT1_2);
    expect(pose[0]!.q[3]).toBeCloseTo(Math.SQRT1_2);
    expect(sampleShot(shot, 150)[0]!.y).toBe(1);
    expect(sampleShot(shot, 150).find((b) => b.id === 0)!.y).toBe(2);
    expect(JSON.stringify(shot)).toBe(snapshot);
  });
  test("uses exact recorded endpoints and holds the last frame without extrapolation", () => {
    expect(sampleShot(shot, -1)).toBe(shot.initial);
    expect(sampleShot(shot, 0)).toBe(shot.initial);
    expect(sampleShot(shot, 100)).toBe(shot.frames[0]!.balls);
    expect(sampleShot(shot, 900)).toBe(shot.frames[1]!.balls);
    expect(shotDuration(shot)).toBe(200);
    const empty = { ...shot, frames: [] };
    expect(sampleShot(empty, 100)).toBe(empty.initial);
    expect(shotDuration(empty)).toBe(0);
  });
  test("holds a teleporting ball until its revision boundary while other balls interpolate", () => {
    const teleport = {
      ...ball(0, 20, 8),
      revision: 1,
      q: [0, 1, 0, 0] as [number, number, number, number],
    };
    const recovery = {
      ...shot,
      frames: [{ ...shot.frames[0]!, balls: [ball(1, 4, 1), teleport] }],
    };
    for (const at of [1, 50, 99.999]) {
      const poses = sampleShot(recovery, at);
      expect(poses.find((b) => b.id === 0)).toBe(recovery.initial[0]);
      expect(poses.find((b) => b.id === 1)!.x).toBeCloseTo(2 + (2 * at) / 100);
    }
    expect(sampleShot(recovery, 100).find((b) => b.id === 0)).toBe(teleport);
    expect(sampleShot(recovery, 101).find((b) => b.id === 0)).toBe(teleport);
  });
  test("handles equivalent quaternion signs without spinning", () => {
    const equivalent = {
      ...shot,
      frames: [
        {
          ...shot.frames[0]!,
          balls: shot.initial.map((b) => ({
            ...b,
            q: [0, 0, 0, -1] as [number, number, number, number],
          })),
        },
      ],
    };
    expect(Math.abs(sampleShot(equivalent, 50)[0]!.q[3])).toBeCloseTo(1);
  });
});
