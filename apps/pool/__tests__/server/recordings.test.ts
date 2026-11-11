import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMatch, createShotResult, type PhysicalBall } from "@harrhy/pool";
import { parseRecording } from "@harrhy/pool/recording";
import { GameRecorder, exportRecording } from "../../server/recordings";

const ball = (): PhysicalBall => ({
  id: 0,
  x: 0,
  y: 0.808575,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  w: [0, 0, 0],
  q: [0, 0, 0, 1],
  pocketed: false,
  stage: "table",
  revision: 1,
});
const command = {
  number: 1,
  seat: 0 as const,
  bot: false,
  angle: Math.PI / 2,
  power: 0.5,
};
const shotId = (db: Database) =>
  (
    db
      .query(
        "SELECT id FROM recorded_shots ORDER BY started_at DESC,rowid DESC LIMIT 1",
      )
      .get() as {
      id: string;
    }
  ).id;

test("durable chunks export exact high-resolution state and interrupted shots remain discoverable", () => {
  const dir = mkdtempSync(join(tmpdir(), "pool-recordings-"));
  const file = join(dir, "game.sqlite");
  let db = new Database(file);
  try {
    const recorder = new GameRecorder(db, {
      revision: "test-build",
      log: () => {},
    });
    const balls = [ball()];
    recorder.startGame("3");
    recorder.startShot("3", command, balls);
    const id = shotId(db);
    for (let tick = 1; tick <= 125; tick++) {
      balls[0].x = tick * 0.001;
      balls[0].w = [tick, 0.2, 0.3];
      recorder.sample("3", tick, 1 / 60, balls);
    }
    // Simulate a process exit between chunk flushes, without calling recorder.close().
    db.close();
    db = new Database(file);
    expect(new GameRecorder(db, { log: () => {} })).toBeInstanceOf(
      GameRecorder,
    );
    const exported = parseRecording(exportRecording(db, id));
    const shot = exported.shots[0];
    expect(shot.frames).toHaveLength(120);
    expect(shot.frames[119].balls[0].x).toBe(0.12);
    expect(shot.frames[119].balls[0].w).toEqual([120, 0.2, 0.3]);
    expect(shot.initial[0].x).toBe(0);
    expect(shot.build.revision).toBe("test-build");
    expect(shot.endReason).toBe("server-interrupted");
    expect(shot.flags).toContain("server_interrupted");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("anomaly evidence persists before a shot resolves, and repeated violations produce one wide event", () => {
  const db = new Database(":memory:");
  const logs: Record<string, unknown>[] = [];
  try {
    const recorder = new GameRecorder(db, { log: (e) => logs.push(e) });
    const balls = [ball()];
    recorder.startShot("1", command, balls);
    const id = shotId(db);
    balls[0].y = 0.6;
    for (let tick = 0; tick < 160; tick++)
      recorder.sample("1", tick, 0.2, balls);
    const recording = exportRecording(db, id).shots[0];
    expect(recording.flags).toContain("below_bed_unpocketed");
    expect(recording.flags).toContain("long_roll");
    expect(
      logs.filter((e) => e.reason === "below_bed_unpocketed"),
    ).toHaveLength(1);
    expect(logs.filter((e) => e.reason === "long_roll")).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      event: "pool_shot_anomaly",
      shotId: id,
      tableId: "1",
      power: 0.5,
    });
    recorder.close();
  } finally {
    db.close();
  }
});

test("recordings cap frame capture and prune completed ordinary shots before flagged ones", () => {
  const db = new Database(":memory:");
  try {
    const recorder = new GameRecorder(db, { maxShots: 2, log: () => {} });
    const balls = [ball()];
    recorder.startShot("1", command, balls);
    const first = shotId(db);
    for (let tick = 0; tick < 7202; tick++)
      recorder.sample("1", tick, 1 / 60, balls);
    recorder.resolved("1", createMatch(), createShotResult());
    recorder.sample("1", 7203, 1 / 60, balls);
    const full = exportRecording(db, first).shots[0];
    expect(full.frames).toHaveLength(7200);
    expect(full.droppedFrames).toBe(3);
    expect(full.flags).toContain("frame_limit");
    for (let i = 2; i <= 3; i++) {
      recorder.startShot("1", { ...command, number: i }, balls);
      recorder.resolved("1", createMatch(), createShotResult());
      recorder.sample("1", i, 1 / 60, balls);
    }
    expect(
      (
        db.query("SELECT COUNT(*) AS n FROM recorded_shots").get() as {
          n: number;
        }
      ).n,
    ).toBe(2);
    expect(
      db.query("SELECT id FROM recorded_shots WHERE id=?").get(first),
    ).not.toBeNull();
    recorder.close();
  } finally {
    db.close();
  }
});

test("optional recording storage failure does not break gameplay calls", () => {
  const db = new Database(":memory:");
  const logs: unknown[] = [];
  const recorder = new GameRecorder(db, { log: (e) => logs.push(e) });
  db.close();
  expect(() => recorder.startShot("1", command, [ball()])).not.toThrow();
  expect(() => recorder.sample("1", 1, 1 / 60, [ball()])).not.toThrow();
  expect(logs).toHaveLength(1);
});

const reporter = { playerId: "p", seat: 0, tick: 1 };
const report = {
  type: "diagnostic" as const,
  kind: "pool" as const,
  table: "1",
  turn: 1,
  durationMs: 100,
  count: 2,
  maxError: 0.2,
  errorBins: [0, 2, 0, 0] as [number, number, number, number],
  maxPacketGapMs: 0,
};

test("chunk and header writes roll back together when the header update fails", () => {
  const db = new Database(":memory:");
  try {
    const recorder = new GameRecorder(db, { log: () => {} });
    recorder.startShot("1", command, [ball()]);
    const id = shotId(db);
    db.exec(
      "CREATE TRIGGER reject_header BEFORE UPDATE ON recorded_shots BEGIN SELECT RAISE(ABORT,'failed header'); END",
    );
    for (let i = 0; i < 120; i++) recorder.sample("1", i, 1 / 60, [ball()]);
    expect(exportRecording(db, id).shots[0].frames).toEqual([]);
    expect(() => recorder.metrics()).toThrow("unavailable");
    expect(recorder.audit("owner", "action", {})).toBe(false);
  } finally {
    db.close();
  }
});

test("diagnostic and shot flag are atomic, and audit failure is observable", () => {
  const db = new Database(":memory:");
  const logs: Record<string, unknown>[] = [];
  try {
    const recorder = new GameRecorder(db, { log: (event) => logs.push(event) });
    recorder.startShot("1", command, [ball()]);
    const id = shotId(db);
    db.exec(
      "CREATE TRIGGER reject_diagnostic BEFORE INSERT ON recorded_diagnostics BEGIN SELECT RAISE(ABORT,'failed diagnostic'); END",
    );
    recorder.clientDiagnostic(report, reporter);
    expect(exportRecording(db, id).shots[0].flags).toEqual([]);
    expect(recorder.audit("owner", "action", {})).toBe(false);
    expect(() => recorder.metrics()).toThrow("unavailable");
    expect(
      logs.filter((event) => event.event === "pool_recording_disabled"),
    ).toHaveLength(1);
  } finally {
    db.close();
  }
});

test("committed audits survive logging failure and metrics separate activity from errors", () => {
  const db = new Database(":memory:");
  try {
    const recorder = new GameRecorder(db, {
      log: () => {
        throw new Error("sink failed");
      },
    });
    recorder.startShot("1", command, [ball()]);
    recorder.sample("1", 1, 0.01, [{ ...ball(), y: 0.6 }]);
    recorder.clientDiagnostic(report, reporter);
    expect(recorder.audit("owner", "settings", { phase: "attempt" })).toBe(
      true,
    );
    const metrics = recorder.metrics();
    expect(metrics.summary).toMatchObject({
      games: 1,
      shots: 1,
      flaggedShots: 1,
      clientReports: 1,
      correctionCount: 2,
      maxCorrection: 0.2,
    });
    expect(metrics.histogram).toEqual([0, 2, 0, 0]);
    expect(metrics.activity).toHaveLength(1);
    expect(metrics.activity[0]).toMatchObject({
      event: "owner_action",
      phase: "attempt",
    });
    expect(metrics.errors.some((event) => event.event === "owner_action")).toBe(
      false,
    );
    expect(
      metrics.errors.some((event) => event.event === "below_bed_unpocketed"),
    ).toBe(true);
    expect(metrics.errors.map((event) => event.at)).toEqual(
      metrics.errors.map((event) => event.at).toSorted((a, b) => b - a),
    );
    expect(metrics.window).toEqual({ shots: 1, reports: 2 });
    db.close();
    expect(() => recorder.metrics()).toThrow("unavailable");
    expect(recorder.audit("owner", "settings", {})).toBe(false);
  } finally {
    db.close();
  }
});

test("logical game end retains winning-shot return tail and blocks new shots until new game", () => {
  const db = new Database(":memory:");
  try {
    const recorder = new GameRecorder(db, { log: () => {} });
    const balls = [{ ...ball(), pocketed: true, stage: "falling" as const }];
    recorder.startShot("1", command, balls, [1, -5, 0]);
    const id = shotId(db);
    recorder.resolved("1", createMatch(), createShotResult());
    recorder.endGame("1", "won");
    expect(exportRecording(db, id).game.finishedAt).not.toBeNull();
    recorder.startShot("1", { ...command, number: 2 }, balls);
    recorder.sample("1", 1, 0.1, balls);
    recorder.recordGravityChange("1", [0, -8, 0], 2);
    recorder.sample("1", 2, 0.1, [{ ...balls[0], stage: "stored" }]);
    const shot = exportRecording(db, id).shots[0];
    expect(shot.frames).toHaveLength(2);
    expect(shot.endReason).toBe("settled");
    expect(shot.gravity).toEqual([1, -5, 0]);
    expect(shot.flags).toContain("gravity_changed");
    recorder.startShot("1", { ...command, number: 3 }, [ball()]);
    expect(recorder.metrics().summary.shots).toBe(1);
    recorder.startGame("1");
    recorder.startShot("1", command, [ball()]);
    expect(recorder.metrics().summary.shots).toBe(2);
    recorder.close();
  } finally {
    db.close();
  }
});

test("ended game tail has an eight-second deadline", () => {
  const db = new Database(":memory:");
  try {
    const recorder = new GameRecorder(db, { log: () => {} });
    const balls = [{ ...ball(), pocketed: true, stage: "falling" as const }];
    recorder.startShot("1", command, balls);
    const id = shotId(db);
    recorder.endGame("1", "won");
    for (let i = 0; i < 90; i++) recorder.sample("1", i, 0.1, balls);
    const shot = exportRecording(db, id).shots[0];
    expect(shot.durationMs).toBe(8000);
    expect(shot.frames).toHaveLength(80);
    expect(shot.gravity).toEqual([0, -9.81, 0]);
  } finally {
    db.close();
  }
});

test("CLI list/export read a read-only database without migration or mutation", () => {
  const dir = mkdtempSync(join(tmpdir(), "recordings-cli-"));
  const path = join(dir, "recording.sqlite");
  const db = new Database(path);
  try {
    const recorder = new GameRecorder(db, { log: () => {} });
    recorder.startShot("1", command, [ball()]);
    const id = shotId(db);
    recorder.sample("1", 1, 0.1, [ball()]);
    recorder.close();
    // Export/list must also work against the unversioned recording schema.
    db.exec("DROP TABLE app_migrations");
    db.close();
    const before = readFileSync(path);
    for (const args of [
      ["list", path],
      ["export", path, id, join(dir, "export.json")],
    ]) {
      const result = Bun.spawnSync(
        [process.execPath, "scripts/recordings.ts", ...args],
        {
          cwd: join(import.meta.dir, "../.."),
        },
      );
      expect(result.exitCode).toBe(0);
    }
    expect(readFileSync(path)).toEqual(before);
    expect(
      parseRecording(JSON.parse(readFileSync(join(dir, "export.json"), "utf8")))
        .shots[0].frames,
    ).toHaveLength(1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a correction between frame flushes exports a valid durable event timeline", () => {
  const db = new Database(":memory:");
  try {
    const recorder = new GameRecorder(db, { log: () => {} });
    recorder.startShot("1", command, [ball()]);
    const id = shotId(db);
    for (let tick = 1; tick <= 121; tick++)
      recorder.sample("1", tick, 1 / 60, [ball()]);
    recorder.clientDiagnostic(
      {
        type: "diagnostic",
        kind: "pool",
        table: "1",
        turn: command.number,
        durationMs: 10000,
        count: 3,
        maxError: 0.2,
        errorBins: [0, 0, 3, 0],
        maxPacketGapMs: 100,
      },
      { playerId: "local", seat: 0, tick: 121 },
    );
    const recording = parseRecording(exportRecording(db, id));
    expect(recording.shots[0].frames).toHaveLength(120);
    expect(recording.shots[0].events.at(-1)?.at).toBeCloseTo(
      (121 * 1000) / 60,
      6,
    );
    expect(recording.shots[0].durationMs).toBeCloseTo((121 * 1000) / 60, 6);
    recorder.close();
  } finally {
    db.close();
  }
});
