import { expect, test } from "vitest";
import {
  MAX_CLIENT_MESSAGE_LENGTH,
  PROTOCOL_VERSION,
  parseClientMessage,
} from "../src/index";

test("rejects malformed, oversized, incompatible and unsafe command values", () => {
  const invalid = [
    "{",
    "null",
    "[]",
    "1",
    '{"type":"move","seq":1,"x":1e999,"z":0}',
    JSON.stringify({ type: "hello", version: 1, name: "Guest" }),
    JSON.stringify({
      type: "hello",
      version: PROTOCOL_VERSION - 1,
      name: "Guest",
    }),
    JSON.stringify({ type: "move", seq: 2 ** 53, x: 0, z: 0 }),
    JSON.stringify({ type: "move", seq: 1, x: 1.01, z: 0 }),
    JSON.stringify({
      type: "shot",
      id: "x",
      table: "1",
      turn: -1,
      angle: 0,
      power: 1,
    }),
    JSON.stringify({
      type: "shot",
      id: "x",
      table: "1",
      turn: 0,
      angle: 0,
      power: 0,
    }),
    JSON.stringify({ type: "place", table: "1", turn: -1, x: 0, z: 0 }),
    JSON.stringify({ type: "rematch", table: "1" }),
    JSON.stringify({ type: "rematch", table: "1", turn: -1 }),
    JSON.stringify({ type: "rematch", table: "", turn: 0 }),
    JSON.stringify({ type: "sit", seat: "" }),
    JSON.stringify({ type: "sit", seat: 1 }),
    JSON.stringify({ type: "sit", seat: "x".repeat(33) }),
    JSON.stringify({ type: "chat", text: "x".repeat(161) }),
    JSON.stringify({
      type: "leave",
      extra: "x".repeat(MAX_CLIENT_MESSAGE_LENGTH),
    }),
  ];
  for (const raw of invalid) expect(parseClientMessage(raw)).toBeNull();
  expect(
    parseClientMessage(
      JSON.stringify({
        type: "hello",
        version: PROTOCOL_VERSION,
        name: "Guest",
      }),
    ),
  ).toMatchObject({ type: "hello" });
});

test("validates bounded, ordered fixed-step batches and strips unrelated fields", () => {
  expect(
    parseClientMessage(
      JSON.stringify({
        type: "move",
        inputs: [
          { seq: 1, x: 0.5, z: -1, extra: "ignored" },
          { seq: 2, x: 0, z: 0 },
        ],
      }),
    ),
  ).toEqual({
    type: "move",
    inputs: [
      { seq: 1, x: 0.5, z: -1 },
      { seq: 2, x: 0, z: 0 },
    ],
  });
  for (const inputs of [
    [],
    Array.from({ length: 7 }, (_, seq) => ({ seq, x: 0, z: 0 })),
    [
      { seq: 1, x: 0, z: 0 },
      { seq: 1, x: 0, z: 0 },
    ],
    [
      { seq: 2, x: 0, z: 0 },
      { seq: 1, x: 0, z: 0 },
    ],
    [{ seq: 1, x: 2, z: 0 }],
    [{ seq: 1, x: 0, z: null }],
  ])
    expect(
      parseClientMessage(JSON.stringify({ type: "move", inputs })),
    ).toBeNull();
});

test("hello accepts RGB colours and rejects values outside the 24-bit range", () => {
  const hello = { type: "hello", version: PROTOCOL_VERSION, name: "Player" };
  for (const color of [0, 0x39c2b4, 0xffffff])
    expect(
      parseClientMessage(JSON.stringify({ ...hello, color })),
    ).toMatchObject({ color });
  for (const color of [-1, 0x1000000, 1.5, "#39c2b4", null])
    expect(parseClientMessage(JSON.stringify({ ...hello, color }))).toBeNull();
});

test("seating packets keep only the seat identifier", () => {
  expect(parseClientMessage('{"type":"sit","seat":"bar-1","x":99}')).toEqual({
    type: "sit",
    seat: "bar-1",
  });
  expect(parseClientMessage('{"type":"stand","seat":"bar-1"}')).toEqual({
    type: "stand",
  });
});

test("diagnostics strictly validate a small bounded report", () => {
  const report: import("../src/index").ClientDiagnostic = {
    type: "diagnostic",
    kind: "pool",
    table: "a",
    turn: 0,
    durationMs: 10000,
    count: 3,
    maxError: 0.2,
    errorBins: [1, 1, 1, 0],
    maxPacketGapMs: 150,
  };
  expect(parseClientMessage(JSON.stringify(report))).toEqual(report);
  expect(
    parseClientMessage(
      JSON.stringify({ ...report, kind: "movement", table: null, turn: null }),
    ),
  ).toMatchObject({ kind: "movement" });
  for (const patch of [
    { count: 1.5 },
    { count: 65536 },
    { maxError: null },
    { maxError: 101 },
    { maxError: 0.001 },
    { durationMs: 0 },
    { durationMs: 60001 },
    { maxPacketGapMs: -1 },
    { turn: -1 },
    { table: null },
    { kind: "movement" },
    { token: "secret" },
    { errorBins: [3, 0, 0] },
    { errorBins: [1, 0, 0, 0] },
    { errorBins: [1.5, 1.5, 0, 0] },
    { errorBins: [-1, 4, 0, 0] },
  ])
    expect(
      parseClientMessage(JSON.stringify({ ...report, ...patch })),
    ).toBeNull();
  expect(
    parseClientMessage(JSON.stringify(report).replace("0.2", "1e999")),
  ).toBeNull();
  expect(
    parseClientMessage(" ".repeat(1000) + JSON.stringify(report)),
  ).toBeNull();
});

