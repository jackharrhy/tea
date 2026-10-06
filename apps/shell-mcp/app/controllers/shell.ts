import { createToolController, createToolError } from "@tea/mcp";
import { shellTools } from "../tools.ts";
import { Identity } from "../middleware/security.ts";
import { ownerKey } from "../auth/types.ts";
import { isJobError, type JobManager } from "../execution/index.ts";

function invoke<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (isJobError(error))
      throw createToolError(`${error.code}: ${error.message}`);
    throw error;
  }
}

export function shellController(jobs: JobManager) {
  return createToolController(shellTools, {
    middleware: [
      async (ctx, next) => {
        const identity = ctx.get(Identity);
        if (!identity || identity.expiresAt <= Date.now())
          throw createToolError(
            "Authentication expired; authenticate again before calling a tool",
          );
        return next();
      },
    ],
    actions: {
      execute: (ctx) =>
        invoke(() => jobs.execute(ownerKey(ctx.get(Identity)!), ctx.input)),
      readJob: (ctx) =>
        invoke(() =>
          jobs.readJob(ownerKey(ctx.get(Identity)!), ctx.input.jobId),
        ),
      cancel: (ctx) =>
        invoke(() =>
          jobs.cancel(ownerKey(ctx.get(Identity)!), ctx.input.jobId),
        ),
    },
  });
}
