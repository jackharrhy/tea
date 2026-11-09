import { describe, expect, test } from "vitest";
import { parseRecording, type GameRecording } from "../src/recording";

function fixture(): GameRecording {
  const initial = [0, 1].map((id) => ({
    id,
    x: id,
    y: 0.8,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    q: [0, 0, 0, 1] as [number, number, number, number],
    w: [0, 0, 0] as [number, number, number],
    pocketed: false,
    stage: "table" as const,
    revision: 1,
  }));
  return {
    formatVersion: 1,
    game: { id: "game", tableId: "table", startedAt: 1000, finishedAt: 3000 },
    shots: [
      {
        id: "shot",
        gameId: "game",
        tableId: "table",
        startedAt: 1100,
        build: { revision: "build-id", bun: "1.4.4", physics: "pool-v2" },
        command: { number: 1, seat: 0, bot: false, angle: 0, power: 0.5 },
        initial,
        frames: [
          {
            at: 16,
            dt: 0.016,
            tick: 10,
            balls: structuredClone(initial).toReversed(),
          },
          { at: 32, dt: 0.016, tick: 11, balls: structuredClone(initial) },
        ],
        events: [
          {
            type: "recovery",
            at: 32,
            tick: 11,
            ballId: 0,
            reason: "bounds",
            from: [0, -2, 0],
            to: [0, 0.8, 0],
            report: {
              distance: 0.4,
              metrics: { correction: 0.2 },
              tags: ["client", null, true],
            },
          },
        ],
        flags: ["recovery"],
        outcome: {
          result: { firstContact: 1, potted: [1], railAfterContact: true },
          phase: "aiming",
          turn: 1,
          shotNumber: 1,
        },
        endReason: "settled",
        droppedFrames: 0,
        durationMs: 40,
      },
    ],
  };
}

function replace(input: unknown, path: string, value: unknown) {
  const keys = path.split(".");
  let target = input as Record<string, unknown>;
  for (const key of keys.slice(0, -1))
    target = target[key] as Record<string, unknown>;
  target[keys.at(-1)!] = value;
}

