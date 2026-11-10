import { z } from "zod";

export const RECORDING_FORMAT = 1;
const finite = z.number().finite();
const elapsed = finite.nonnegative();
const integer = z.number().int().nonnegative();
const ballId = z.number().int().min(0).max(15);
const id = z.string().min(1).max(256);
const text = z.string().min(1).max(512);
const quaternion = z
  .tuple([finite, finite, finite, finite])
  .refine(
    (q) => Math.abs(Math.hypot(...q) - 1) <= 0.01,
    "Expected a unit quaternion",
  );
export const physicalBallSchema = z.object({
  id: ballId,
  x: finite,
  y: finite,
  z: finite,
  vx: finite,
  vy: finite,
  vz: finite,
  q: quaternion,
  w: z.tuple([finite, finite, finite]),
  pocketed: z.boolean(),
  stage: z.enum(["table", "falling", "return", "stored"]),
  revision: integer,
});
const ballsSchema = z
  .array(physicalBallSchema)
  .min(1)
  .max(16)
  .superRefine((balls, ctx) => {
    if (new Set(balls.map((ball) => ball.id)).size !== balls.length)
      ctx.addIssue({ code: "custom", message: "Ball IDs must be unique" });
  });

export const recordingEventSchema = z
  .object({
    type: text,
    at: elapsed,
    tick: integer,
    ballId: ballId.optional(),
  })
  .catchall(z.unknown());
export type RecordingEvent = z.infer<typeof recordingEventSchema>;

export const recordedFrameSchema = z.object({
  at: elapsed.positive(),
  dt: finite.positive(),
  tick: integer,
  balls: ballsSchema,
});
export type RecordedFrame = z.infer<typeof recordedFrameSchema>;

export const recordedShotSchema = z
  .object({
    id,
    gameId: id,
    tableId: id,
    startedAt: elapsed,
    rack: integer.optional(),
    build: z.object({ revision: text, bun: text, physics: text }),
    command: z.object({
      id: z.string().min(1).max(64).optional(),
      number: integer,
      seat: z.union([z.literal(0), z.literal(1)]),
      bot: z.boolean(),
      angle: finite,
      power: finite.min(0).max(1),
    }),
    gravity: z
      .tuple([
        finite.min(-15).max(15),
        finite.min(-15).max(15),
        finite.min(-15).max(15),
      ])
      .optional(),
    initial: ballsSchema,
    frames: z.array(recordedFrameSchema).max(7500),
    events: z.array(recordingEventSchema).max(7500),
    flags: z.array(text).max(7500),
    outcome: z
      .object({
        result: z.object({
          firstContact: ballId.nullable(),
          potted: z
            .array(ballId)
            .max(16)
            .refine(
              (ids) => new Set(ids).size === ids.length,
              "Duplicate potted ball",
            ),
          railAfterContact: z.boolean(),
        }),
        phase: text.refine(
          (phase) =>
            [
              "waiting",
              "aiming",
              "rolling",
              "ball-in-hand",
              "finished",
            ].includes(phase),
          "Unknown match phase",
        ),
        turn: integer.max(1),
        shotNumber: integer,
      })
      .nullable(),
    endReason: text.nullable(),
    droppedFrames: integer,
    durationMs: elapsed.optional(),
  })
  .superRefine((shot, ctx) => {
    const ids = new Set(shot.initial.map((ball) => ball.id));
    let previousAt = 0,
      previousTick = -1;
    for (const [index, frame] of shot.frames.entries()) {
      if (
        frame.balls.length !== ids.size ||
        frame.balls.some((ball) => !ids.has(ball.id))
      )
        ctx.addIssue({
          code: "custom",
          path: ["frames", index, "balls"],
          message: "Frame must contain exactly the initial ball IDs",
        });
      if (frame.at <= previousAt || frame.tick <= previousTick)
        ctx.addIssue({
          code: "custom",
          path: ["frames", index],
          message: "Frame times and ticks must strictly increase",
        });
      previousAt = frame.at;
      previousTick = frame.tick;
    }
    for (const [index, event] of shot.events.entries()) {
      if (event.ballId !== undefined && !ids.has(event.ballId))
        ctx.addIssue({
          code: "custom",
          path: ["events", index, "ballId"],
          message: "Event ball is absent from the initial state",
        });
      if (shot.durationMs !== undefined && event.at > shot.durationMs)
        ctx.addIssue({
          code: "custom",
          path: ["events", index, "at"],
          message: "Event exceeds shot duration",
        });
    }
    if (shot.durationMs !== undefined && previousAt > shot.durationMs)
      ctx.addIssue({
        code: "custom",
        path: ["durationMs"],
        message: "Duration ends before the last frame",
      });
  });
export type RecordedShot = z.infer<typeof recordedShotSchema>;

export const gameRecordingSchema = z
  .object({
    formatVersion: z.literal(RECORDING_FORMAT),
    game: z.object({
      id,
      tableId: id,
      startedAt: elapsed,
      finishedAt: elapsed.nullable(),
    }),
    shots: z.array(recordedShotSchema).max(200),
  })
  .superRefine((recording, ctx) => {
    const { game } = recording;
    if (game.finishedAt !== null && game.finishedAt < game.startedAt)
      ctx.addIssue({
        code: "custom",
        path: ["game", "finishedAt"],
        message: "Game finishes before it starts",
      });
    const ids = new Set<string>();
    for (const [index, shot] of recording.shots.entries()) {
      if (shot.gameId !== game.id || shot.tableId !== game.tableId)
        ctx.addIssue({
          code: "custom",
          path: ["shots", index],
          message: "Shot must belong to the exported game and table",
        });
      if (ids.has(shot.id))
        ctx.addIssue({
          code: "custom",
          path: ["shots", index, "id"],
          message: "Duplicate shot ID",
        });
      ids.add(shot.id);
      if (
        shot.startedAt < game.startedAt ||
        (game.finishedAt !== null && shot.startedAt > game.finishedAt)
      )
        ctx.addIssue({
          code: "custom",
          path: ["shots", index, "startedAt"],
          message: "Shot starts outside the game timeline",
        });
    }
  });
export type GameRecording = z.infer<typeof gameRecordingSchema>;

export function parseRecording(value: unknown): GameRecording {
  return gameRecordingSchema.parse(value);
}
