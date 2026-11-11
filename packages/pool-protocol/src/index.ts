import { z } from "zod";
import {
  poolTraceMessageSchema,
  MAX_POOL_TRACE_MESSAGE_LENGTH,
} from "./pool-trace";
export * from "./pool-trace";
import type { PoolMatch, PhysicalBall, PoolSound } from "@harrhy/pool";
export type { AdminMetrics } from "./admin";
export const PROTOCOL_VERSION = 9;
export const INPUT_DT = 1 / 60;
export const MAX_INPUT_BATCH = 6;
export const MAX_CLIENT_MESSAGE_LENGTH = 2048;

const text = (max: number) =>
  z.string().refine((value) => value.length > 0 && value.length <= max);

// Keep server-only validation out of clients importing protocol constants.
const protocolSchemas = /* @__PURE__ */ (() => {
  // Protocol limits count UTF-16 code units, including both halves of an emoji.
  const sequence = z.number().int().nonnegative();
  const table = text(8);
  const angle = z.number().gt(-100).lt(100);
  const point = { x: z.number().min(-2).max(2), z: z.number().min(-3).max(3) };

  const roomSettingsSchema = z.strictObject({
    lightIntensity: z.number().min(0).max(3),
    gravity: z.tuple([
      z.number().min(-15).max(15),
      z.number().min(-15).max(15),
      z.number().min(-15).max(15),
    ]),
    cutaway: z.boolean(),
  });
  const roomSettingsPatchSchema = roomSettingsSchema
    .partial()
    .refine(
      (patch) => Object.values(patch).some((value) => value !== undefined),
      "At least one setting is required",
    );

  const moveInputSchema = z.object({
    seq: sequence,
    x: z.number().min(-1).max(1),
    z: z.number().min(-1).max(1),
  });

  const count = z.number().int().min(0).max(65535);
  const clientDiagnosticSchema = z
    .strictObject({
      type: z.literal("diagnostic"),
      table: table.nullable(),
      turn: sequence.nullable(),
      kind: z.enum(["pool", "movement"]),
      durationMs: z.number().min(1).max(60000),
      count: count.min(1),
      maxError: z.number().gt(0.001).max(100),
      errorBins: z.tuple([count, count, count, count]),
      maxPacketGapMs: z.number().min(0).max(60000),
    })
    .refine(
      (report) =>
        report.kind === "pool"
          ? report.table !== null && report.turn !== null
          : report.table === null && report.turn === null,
      "Diagnostic context must match its kind",
    )
    .refine(
      (report) =>
        report.errorBins.reduce((sum, value) => sum + value, 0) ===
        report.count,
      "Histogram must sum to count",
    );

  const clientMessageSchema = z.discriminatedUnion("type", [
    clientDiagnosticSchema,
    poolTraceMessageSchema,
    z.looseObject({
      type: z.literal("hello"),
      version: z.literal(PROTOCOL_VERSION),
      name: text(24),
      token: text(100).optional(),
      color: z.number().int().min(0).max(0xffffff).optional(),
    }),
    z.object({
      type: z.literal("move"),
      inputs: z
        .array(moveInputSchema)
        .min(1)
        .max(MAX_INPUT_BATCH)
        .refine(
          (inputs) =>
            inputs.every(
              (input, index) =>
                index === 0 || input.seq > inputs[index - 1]!.seq,
            ),
          "Input sequences must increase",
        ),
    }),
    z.looseObject({ type: z.literal("join"), table }),
    z.object({ type: z.literal("sit"), seat: text(32) }),
    z.object({ type: z.literal("stand") }),
    z.object({ type: z.literal("leave") }),
    z.looseObject({ type: z.literal("rematch"), table, turn: sequence }),
    z.looseObject({
      type: z.literal("shot"),
      id: text(64),
      table,
      turn: sequence,
      angle,
      power: z.number().min(0.02).max(1),
    }),
    z.looseObject({
      type: z.literal("place"),
      table,
      turn: sequence,
      ...point,
    }),
    z.object({
      type: z.literal("cue"),
      table,
      turn: sequence,
      angle,
      power: z.number().min(0).max(1),
      placement: z.object(point).nullable(),
    }),
    z.looseObject({ type: z.literal("chat"), text: text(160) }),
    z.looseObject({ type: z.literal("ping"), time: z.number() }),
  ]);
  return {
    roomSettingsSchema,
    roomSettingsPatchSchema,
    moveInputSchema,
    clientDiagnosticSchema,
    poolTraceMessageSchema,
    clientMessageSchema,
  };
})();
export const roomSettingsSchema = /* @__PURE__ */ (() =>
  protocolSchemas.roomSettingsSchema)();
export const roomSettingsPatchSchema = /* @__PURE__ */ (() =>
  protocolSchemas.roomSettingsPatchSchema)();
export const moveInputSchema = /* @__PURE__ */ (() =>
  protocolSchemas.moveInputSchema)();
export const clientDiagnosticSchema = /* @__PURE__ */ (() =>
  protocolSchemas.clientDiagnosticSchema)();
export const clientMessageSchema = /* @__PURE__ */ (() =>
  protocolSchemas.clientMessageSchema)();
export type RoomSettings = z.infer<typeof roomSettingsSchema>;
export type MoveInput = z.infer<typeof moveInputSchema>;
export type ClientDiagnostic = z.infer<typeof clientDiagnosticSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type PlayerState = {
  id: string;
  name: string;
  x: number;
  z: number;
  yaw: number;
  color: number;
  table: string | null;
  seat?: string;
  connected: boolean;
  bot?: true;
  seq: number;
  revision: number;
  retiredSeq: number;
};
export type CuePresence = {
  player: string;
  turn: number;
  angle: number;
  power: number;
  placement: { x: number; z: number } | null;
  at: number;
};
export type TableSound = PoolSound & { id: number; time: number; turn: number };

export type TableState = {
  sounds?: TableSound[];
  id: string;
  match: PoolMatch;
  rematchReady: string[];
  rack: number;
  balls: PhysicalBall[];
  cue?: CuePresence;
};
export type Snapshot = {
  type: "state";
  tick: number;
  time: number;
  players: PlayerState[];
  tables: TableState[];
  room?: RoomSettings;
};
export type ShotAck = {
  type: "shot-ack";
  id: string;
  table: string;
  turn: number;
  accepted: boolean;
  time: number;
  text?: string;
};
export type ServerMessage =
  | { type: "room-settings"; settings: RoomSettings }
  | ShotAck
  | Snapshot
  | { type: "welcome"; id: string; token: string }
  | { type: "approach"; table: string }
  | { type: "error"; text: string }
  | { type: "chat"; name: string; text: string; time: number }
  | { type: "pong"; time: number };
export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > MAX_POOL_TRACE_MESSAGE_LENGTH) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    raw.length > MAX_CLIENT_MESSAGE_LENGTH &&
    (!value ||
      typeof value !== "object" ||
      !("type" in value) ||
      value.type !== "pool-trace")
  )
    return null;
  const result = clientMessageSchema.safeParse(value);
  if (!result.success) return null;
  if (
    result.data.type === "diagnostic" &&
    new TextEncoder().encode(raw).byteLength >= 1000
  )
    return null;
  return result.data;
}
