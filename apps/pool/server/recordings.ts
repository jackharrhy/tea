import { gunzipSync, gzipSync } from "node:zlib";
import {
  poolTraceSchema,
  poolTraceMessageSchema,
  MAX_POOL_TRACE_BYTES,
  MAX_POOL_TRACE_RAW_BYTES,
  type PoolTrace,
  type PoolTraceMessage,
} from "@harrhy/pool-protocol";
import type { Database } from "bun:sqlite";
import {
  and,
  asc,
  count,
  desc,
  eq,
  isNotNull,
  isNull,
  notExists,
  notInArray,
  sql,
} from "drizzle-orm";
import {
  database,
  migrateDatabase,
  recordedGames,
  recordedShots,
  recordedChunks,
  recordedDiagnostics,
  recordedClientTraces,
  type AppDatabase,
} from "./db";
import type { AdminMetrics, ClientDiagnostic } from "@harrhy/pool-protocol";
import {
  RECORDING_FORMAT,
  type GameRecording,
  type RecordedFrame,
  type RecordedShot,
  type RecordingEvent,
} from "@harrhy/pool/recording";
import {
  BALL_RADIUS,
  type PhysicalBall,
  type PoolMatch,
  type ShotResult,
} from "@harrhy/pool";
import { FELT_Y } from "@harrhy/pool/table";

const MAX_FRAMES = 7200;
const CHUNK_FRAMES = 120;
const cloneBalls = (balls: readonly PhysicalBall[]) =>
  balls.map((b) => ({
    ...b,
    q: [...b.q] as PhysicalBall["q"],
    w: [...b.w] as PhysicalBall["w"],
  }));
type ActiveShot = {
  shot: RecordedShot;
  pending: RecordedFrame[];
  chunk: number;
  elapsed: number;
  frames: number;
  resolvedAt: number | null;
  maxSpeed: number;
  maxHeight: number;
};
type ActiveGame = {
  id: string;
  tableId: string;
  shot: ActiveShot | null;
  ended: boolean;
};

