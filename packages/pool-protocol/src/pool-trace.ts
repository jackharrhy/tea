import { z } from "zod";
import { physicalBallSchema } from "@tea/pool/recording";

export const MAX_POOL_TRACE_BYTES = 128 * 1024;
export const MAX_POOL_TRACE_RAW_BYTES = 1024 * 1024;
export const MAX_POOL_TRACE_MESSAGE_LENGTH = 192 * 1024;
const time = z.number().finite().min(0).max(1e12);
const offset = z.number().finite().min(-1e12).max(1e12);
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const id = z.string().min(1).max(64);
const table = z.string().min(1).max(8);
const balls = z
  .array(physicalBallSchema)
  .max(16)
  .refine(
    (values) => new Set(values.map((ball) => ball.id)).size === values.length,
    "Ball IDs must be unique",
  );
const poses = z
  .array(
    z.strictObject({
      id: z.number().int().min(0).max(15),
      x: z.number().finite(),
      y: z.number().finite(),
      z: z.number().finite(),
      epoch: z.string().max(64),
      q: z
        .tuple([
          z.number().finite(),
          z.number().finite(),
          z.number().finite(),
          z.number().finite(),
        ])
        .optional(),
    }),
  )
  .max(16);
export const poolTraceCorrectionSchema = z.strictObject({
  at: time,
  error: z.number().finite().min(0).max(100),
  serverTick: integer,
  serverTime: time,
  alignedTick: integer,
  replayedTick: integer,
  predicted: balls,
  authoritative: balls,
  replayed: balls,
  renderedBefore: poses,
  renderedAfter: poses,
});
export type PoolTraceCorrection = z.infer<typeof poolTraceCorrectionSchema>;
export const poolTraceSchema = z
  .strictObject({
    formatVersion: z.literal(1),
    id,
    context: z.strictObject({
      command: z.strictObject({
        id,
        table,
        turn: integer,
        angle: z.number().finite(),
        power: z.number().min(0.02).max(1),
      }),
      gravity: z.tuple([
        z.number().min(-15).max(15),
        z.number().min(-15).max(15),
        z.number().min(-15).max(15),
      ]),
      rack: integer,
      initial: balls.refine((values) => values.length > 0),
      initialSnapshot: z.strictObject({
        tick: integer,
        time,
        receivedAt: time,
      }),
      sentAt: time,
      cueContactAt: time,
      clientBuild: z.string().min(1).max(128),
      physicsBuild: z.string().min(1).max(128),
      userAgent: z.string().max(256),
    }),
    trigger: z.strictObject({
      at: time,
      error: z.number().finite().min(0.001).max(100),
      reason: z.enum(["large-correction", "repeated-corrections"]),
    }),
    window: z.strictObject({ start: time, end: time, partial: z.boolean() }),
    transmissions: z.array(time).min(1).max(16),
    acknowledgements: z
      .array(
        z.strictObject({
          receivedAt: time,
          accepted: z.boolean(),
          serverTime: time,
        }),
      )
      .max(8),
    packets: z
      .array(
        z.strictObject({
          receivedAt: time,
          serverTick: integer,
          serverTime: time,
          estimatedOffsetMs: offset,
          gapMs: time,
          rack: integer,
          accepted: z.boolean(),
          turn: integer,
          phase: z.enum([
            "waiting",
            "aiming",
            "rolling",
            "ball-in-hand",
            "finished",
          ]),
          balls,
        }),
      )
      .max(128),
    frames: z
      .array(
        z.strictObject({
          at: time,
          rawFrameMs: time,
          simulationTick: integer,
          droppedSteps: integer,
          predicted: balls,
          rendered: poses,
        }),
      )
      .max(64),
    corrections: z.array(poolTraceCorrectionSchema).min(1).max(32),
    omitted: z.strictObject({
      frames: integer,
      packets: integer,
      corrections: integer,
    }),
  })
  .superRefine((trace, ctx) => {
    const { start, end } = trace.window;
    if (
      end < start ||
      end - start > 3100 ||
      start < trace.trigger.at - 2100 ||
      end > trace.trigger.at + 1100
    )
      ctx.addIssue({
        code: "custom",
        message: "Trace window exceeds its incident bounds",
      });
    for (const [name, samples] of [
      ["frames", trace.frames],
      ["packets", trace.packets],
      ["corrections", trace.corrections],
    ] as const) {
      let previous = -Infinity;
      for (const sample of samples) {
        const at = "receivedAt" in sample ? sample.receivedAt : sample.at;
        if (at < start || at > end || at < previous)
          ctx.addIssue({
            code: "custom",
            message: `${name} must use ordered local times within the window`,
          });
        previous = at;
      }
    }
    if (
      trace.trigger.reason === "large-correction" &&
      trace.trigger.error < 0.1
    )
      ctx.addIssue({
        code: "custom",
        message: "Large correction trigger must reach 10cm",
      });
    if (
      trace.trigger.reason === "repeated-corrections" &&
      trace.corrections.filter(
        (c) =>
          c.at <= trace.trigger.at &&
          c.at >= trace.trigger.at - 1000 &&
          c.error >= 0.025,
      ).length < 3
    )
      ctx.addIssue({
        code: "custom",
        message: "Repeated correction trigger needs three meaningful restores",
      });
    if (
      !trace.corrections.some(
        (c) => c.at === trace.trigger.at && c.error === trace.trigger.error,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Trigger must identify a captured correction",
      });
  });
export type PoolTrace = z.infer<typeof poolTraceSchema>;
export const poolTraceMessageSchema = z.strictObject({
  type: z.literal("pool-trace"),
  id,
  table,
  turn: integer,
  rack: integer,
  commandId: id,
  payload: z
    .string()
    .min(4)
    .max(Math.ceil(MAX_POOL_TRACE_BYTES / 3) * 4)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/)
    .refine((value) => value.length % 4 === 0),
});
export type PoolTraceMessage = z.infer<typeof poolTraceMessageSchema>;