describe("recording import", () => {
  test.each(
    [
      null,
      undefined,
      [],
      1,
      "recording",
      {},
      { formatVersion: 1, game: null, shots: [] },
    ].map((value) => [value]),
  )("rejects malformed root %j", (value) => {
    expect(() => parseRecording(value)).toThrow();
  });

  test("round-trips metadata, reordered ball sets and wide diagnostic context", () => {
    const input = fixture();
    expect(parseRecording(JSON.parse(JSON.stringify(input)))).toEqual(input);
    const parsed = parseRecording(input);
    parsed.shots[0]!.initial[0]!.x = 9;
    expect(input.shots[0]!.initial[0]!.x).toBe(0);
  });

  test("supports legacy headers and bounded optional gravity without adding defaults", () => {
    const input = fixture();
    delete input.shots[0]!.durationMs;
    expect(parseRecording(input).shots[0]!.gravity).toBeUndefined();
    input.shots[0]!.gravity = [-15, -9.81, 15];
    expect(parseRecording(input).shots[0]!.gravity).toEqual([-15, -9.81, 15]);
    input.shots[0]!.frames = [];
    input.shots[0]!.outcome = null;
    input.shots[0]!.endReason = null;
    expect(() => parseRecording(input)).not.toThrow();
    input.shots = [];
    input.game.finishedAt = null;
    expect(() => parseRecording(input)).not.toThrow();
  });

  test("allows dropped-frame diagnostics beyond the captured timeline and appended events out of order", () => {
    const input = fixture();
    input.shots[0]!.droppedFrames = 4;
    input.shots[0]!.events.push({
      type: "client_correction",
      at: 8,
      tick: 50,
      report: { maxError: 0.2 },
    });
    input.shots[0]!.events.unshift({ type: "frame_limit", at: 40, tick: 12 });
    expect(parseRecording(input).shots[0]!.events).toEqual(
      input.shots[0]!.events,
    );
  });

  const invalid: [string, string, unknown][] = [
    ["unsupported version", "formatVersion", 2],
    ["missing game ID", "game.id", ""],
    ["invalid game timestamp", "game.startedAt", NaN],
    ["backward game finish", "game.finishedAt", 999],
    ["wrong game", "shots.0.gameId", "other"],
    ["wrong table", "shots.0.tableId", "other"],
    ["shot before game", "shots.0.startedAt", 900],
    ["shot after game", "shots.0.startedAt", 3001],
    ["missing build", "shots.0.build", undefined],
    ["invalid build revision", "shots.0.build.revision", 42],
    ["invalid build runtime", "shots.0.build.bun", null],
    ["missing physics version", "shots.0.build.physics", undefined],
    ["invalid command number", "shots.0.command.number", -1],
    ["invalid command seat", "shots.0.command.seat", 2],
    ["invalid bot boolean", "shots.0.command.bot", "false"],
    ["infinite angle", "shots.0.command.angle", Infinity],
    ["excess power", "shots.0.command.power", 1.01],
    ["negative power", "shots.0.command.power", -0.1],
    ["empty initial set", "shots.0.initial", []],
    ["fractional ball ID", "shots.0.initial.0.id", 0.5],
    ["out-of-range ball ID", "shots.0.initial.0.id", 16],
    ["duplicate initial ID", "shots.0.initial.1.id", 0],
    ["duplicate frame ID", "shots.0.frames.0.balls.0.id", 0],
    ["different frame set", "shots.0.frames.0.balls.0.id", 2],
    ["missing frame ball", "shots.0.frames.0.balls", []],
    ["invalid stage", "shots.0.frames.0.balls.0.stage", "airborne"],
    ["invalid pocketed boolean", "shots.0.initial.0.pocketed", 0],
    ["negative revision", "shots.0.initial.0.revision", -1],
    ["fractional revision", "shots.0.initial.0.revision", 0.5],
    ["nonfinite position", "shots.0.frames.0.balls.0.y", Infinity],
    ["nonfinite velocity", "shots.0.initial.0.vy", NaN],
    ["short quaternion", "shots.0.initial.0.q", [0, 1, 0]],
    ["zero quaternion", "shots.0.initial.0.q", [0, 0, 0, 0]],
    ["nonunit quaternion", "shots.0.initial.0.q", [0, 0, 0, 2]],
    ["nonfinite rotation", "shots.0.initial.0.q", [0, 0, Infinity, 1]],
    ["short angular velocity", "shots.0.initial.0.w", [0, 0]],
    ["nonfinite angular velocity", "shots.0.initial.0.w", [0, NaN, 0]],
    ["zero frame time", "shots.0.frames.0.at", 0],
    ["duplicate frame time", "shots.0.frames.1.at", 16],
    ["backward frame time", "shots.0.frames.1.at", 8],
    ["negative dt", "shots.0.frames.0.dt", -1],
    ["zero dt", "shots.0.frames.0.dt", 0],
    ["duplicate tick", "shots.0.frames.1.tick", 10],
    ["fractional tick", "shots.0.frames.0.tick", 0.5],
    ["invalid event type", "shots.0.events.0.type", null],
    ["negative event time", "shots.0.events.0.at", -1],
    ["nonfinite event time", "shots.0.events.0.at", Infinity],
    ["invalid event tick", "shots.0.events.0.tick", -1],
    ["invalid event ball", "shots.0.events.0.ballId", 16],
    ["absent event ball", "shots.0.events.0.ballId", 2],
    ["event after duration", "shots.0.events.0.at", 41],
    ["invalid flag", "shots.0.flags.0", {}],
    ["invalid end reason", "shots.0.endReason", {}],
    ["negative dropped frames", "shots.0.droppedFrames", -1],
    ["fractional dropped frames", "shots.0.droppedFrames", 0.1],
    ["short duration", "shots.0.durationMs", 30],
    ["invalid first contact", "shots.0.outcome.result.firstContact", 16],
    ["duplicate potted balls", "shots.0.outcome.result.potted", [1, 1]],
    ["invalid rail boolean", "shots.0.outcome.result.railAfterContact", 1],
    ["invalid phase", "shots.0.outcome.phase", "unknown"],
    ["invalid outcome turn", "shots.0.outcome.turn", 2],
    ["invalid outcome number", "shots.0.outcome.shotNumber", -1],
    ["short gravity", "shots.0.gravity", [0, -9.81]],
    ["oversized gravity", "shots.0.gravity", [0, -9.81, 0, 0]],
    ["out-of-range gravity", "shots.0.gravity", [0, -15.1, 0]],
    ["infinite gravity", "shots.0.gravity", [0, Infinity, 0]],
    ["NaN gravity", "shots.0.gravity", [NaN, 0, 0]],
  ];
  test.each(invalid)("rejects %s", (_name, path, value) => {
    const input = fixture();
    replace(input, path, value);
    expect(() => parseRecording(input)).toThrow();
  });

  test("rejects duplicate shot IDs and bounded collection overflows", () => {
    const input = fixture();
    input.shots.push(structuredClone(input.shots[0]!));
    expect(() => parseRecording(input)).toThrow();
    for (const [path, values] of [
      ["shots", Array(201).fill(fixture().shots[0])],
      ["shots.0.frames", Array(7501).fill(fixture().shots[0]!.frames[0])],
      ["shots.0.events", Array(7501).fill(fixture().shots[0]!.events[0])],
    ] as const) {
      const oversized = fixture();
      replace(oversized, path, values);
      expect(() => parseRecording(oversized)).toThrow();
    }
  });
});