export class GameRecorder {
  private games = new Map<string, ActiveGame>();
  private lastGames = new Map<string, ActiveGame>();
  private disabled = false;
  private db: AppDatabase;
  constructor(
    sqlite: Database,
    private options: {
      revision?: string;
      physics?: string;
      maxBytes?: number;
      maxShots?: number;
      maxTraceBytes?: number;
      maxTraces?: number;
      log?: (event: Record<string, unknown>) => void;
    } = {},
  ) {
    this.db = database(sqlite);
    this.run(() => {
      migrateDatabase(sqlite);
      // Previous processes cannot finish in-memory shots after a restart.
      const unfinished = this.db
        .select()
        .from(recordedShots)
        .where(isNull(recordedShots.finishedAt))
        .all();
      for (const row of unfinished) {
        const header = row.header;
        header.endReason = "server-interrupted";
        if (!header.flags.includes("server_interrupted"))
          header.flags.push("server_interrupted");
        this.db
          .update(recordedShots)
          .set({ finishedAt: Date.now(), flagged: 1, header })
          .where(eq(recordedShots.id, row.id))
          .run();
      }
      this.db
        .update(recordedGames)
        .set({ finishedAt: Date.now(), outcome: "server-interrupted" })
        .where(isNull(recordedGames.finishedAt))
        .run();
      this.prune();
    });
  }
  private log(event: Record<string, unknown>) {
    try {
      (this.options.log ?? ((value) => console.log(JSON.stringify(value))))(
        event,
      );
    } catch {
      // A logging sink cannot undo a committed audit or disable gameplay.
    }
  }
  private run(action: () => void) {
    if (this.disabled) return false;
    try {
      action();
      return true;
    } catch (error) {
      if (!this.disabled) {
        this.disabled = true;
        this.log({
          event: "pool_recording_disabled",
          error: String(error),
          revision: this.options.revision ?? "development",
        });
      }
      this.games.clear();
      this.lastGames.clear();
      return false;
    }
  }
  startGame(tableId: string) {
    this.run(() => {
      const previous = this.games.get(tableId);
      if (previous) this.finish(previous, "restarted");
      this.endGame(tableId, "restarted");
      if (this.disabled) return;
      const id = crypto.randomUUID();
      this.db
        .insert(recordedGames)
        .values({ id, tableId, startedAt: Date.now() })
        .run();
      const game = { id, tableId, shot: null, ended: false };
      this.games.set(tableId, game);
      this.lastGames.set(tableId, game);
    });
  }
  startShot(
    tableId: string,
    command: RecordedShot["command"],
    balls: readonly PhysicalBall[],
    gravity: [number, number, number] = [0, -9.81, 0],
    rack?: number,
  ) {
    this.run(() => {
      if (!this.games.has(tableId) && this.lastGames.get(tableId)?.ended)
        return;
      if (!this.games.has(tableId)) this.startGame(tableId);
      const game = this.games.get(tableId);
      if (!game) return;
      if (game.ended) return;
      this.finish(game, "next-shot");
      const shot: RecordedShot = {
        id: crypto.randomUUID(),
        gameId: game.id,
        tableId,
        startedAt: Date.now(),
        build: {
          revision: this.options.revision ?? "development",
          bun: process.versions.bun,
          physics: this.options.physics ?? "pool-v3",
        },
        rack,
        gravity: [...gravity],
        command: { ...command },
        initial: cloneBalls(balls),
        frames: [],
        events: [],
        flags: [],
        outcome: null,
        endReason: null,
        droppedFrames: 0,
      };
      game.shot = {
        shot,
        pending: [],
        chunk: 0,
        elapsed: 0,
        frames: 0,
        resolvedAt: null,
        maxSpeed: 0,
        maxHeight: 0,
      };
      this.db
        .insert(recordedShots)
        .values({
          id: shot.id,
          gameId: game.id,
          startedAt: shot.startedAt,
          header: shot,
        })
        .run();
    });
  }
  sample(
    tableId: string,
    tick: number,
    dt: number,
    balls: readonly PhysicalBall[],
    events: readonly { type: string; ballId?: number }[] = [],
  ) {
    this.run(() => {
      const game = this.games.get(tableId),
        active = game?.shot;
      if (!game || !active || dt <= 0) return;
      active.elapsed += dt * 1000;
      for (const event of events) {
        if (active.shot.events.length < 512)
          active.shot.events.push({ ...event, at: active.elapsed, tick });
        if (event.type === "recovery" || event.type === "below-bed")
          this.flag(active, event.type, { ...event }, tick);
      }
      for (const ball of balls) {
        active.maxSpeed = Math.max(
          active.maxSpeed,
          Math.hypot(ball.vx, ball.vy, ball.vz),
        );
        active.maxHeight = Math.max(active.maxHeight, ball.y);
        if (!ball.pocketed && ball.y + BALL_RADIUS < FELT_Y - 0.002)
          this.flag(
            active,
            "below_bed_unpocketed",
            {
              ballId: ball.id,
              position: [ball.x, ball.y, ball.z],
              stage: ball.stage,
            },
            tick,
          );
      }
      if (active.resolvedAt === null && active.elapsed >= 30_000)
        this.flag(active, "long_roll", {}, tick);
      if (active.frames < MAX_FRAMES) {
        active.pending.push({
          at: active.elapsed,
          dt,
          tick,
          balls: cloneBalls(balls),
        });
        active.frames++;
      } else {
        active.shot.droppedFrames++;
        this.flag(active, "frame_limit", {}, tick);
      }
      if (active.pending.length >= CHUNK_FRAMES) this.flush(active);
      if (
        active.resolvedAt !== null &&
        (balls.every((b) => !b.pocketed || b.stage === "stored") ||
          active.elapsed - active.resolvedAt >= 8000)
      )
        this.finish(game, "settled");
    });
  }
  resolved(tableId: string, match: PoolMatch, result: ShotResult) {
    this.run(() => {
      const active = this.games.get(tableId)?.shot;
      if (!active) return;
      active.shot.outcome = {
        result: structuredClone(result),
        phase: match.phase,
        turn: match.turn,
        shotNumber: match.shotNumber,
      };
      active.resolvedAt = active.elapsed;
      this.flush(active);
    });
  }
  private flag(
    active: ActiveShot,
    reason: string,
    context: Record<string, unknown>,
    tick: number,
  ) {
    if (active.shot.flags.includes(reason)) return;
    active.shot.flags.push(reason);
    const event: RecordingEvent = {
      type: reason,
      at: active.elapsed,
      tick,
      ...context,
    };
    if (
      !active.shot.events.some(
        (e) => e.type === reason && e.at === active.elapsed,
      )
    )
      active.shot.events.push(event);
    this.log(this.summary(active, "pool_shot_anomaly", { reason, ...context }));
    // Persist the evidence now, even if the shot never resolves.
    this.flush(active);
  }
  private summary(
    active: ActiveShot,
    event: string,
    extra: Record<string, unknown> = {},
  ) {
    const s = active.shot;
    return {
      event,
      gameId: s.gameId,
      shotId: s.id,
      tableId: s.tableId,
      shotNumber: s.command.number,
      seat: s.command.seat,
      bot: s.command.bot,
      revision: s.build.revision,
      physics: s.build.physics,
      bun: s.build.bun,
      angle: s.command.angle,
      power: s.command.power,
      elapsedMs: active.elapsed,
      frames: active.frames,
      droppedFrames: s.droppedFrames,
      maxSpeed: active.maxSpeed,
      maxHeight: active.maxHeight,
      flags: [...s.flags],
      outcome: s.outcome,
      ...extra,
    };
  }
  private flush(active: ActiveShot) {
    active.shot.durationMs = active.elapsed;
    const pending = active.pending;
    this.db.transaction((tx) => {
      if (pending.length) {
        tx.insert(recordedChunks)
          .values({
            shotId: active.shot.id,
            seq: active.chunk,
            frames: pending.length,
            data: Buffer.from(Bun.gzipSync(JSON.stringify(pending))),
          })
          .run();
      }
      tx.update(recordedShots)
        .set({
          flagged: Number(active.shot.flags.length > 0),
          header: active.shot,
        })
        .where(eq(recordedShots.id, active.shot.id))
        .run();
    });
    if (pending.length) active.chunk++;
    active.pending = [];
  }

