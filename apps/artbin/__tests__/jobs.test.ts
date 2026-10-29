import { afterEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { jobs, users } from "#db";
import { setDbForTesting } from "#db/connection.server";
import {
  cancelJob,
  completeJob,
  createJob,
  failJob,
  getJob,
  isJobStuck,
  processJob,
  registerJobHandler,
  resetStuckJob,
  startJob,
} from "#lib/jobs.server";
import { applyMigrations, createTestDatabase, type TestDatabase } from "./db";

let currentDb: TestDatabase | undefined;

afterEach(() => {
  currentDb?.close();
  currentDb = undefined;
});

function setupDatabase() {
  currentDb = createTestDatabase();
  applyMigrations(currentDb.sqlite);
  setDbForTesting(currentDb.db);
  return currentDb.db;
}

async function seedUser(db: ReturnType<typeof setupDatabase>) {
  await db.insert(users).values({
    id: "user-1",

    username: "user",
    authSubject: "fourm-user-1",
  });
}

describe("job lifecycle", () => {
  test("creates, starts, completes, and fails jobs with persisted state", async () => {
    const db = setupDatabase();
    await seedUser(db);
    const job = await createJob({
      type: "example",
      input: { count: 1 },
      userId: "user-1",
    });

    expect(job.status).toBe("pending");
    expect(JSON.parse(job.input)).toEqual({ count: 1 });

    await startJob(job.id);
    const running = await getJob(job.id);
    expect(running?.status).toBe("running");
    expect(running?.startedAt).toBeInstanceOf(Date);

    await completeJob(job.id, { ok: true });
    const completed = await getJob(job.id);
    expect(completed?.status).toBe("completed");
    expect(completed?.progress).toBe(100);
    expect(JSON.parse(completed?.output ?? "{}")).toEqual({ ok: true });

    const failedJob = await createJob({ type: "example", input: {} });
    await failJob(failedJob.id, "boom");
    const failed = await db.query.jobs.findFirst({
      where: eq(jobs.id, failedJob.id),
    });
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toBe("boom");
  });

  test("cancels only pending jobs", async () => {
    setupDatabase();
    const pending = await createJob({ type: "example", input: {} });
    const running = await createJob({ type: "example", input: {} });
    await startJob(running.id);

    const cancelPending = await cancelJob(pending.id);
    expect(cancelPending.isOk()).toBe(true);
    expect(cancelPending.unwrap().status).toBe("cancelled");

    const cancelRunning = await cancelJob(running.id);
    expect(cancelRunning.isErr()).toBe(true);
    if (!cancelRunning.isErr())
      throw new Error("Expected running cancel to fail");
    expect(cancelRunning.error.message).toBe(
      "Only pending jobs can be cancelled",
    );
  });

  test("resets only stuck running jobs", async () => {
    const db = setupDatabase();
    const running = await createJob({ type: "example", input: {} });
    await startJob(running.id);
    await db
      .update(jobs)
      .set({ startedAt: new Date(Date.now() - 60 * 60 * 1000), progress: 50 })
      .where(eq(jobs.id, running.id));

    const reset = await resetStuckJob(running.id, 30);
    expect(reset.isOk()).toBe(true);
    expect(reset.unwrap().status).toBe("pending");
    expect(reset.unwrap().progress).toBe(0);

    const pending = await createJob({ type: "example", input: {} });
    const resetPending = await resetStuckJob(pending.id, 30);
    expect(resetPending.isErr()).toBe(true);
    if (!resetPending.isErr())
      throw new Error("Expected pending reset to fail");
    expect(resetPending.error.message).toBe("Job is not running");
  });

  test("detects stuck jobs", async () => {
    setupDatabase();
    const job = await createJob({ type: "example", input: {} });
    const runningJob = {
      ...job,
      status: "running" as const,
      startedAt: new Date(Date.now() - 31 * 60 * 1000),
    };

    expect(isJobStuck(runningJob, 30)).toBe(true);
    expect(isJobStuck({ ...runningJob, startedAt: new Date() }, 30)).toBe(
      false,
    );
  });
});

describe("processJob", () => {
  test("fails unknown job types with a Result error", async () => {
    setupDatabase();
    const job = await createJob({ type: "unknown", input: {} });

    const result = await processJob(job);

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error("Expected unknown handler to fail");
    expect(result.error.message).toBe("Unknown job type: unknown");

    const persisted = await getJob(job.id);
    expect(persisted?.status).toBe("failed");
    expect(persisted?.error).toBe("Unknown job type: unknown");
  });

  test("runs registered handlers and completes the job", async () => {
    setupDatabase();
    registerJobHandler("test-handler", async (_job, input) => ({
      received: input.value,
    }));
    const job = await createJob({ type: "test-handler", input: { value: 42 } });

    const result = await processJob(job);

    expect(result.isOk()).toBe(true);
    const persisted = await getJob(job.id);
    expect(persisted?.status).toBe("completed");
    expect(JSON.parse(persisted?.output ?? "{}")).toEqual({ received: 42 });
  });

  test("converts handler exceptions into Result errors and failed jobs", async () => {
    setupDatabase();
    registerJobHandler("throwing-handler", async () => {
      throw new Error("handler exploded");
    });
    const job = await createJob({ type: "throwing-handler", input: {} });

    const result = await processJob(job);

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error("Expected throwing handler to fail");
    expect(result.error.message).toBe("handler exploded");

    const persisted = await getJob(job.id);
    expect(persisted?.status).toBe("failed");
    expect(persisted?.error).toBe("handler exploded");
  });
});