test("Zod preserves UTF-16 text limits and exact raw diagnostic byte boundary", () => {
  const hello = {
    type: "hello",
    version: PROTOCOL_VERSION,
    name: "😀".repeat(12),
  };
  expect(parseClientMessage(JSON.stringify(hello))).not.toBeNull();
  expect(
    parseClientMessage(JSON.stringify({ ...hello, name: hello.name + "a" })),
  ).toBeNull();
  expect(
    parseClientMessage(JSON.stringify({ type: "chat", text: "😀".repeat(80) })),
  ).not.toBeNull();
  expect(
    parseClientMessage(JSON.stringify({ type: "chat", text: "😀".repeat(81) })),
  ).toBeNull();
  const report = JSON.stringify({
    type: "diagnostic",
    kind: "pool",
    table: "😀",
    turn: 0,
    durationMs: 10000,
    count: 1,
    maxError: 0.2,
    errorBins: [0, 0, 1, 0],
    maxPacketGapMs: 0,
  });
  const bytes = new TextEncoder().encode(report).byteLength;
  expect(parseClientMessage(report + " ".repeat(999 - bytes))).not.toBeNull();
  expect(parseClientMessage(report + " ".repeat(1000 - bytes))).toBeNull();
  const ping = '{"type":"ping","time":0}';
  expect(
    parseClientMessage(
      ping + " ".repeat(MAX_CLIENT_MESSAGE_LENGTH - ping.length),
    ),
  ).not.toBeNull();
  expect(
    parseClientMessage(
      ping + " ".repeat(MAX_CLIENT_MESSAGE_LENGTH + 1 - ping.length),
    ),
  ).toBeNull();
});

test("Zod preserves safe integer, finite and exclusive angle boundaries", () => {
  const shot = {
    type: "shot",
    id: "a",
    table: "a",
    turn: Number.MAX_SAFE_INTEGER,
    angle: 99.999,
    power: 0.02,
  };
  expect(parseClientMessage(JSON.stringify(shot))).not.toBeNull();
  for (const patch of [
    { turn: Number.MAX_SAFE_INTEGER + 1 },
    { turn: 0.5 },
    { angle: 100 },
    { angle: -100 },
    { power: 0.019 },
    { power: 1.001 },
  ])
    expect(
      parseClientMessage(JSON.stringify({ ...shot, ...patch })),
    ).toBeNull();
  for (const raw of [
    '{"type":"ping","time":1e999}',
    '{"type":"ping","time":-1e999}',
    '{"type":"move","inputs":[{"seq":9007199254740992,"x":0,"z":0}]}',
  ])
    expect(parseClientMessage(raw)).toBeNull();
  expect(
    parseClientMessage(
      JSON.stringify({
        type: "cue",
        table: "a",
        turn: 0,
        angle: 0,
        power: 0,
        placement: { x: -2, z: 3, extra: true },
        extra: true,
      }),
    ),
  ).toEqual({
    type: "cue",
    table: "a",
    turn: 0,
    angle: 0,
    power: 0,
    placement: { x: -2, z: 3 },
  });
});

test("room schemas enforce full settings and strict nonempty partial updates", async () => {
  const { roomSettingsSchema, roomSettingsPatchSchema } =
    await import("../src/index");
  const settings = { lightIntensity: 3, gravity: [-15, 15, 0], cutaway: false };
  expect(roomSettingsSchema.safeParse(settings).success).toBe(true);
  expect(roomSettingsSchema.safeParse({ lightIntensity: 0 }).success).toBe(
    false,
  );
  for (const value of [
    null,
    [],
    {},
    { force: true },
    { cutaway: true, force: true },
    { lightIntensity: -0.01 },
    { lightIntensity: 3.01 },
    { lightIntensity: Infinity },
    { gravity: [0, 0] },
    { gravity: [0, 0, 0, 0] },
    { gravity: [0, NaN, 0] },
    { gravity: [15.01, 0, 0] },
    { gravity: [-15.01, 0, 0] },
    { cutaway: 1 },
    { cutaway: undefined },
  ])
    expect(roomSettingsPatchSchema.safeParse(value).success).toBe(false);
  for (const patch of [
    { lightIntensity: 0 },
    { gravity: [0, -9.81, 0] },
    { cutaway: true },
  ])
    expect(roomSettingsPatchSchema.safeParse(patch).success).toBe(true);
  expect(
    roomSettingsSchema.safeParse({ ...settings, force: true }).success,
  ).toBe(false);
});

test("only bounded trace envelopes can exceed the ordinary command budget", () => {
  const trace = {
    type: "pool-trace" as const,
    id: "incident",
    commandId: "shot",
    table: "1",
    rack: 1,
    turn: 1,
    payload: "A".repeat(4096),
  };
  expect(JSON.stringify(trace).length).toBeGreaterThan(
    MAX_CLIENT_MESSAGE_LENGTH,
  );
  expect(parseClientMessage(JSON.stringify(trace))).toEqual(trace);
  expect(
    parseClientMessage(JSON.stringify({ ...trace, payload: "!".repeat(4096) })),
  ).toBeNull();
  expect(
    parseClientMessage(
      JSON.stringify({ ...trace, payload: "A".repeat(200000) }),
    ),
  ).toBeNull();
  expect(
    parseClientMessage(JSON.stringify({ ...trace, token: "not-collected" })),
  ).toBeNull();
  expect(
    parseClientMessage(
      JSON.stringify({
        type: "hello",
        version: PROTOCOL_VERSION,
        name: "Guest",
        padding: "A".repeat(4096),
      }),
    ),
  ).toBeNull();
});