  private finish(game: ActiveGame, reason: string) {
    const active = game.shot;
    if (!active) return;
    active.shot.endReason = reason;
    this.flush(active);
    this.db
      .update(recordedShots)
      .set({ finishedAt: Date.now() })
      .where(eq(recordedShots.id, active.shot.id))
      .run();
    this.log(this.summary(active, "pool_shot_finished", { endReason: reason }));
    game.shot = null;
    if (game.ended) this.games.delete(game.tableId);
    this.prune();
  }
  endGame(tableId: string, outcome: string) {
    this.run(() => {
      const game = this.games.get(tableId);
      if (!game) return;
      game.ended = true;
      this.db
        .update(recordedGames)
        .set({ finishedAt: Date.now(), outcome })
        .where(eq(recordedGames.id, game.id))
        .run();
      if (game.shot) game.shot.resolvedAt ??= game.shot.elapsed;
      else this.games.delete(tableId);
      this.prune();
    });
  }
  close() {
    // Finishing a game removes it from the map.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const game of [...this.games.values()]) {
      this.run(() => this.finish(game, "server-stopped"));
      if (!game.ended) this.endGame(game.tableId, "server-stopped");
    }
  }
  recordGravityChange(
    tableId: string,
    gravity: [number, number, number],
    tick: number,
  ) {
    this.run(() => {
      const active = this.games.get(tableId)?.shot;
      if (active)
        this.flag(active, "gravity_changed", { gravity: [...gravity] }, tick);
    });
  }
  clientTrace(
    message: PoolTraceMessage,
    reporter: { playerId: string; seat: number; tick: number },
  ) {
    if (this.disabled) return;
    let trace: PoolTrace;
    let data: Buffer;
    // Invalid client input must never trip the storage failure circuit breaker.
    try {
      if (!poolTraceMessageSchema.safeParse(message).success) return;
      const compressed = Buffer.from(message.payload, "base64");
      if (compressed.length > MAX_POOL_TRACE_BYTES) return;
      trace = decodeTrace(compressed);
      const command = trace.context.command;
      if (
        trace.id !== message.id ||
        command.table !== message.table ||
        command.turn !== message.turn ||
        command.id !== message.commandId ||
        trace.context.rack !== message.rack
      )
        return;
      data = gzipSync(JSON.stringify(trace));
      if (data.length > MAX_POOL_TRACE_BYTES) return;
    } catch {
      return;
    }
    this.run(() => {
      const game =
        this.games.get(message.table) ?? this.lastGames.get(message.table);
      if (!game) return;
      const row = this.db
        .select()
        .from(recordedShots)
        .where(
          and(
            eq(recordedShots.gameId, game.id),
            sql`json_extract(${recordedShots.header}, '$.command.number') = ${message.turn}`,
            sql`json_extract(${recordedShots.header}, '$.command.id') = ${message.commandId}`,
            sql`json_extract(${recordedShots.header}, '$.command.seat') = ${reporter.seat}`,
            sql`json_extract(${recordedShots.header}, '$.rack') = ${message.rack}`,
          ),
        )
        .limit(1)
        .get();
      if (
        !row ||
        row.header.tableId !== message.table ||
        row.header.command.bot ||
        row.header.command.angle !== trace.context.command.angle ||
        row.header.command.power !== trace.context.command.power ||
        (row.header.gravity &&
          row.header.gravity.some(
            (value, axis) => value !== trace.context.gravity[axis],
          ))
      )
        return;
      const active = game.shot?.shot.id === row.id ? game.shot : null;
      const header = structuredClone(active?.shot ?? row.header);
      if (active) header.durationMs = active.elapsed;
      if (!header.flags.includes("client_pool_trace"))
        header.flags.push("client_pool_trace");
      if (header.events.length < 512)
        header.events.push({
          type: "client_pool_trace",
          at: active?.elapsed ?? header.durationMs ?? 0,
          tick: reporter.tick,
          traceId: trace.id,
          error: trace.trigger.error,
          clientReported: true,
        });
      const inserted = this.db.transaction((tx) => {
        const result = tx
          .insert(recordedClientTraces)
          .values({
            id: trace.id,
            shotId: row.id,
            reporterId: reporter.playerId,
            reporterSeat: reporter.seat,
            receivedAt: Date.now(),
            serverTick: reporter.tick,
            data,
          })
          .onConflictDoNothing()
          .returning({ id: recordedClientTraces.id })
          .get();
        if (!result) return false;
        tx.update(recordedShots)
          .set({ flagged: 1, header })
          .where(eq(recordedShots.id, row.id))
          .run();
        return true;
      });
      if (!inserted) return;
      if (active) active.shot = header;
      this.pruneTraces();
      this.log({
        event: "client_pool_trace",
        clientReported: true,
        shotId: row.id,
        gameId: row.gameId,
        traceId: trace.id,
        bytes: data.length,
        maxError: Math.max(...trace.corrections.map((c) => c.error)),
        revision: header.build.revision,
      });
    });
  }
  private pruneTraces() {
    const maxBytes = this.options.maxTraceBytes ?? 512 * 1024 * 1024;
    const maxTraces = this.options.maxTraces ?? 10_000;
    const usage = this.db
      .select({
        count: count(),
        bytes: sql<number>`coalesce(sum(length(${recordedClientTraces.data})), 0)`,
      })
      .from(recordedClientTraces)
      .get()!;
    if (usage.count <= maxTraces && usage.bytes <= maxBytes) return;
    // Read sizes once; SQLite length(BLOB) uses metadata without loading the contents.
    const oldest = this.db
      .select({
        id: recordedClientTraces.id,
        bytes: sql<number>`length(${recordedClientTraces.data})`,
      })
      .from(recordedClientTraces)
      .orderBy(recordedClientTraces.receivedAt, recordedClientTraces.id)
      .all();
    this.db.transaction((tx) => {
      for (const row of oldest) {
        if (usage.count <= maxTraces && usage.bytes <= maxBytes) break;
        tx.delete(recordedClientTraces)
          .where(eq(recordedClientTraces.id, row.id))
          .run();
        usage.count--;
        usage.bytes -= row.bytes;
      }
    });
  }
  clientDiagnostic(
    report: ClientDiagnostic,
    reporter: { playerId: string; seat: number; tick: number },
  ) {
    this.run(() => {
      const game = report.table
        ? (this.games.get(report.table) ?? this.lastGames.get(report.table))
        : undefined;
      const row =
        report.kind === "pool" && game
          ? this.db
              .select()
              .from(recordedShots)
              .where(
                and(
                  eq(recordedShots.gameId, game.id),
                  sql`json_extract(${recordedShots.header}, '$.command.number') = ${report.turn}`,
                ),
              )
              .limit(1)
              .get()
          : undefined;
      if (report.kind === "pool" && !row) return;
      const active = row && game?.shot?.shot.id === row.id ? game.shot : null;
      const header = row
        ? structuredClone(active?.shot ?? row.header)
        : undefined;
      if (header) {
        if (active) header.durationMs = active.elapsed;
        if (header.events.length < 512)
          header.events.push({
            type: "client_correction",
            at: active?.elapsed ?? header.durationMs ?? 0,
            tick: reporter.tick,
            clientReported: true,
            receivedAt: Date.now(),
            report,
            reporterSeat: reporter.seat,
          });
        if (!header.flags.includes("client_pool_correction"))
          header.flags.push("client_pool_correction");
      }
      const data = {
        event: "client_network_correction",
        clientReported: true,
        gameId: row?.gameId ?? null,
        shotId: row?.id ?? null,
        playerId: reporter.playerId,
        reporterSeat: reporter.seat,
        serverTick: reporter.tick,
        ...report,
      };
      this.db.transaction((tx) => {
        if (row && header)
          tx.update(recordedShots)
            .set({ flagged: 1, header })
            .where(eq(recordedShots.id, row.id))
            .run();
        tx.insert(recordedDiagnostics)
          .values({
            receivedAt: Date.now(),
            kind: report.kind,
            gameId: data.gameId,
            shotId: data.shotId,
            data,
          })
          .run();
        trimDiagnostics(tx);
      });
      if (active && header) active.shot = header;
      this.log(data);
    });
  }
  audit(
    subject: string,
    action: string,
    details: Record<string, unknown>,
  ): boolean {
    return this.run(() => {
      const data = { ...details, event: "owner_action", subject, action };
      this.db.transaction((tx) => {
        tx.insert(recordedDiagnostics)
          .values({ receivedAt: Date.now(), kind: "admin", data })
          .run();
        trimDiagnostics(tx);
      });
      this.log(data);
    });
  }
  metrics(): AdminMetrics {
    if (this.disabled) throw new Error("Recording storage unavailable");
    let result: AdminMetrics | undefined;
    this.run(() => {
      result = readMetrics(this.db);
    });
    if (!result) throw new Error("Recording storage unavailable");
    return result;
  }
  private prune() {
    this.pruneTraces();
    const maxBytes = this.options.maxBytes ?? 4 * 1024 * 1024 * 1024;
    const maxShots = this.options.maxShots ?? 50_000;
    while (true) {
      const size = recordingUsage(this.db);
      if (size.bytes <= maxBytes && size.shots <= maxShots) break;
      const oldest = this.db
        .select({ id: recordedShots.id })
        .from(recordedShots)
        .where(isNotNull(recordedShots.finishedAt))
        .orderBy(
          asc(recordedShots.flagged),
          asc(recordedShots.startedAt),
          asc(recordedShots.id),
        )
        .limit(1)
        .get();
      if (!oldest) break;
      this.db.transaction((tx) => {
        tx.delete(recordedShots).where(eq(recordedShots.id, oldest.id)).run();
        tx.delete(recordedGames)
          .where(
            and(
              isNotNull(recordedGames.finishedAt),
              notExists(
                tx
                  .select({ id: recordedShots.id })
                  .from(recordedShots)
                  .where(eq(recordedShots.gameId, recordedGames.id)),
              ),
            ),
          )
          .run();
      });
    }
  }
}

