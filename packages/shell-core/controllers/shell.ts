import { createToolController, ToolError } from "@sdxc/mcp";
import { shellTools } from "../tools.ts";
import { Identity } from "../middleware/security.ts";
import { ownerKey } from "../auth/types.ts";
import { JobError, type JobManager } from "../execution/index.ts";

function invoke<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof JobError)
      throw new ToolError(`${error.code}: ${error.message}`);
    throw error;
  }
}

export function shellController(jobs: JobManager) {
  return createToolController(shellTools, {
    middleware: [
      async (ctx, next) => {
        const identity = ctx.get(Identity);
        if (!identity || identity.expiresAt <= Date.now())
          throw new ToolError(
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
