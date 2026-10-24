import { db } from "#db/connection.server";
import { jobs, type Job } from "#db";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { unlink } from "fs/promises";
import { Result } from "better-result";
import { createRequestLogger } from "evlog";

export interface CreateJobInput {
  type: string;
  input: Record<string, unknown>;
  userId?: string;
}

export async function createJob(params: CreateJobInput): Promise<Job> {
  const id = nanoid();

  const [job] = await db
    .insert(jobs)
    .values({
      id,
      type: params.type,
      input: JSON.stringify(params.input),
      userId: params.userId ?? null,
      status: "pending",
    })
    .returning();

  return job;
}

export async function getJob(id: string): Promise<Job | undefined> {
  return db.query.jobs.findFirst({
    where: eq(jobs.id, id),
  });
}

export async function getAllJobs(limit = 100): Promise<Job[]> {
  return db.query.jobs.findMany({
    orderBy: (table, { desc }) => [desc(table.createdAt)],
    limit,
  });
}

export async function updateJobProgress(
  id: string,
  progress: number,
  message?: string,
): Promise<void> {
  await db
    .update(jobs)
    .set({
      progress,
      progressMessage: message ?? null,
    })
    .where(eq(jobs.id, id));
}

export async function startJob(id: string): Promise<void> {
  await db
    .update(jobs)
    .set({
      status: "running",
      startedAt: new Date(),
    })
    .where(eq(jobs.id, id));
}

export async function completeJob(
  id: string,
  output: Record<string, unknown>,
): Promise<void> {
  await db
    .update(jobs)
    .set({
      status: "completed",
      progress: 100,
      output: JSON.stringify(output),
      completedAt: new Date(),
    })
    .where(eq(jobs.id, id));
}

export async function failJob(id: string, error: string): Promise<void> {
  await db
    .update(jobs)
    .set({
      status: "failed",
      error,
      completedAt: new Date(),
    })
    .where(eq(jobs.id, id));
}

export async function cancelJob(id: string) {
  const job = await getJob(id);
  if (!job) {
    return Result.err(new Error("Job not found"));
  }
  if (job.status !== "pending") {
    return Result.err(new Error("Only pending jobs can be cancelled"));
  }

  const result = await db
    .update(jobs)
    .set({
      status: "cancelled",
      completedAt: new Date(),
    })
    .where(and(eq(jobs.id, id), eq(jobs.status, "pending")));

  if (result.changes === 0) {
    return Result.err(new Error("Job could not be cancelled"));
  }

  const updatedJob = await getJob(id);
  return Result.ok(updatedJob!);
}

/**
 * Delete a job and clean up any associated temp files
 */
export async function deleteJob(id: string): Promise<boolean> {
  const job = await getJob(id);
  if (!job) return false;

  // Try to clean up temp files if the job input contains a tempFile path
  try {
    const input = JSON.parse(job.input) as Record<string, unknown>;
    if (
      typeof input.tempFile === "string" &&
      input.tempFile.includes("/tmp/")
    ) {
      try {
        await unlink(input.tempFile);
      } catch {
        // File may already be deleted, ignore
      }
    }
  } catch {
    // Ignore JSON parse errors
  }

  const result = await db.delete(jobs).where(eq(jobs.id, id));
  return result.changes > 0;
}

/**
 * Reset a stuck running job back to pending
 * Only works for jobs that have been running for more than the threshold
 */
export async function resetStuckJob(id: string, stuckThresholdMinutes = 30) {
  const job = await getJob(id);
  if (!job) return Result.err(new Error("Job not found"));
  if (job.status !== "running")
    return Result.err(new Error("Job is not running"));

  // Check if the job has been running long enough to be considered stuck
  if (job.startedAt) {
    const runningTime = Date.now() - new Date(job.startedAt).getTime();
    const thresholdMs = stuckThresholdMinutes * 60 * 1000;
    if (runningTime < thresholdMs) {
      return Result.err(new Error("Job is not stuck"));
    }
  }

  const result = await db
    .update(jobs)
    .set({
      status: "pending",
      startedAt: null,
      progress: 0,
      progressMessage: "Reset after appearing stuck",
    })
    .where(eq(jobs.id, id));

  if (result.changes === 0) {
    return Result.err(new Error("Job could not be reset"));
  }

  const updatedJob = await getJob(id);
  return Result.ok(updatedJob!);
}

export function isJobStuck(job: Job, thresholdMinutes = 30): boolean {
  if (job.status !== "running") return false;
  if (!job.startedAt) return false;

  const runningTime = Date.now() - new Date(job.startedAt).getTime();
  const thresholdMs = thresholdMinutes * 60 * 1000;
  return runningTime > thresholdMs;
}

type JobHandler = (
  job: Job,
  input: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

const jobHandlers = new Map<string, JobHandler>();

export function registerJobHandler(type: string, handler: JobHandler): void {
  jobHandlers.set(type, handler);
}

async function getNextJob(): Promise<Job | undefined> {
  return db.query.jobs.findFirst({
    where: eq(jobs.status, "pending"),
    orderBy: (table, { asc }) => [asc(table.createdAt)],
  });
}

export async function processJob(job: Job) {
  const handler = jobHandlers.get(job.type);

  if (!handler) {
    await failJob(job.id, `Unknown job type: ${job.type}`);
    return Result.err(new Error(`Unknown job type: ${job.type}`));
  }

  const log = createRequestLogger();
  log.set({ job: { id: job.id, type: job.type } });

  try {
    await startJob(job.id);
    const startTime = Date.now();
    const input = JSON.parse(job.input) as Record<string, unknown>;
    const output = await handler(job, input);
    await completeJob(job.id, output);
    const completedJob = await getJob(job.id);
    log.set({
      job: {
        id: job.id,
        type: job.type,
        status: "completed",
        durationMs: Date.now() - startTime,
      },
    });
    log.emit();
    return Result.ok(completedJob!);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failJob(job.id, message);
    log.error(error instanceof Error ? error : new Error(message), {
      step: "process-job",
    });
    log.emit();
    return Result.err(new Error(message));
  }
}

let isRunning = false;
let pollInterval: NodeJS.Timeout | null = null;

/**
 * Start the job runner (polls for jobs every N seconds)
 */
export function startJobRunner(intervalMs = 2000): void {
  if (isRunning) return;

  isRunning = true;
  const runnerLog = createRequestLogger();
  runnerLog.set({ jobRunner: { event: "started", intervalMs } });
  runnerLog.emit();

  const poll = async () => {
    if (!isRunning) return;
    let processedJob = false;

    try {
      const job = await getNextJob();
      if (job) {
        await processJob(job);
        processedJob = true;
      }
    } catch (error) {
      const pollLog = createRequestLogger();
      pollLog.set({ jobRunner: { event: "poll-error" } });
      pollLog.error(error instanceof Error ? error : new Error(String(error)), {
        step: "poll",
      });
      pollLog.emit();
    }

    if (isRunning) {
      pollInterval = setTimeout(poll, processedJob ? 0 : intervalMs);
    }
  };

  // Start polling
  poll();
}

export function stopJobRunner(): void {
  isRunning = false;
  if (pollInterval) {
    clearTimeout(pollInterval);
    pollInterval = null;
  }
  const stopLog = createRequestLogger();
  stopLog.set({ jobRunner: { event: "stopped" } });
  stopLog.emit();
}

export function isJobRunnerActive(): boolean {
  return isRunning;
}