function trimDiagnostics(db: Pick<AppDatabase, "delete" | "select">) {
  db.delete(recordedDiagnostics)
    .where(
      notInArray(
        recordedDiagnostics.id,
        db
          .select({ id: recordedDiagnostics.id })
          .from(recordedDiagnostics)
          .orderBy(desc(recordedDiagnostics.id))
          .limit(100_000),
      ),
    )
    .run();
}
function recordingUsage(db: AppDatabase) {
  return {
    shots: db.select({ n: count() }).from(recordedShots).get()!.n,
    bytes: db
      .select({
        n: sql<number>`coalesce(sum(length(${recordedChunks.data})),0)`,
      })
      .from(recordedChunks)
      .get()!.n,
  };
}

function readMetrics(db: AppDatabase): AdminMetrics {
  const usage = recordingUsage(db);
  const result: AdminMetrics = {
    summary: {
      games: db.select({ n: count() }).from(recordedGames).get()!.n,
      shots: usage.shots,
      flaggedShots: db
        .select({ n: count() })
        .from(recordedShots)
        .where(eq(recordedShots.flagged, 1))
        .get()!.n,
      clientReports: 0,
      correctionCount: 0,
      maxCorrection: 0,
      recordedBytes: usage.bytes,
    },
    series: [],
    recent: [],
    errors: [],
    activity: [],
    histogram: [0, 0, 0, 0],
    window: { shots: 0, reports: 0 },
  };
  const bins = new Map<number, AdminMetrics["series"][number]>();
  function bin(time: number) {
    const at = Math.floor(time / 300000) * 300000;
    let value = bins.get(at);
    if (!value) {
      value = { at, shots: 0, flagged: 0, corrections: 0, maxError: 0 };
      bins.set(at, value);
    }
    return value;
  }
  const shots = db
    .select()
    .from(recordedShots)
    .orderBy(desc(recordedShots.startedAt), desc(recordedShots.id))
    .limit(200)
    .all();
  result.window.shots = shots.length;
  for (const { id, header, flagged } of shots) {
    const bucket = bin(header.startedAt);
    bucket.shots++;
    bucket.flagged += flagged;
    if (!flagged) continue;
    if (result.recent.length < 30)
      result.recent.push({
        id,
        gameId: header.gameId,
        tableId: header.tableId,
        startedAt: header.startedAt,
        flags: header.flags,
      });
    for (const event of header.events) {
      if (header.flags.includes(event.type))
        result.errors.push({
          ...event,
          event: event.type,
          at: header.startedAt + event.at,
          shotId: id,
        });
    }
  }
  const diagnostics = db
    .select()
    .from(recordedDiagnostics)
    .orderBy(desc(recordedDiagnostics.receivedAt), desc(recordedDiagnostics.id))
    .limit(2000)
    .all();
  result.window.reports = diagnostics.length;
  for (const row of diagnostics) {
    const data = row.data;
    const event = {
      ...data,
      at: row.receivedAt,
      event: String(data.event ?? row.kind),
    };
    if (row.kind === "admin") {
      result.activity.push(event);
      continue;
    }
    const chunkCount = typeof data.count === "number" ? data.count : 0;
    const maxError = typeof data.maxError === "number" ? data.maxError : 0;
    result.summary.clientReports++;
    result.summary.correctionCount += chunkCount;
    result.summary.maxCorrection = Math.max(
      result.summary.maxCorrection,
      maxError,
    );
    if (Array.isArray(data.errorBins))
      data.errorBins.slice(0, 4).forEach((n, i) => {
        if (typeof n === "number") result.histogram[i] += n;
      });
    const bucket = bin(row.receivedAt);
    bucket.corrections += chunkCount;
    bucket.maxError = Math.max(bucket.maxError, maxError);
    result.errors.push(event);
  }
  result.errors.sort((a, b) => b.at - a.at);
  result.errors = result.errors.slice(0, 50);
  result.activity = result.activity.slice(0, 50);
  result.series = [...bins.values()].toSorted((a, b) => a.at - b.at);
  return result;
}

