import { createRequestLogger } from "evlog";
import { z } from "zod";

import {
  cancelJob,
  deleteJob,
  getAllJobs,
  isJobStuck,
  resetStuckJob,
} from "#lib/jobs.server";

import type { OperationContext } from "./context.ts";
import { requireOperationAdmin } from "./context.ts";
import { OperationError } from "./errors.ts";

const STUCK_THRESHOLD_MINUTES = 30;

export const jobListInput = z
  .object({ limit: z.number().int().min(1).max(200).default(100) })
  .strict();

export const jobManageInput = z
  .object({
    jobId: z.string().min(1),
    operation: z.enum(["cancel", "reset", "delete"]),
    confirm: z.literal(true),
  })
  .strict();

function serializeJob(job: Awaited<ReturnType<typeof getAllJobs>>[number]) {
  return {
    ...job,
    createdAt: job.createdAt?.toISOString() ?? null,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    isStuck: isJobStuck(job, STUCK_THRESHOLD_MINUTES),
  };
}

export async function listJobsOperation(
  context: OperationContext,
  input: z.output<typeof jobListInput>,
) {
  requireOperationAdmin(context);
  return { jobs: (await getAllJobs(input.limit)).map(serializeJob) };
}

export async function manageJobOperation(
  context: OperationContext,
  input: z.output<typeof jobManageInput>,
) {
  requireOperationAdmin(context);
  const log = createRequestLogger();
  log.set({
    jobOperation: {
      channel: context.channel,
      userId: context.user.id,
      jobId: input.jobId,
      operation: input.operation,
    },
  });

  if (input.operation === "delete") {
    if (!(await deleteJob(input.jobId)))
      throw new OperationError("Job not found", "not_found", 404);
    log.emit();
    return {
      jobId: input.jobId,
      operation: input.operation,
      deleted: true as const,
    };
  }
  const result =
    input.operation === "cancel"
      ? await cancelJob(input.jobId)
      : await resetStuckJob(input.jobId, STUCK_THRESHOLD_MINUTES);
  if (result.isErr())
    throw new OperationError(result.error.message, "conflict", 409);
  log.emit();
  return {
    jobId: input.jobId,
    operation: input.operation,
    job: serializeJob(result.value),
  };
}