export function exportRecording(sqlite: Database, id: string): GameRecording {
  const db = database(sqlite);
  const shot = db
    .select({ gameId: recordedShots.gameId })
    .from(recordedShots)
    .where(eq(recordedShots.id, id))
    .get();
  const game = db
    .select()
    .from(recordedGames)
    .where(eq(recordedGames.id, shot?.gameId ?? id))
    .get();
  if (!game) throw new Error("Recording not found");
  let expandedBytes = 0;
  const accountBytes = (bytes: number) => {
    expandedBytes += bytes;
    if (expandedBytes > 64 * 1024 * 1024)
      throw new Error("Recording exceeds 64 MB; export a single shot");
  };
  const rows = db
    .select()
    .from(recordedShots)
    .where(
      and(
        eq(recordedShots.gameId, game.id),
        shot ? eq(recordedShots.id, id) : undefined,
      ),
    )
    .orderBy(
      recordedShots.startedAt,
      sql`json_extract(${recordedShots.header}, '$.command.number')`,
      recordedShots.id,
    )
    .all();
  return {
    formatVersion: RECORDING_FORMAT,
    game: {
      id: game.id,
      tableId: game.tableId,
      startedAt: game.startedAt,
      finishedAt: game.finishedAt,
    },
    shots: rows.map((row) => {
      const recording = row.header;
      accountBytes(
        new TextEncoder().encode(JSON.stringify(recording)).byteLength,
      );
      const chunks = db
        .select({ data: recordedChunks.data })
        .from(recordedChunks)
        .where(eq(recordedChunks.shotId, row.id))
        .orderBy(recordedChunks.seq)
        .all();
      recording.frames = chunks.flatMap((chunk) => {
        const decoded = Bun.gunzipSync(new Uint8Array(chunk.data));
        accountBytes(decoded.byteLength);
        return JSON.parse(new TextDecoder().decode(decoded)) as RecordedFrame[];
      });
      return recording;
    }),
  };
}

export function listRecordings(sqlite: Database, gameId?: string) {
  const db = database(sqlite);
  if (gameId)
    return db
      .select({
        id: recordedShots.id,
        started_at: recordedShots.startedAt,
        finished_at: recordedShots.finishedAt,
        flagged: recordedShots.flagged,
        flags: sql<string>`json_extract(${recordedShots.header}, '$.flags')`,
      })
      .from(recordedShots)
      .where(eq(recordedShots.gameId, gameId))
      .orderBy(recordedShots.startedAt)
      .all();
  return db
    .select({
      id: recordedGames.id,
      table_id: recordedGames.tableId,
      started_at: recordedGames.startedAt,
      finished_at: recordedGames.finishedAt,
      shots: count(recordedShots.id),
      flagged: sql<number>`coalesce(sum(${recordedShots.flagged}),0)`,
    })
    .from(recordedGames)
    .leftJoin(recordedShots, eq(recordedShots.gameId, recordedGames.id))
    .groupBy(recordedGames.id)
    .orderBy(desc(recordedGames.startedAt))
    .limit(50)
    .all();
}

function decodeTrace(data: Buffer): PoolTrace {
  if (data.length > MAX_POOL_TRACE_BYTES)
    throw new Error("Trace exceeds compressed limit");
  return poolTraceSchema.parse(
    JSON.parse(
      gunzipSync(data, { maxOutputLength: MAX_POOL_TRACE_RAW_BYTES }).toString(
        "utf8",
      ),
    ),
  );
}

export function exportClientTraces(
  sqlite: Database,
  shotId: string,
): {
  id: string;
  shotId: string;
  receivedAt: number;
  serverTick: number;
  reporterSeat: number;
  trace: PoolTrace;
}[] {
  return database(sqlite)
    .select()
    .from(recordedClientTraces)
    .where(eq(recordedClientTraces.shotId, shotId))
    .orderBy(recordedClientTraces.receivedAt, recordedClientTraces.id)
    .all()
    .map(
      ({
        id,
        shotId: currentShotId,
        receivedAt,
        serverTick,
        reporterSeat,
        data,
      }) => ({
        id,
        shotId: currentShotId,
        receivedAt,
        serverTick,
        reporterSeat,
        trace: decodeTrace(data),
      }),
    );
}
