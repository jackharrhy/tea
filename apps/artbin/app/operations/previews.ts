import { eq } from "drizzle-orm";
import { z } from "zod";

import { files, folders } from "#db";
import { db } from "#db/connection.server";
import { createJob } from "#lib/jobs.server";
import { previewTargetSchema } from "#lib/preview-target";

import type { OperationContext } from "./context.ts";
import { requireOperationAdmin } from "./context.ts";
import { OperationError } from "./errors.ts";

export const previewRegenerateInput = z
  .object({
    target: previewTargetSchema,
    confirm: z.literal(true),
  })
  .strict();

export async function queuePreviewRegenerationOperation(
  context: OperationContext,
  input: z.output<typeof previewRegenerateInput>,
) {
  requireOperationAdmin(context);
  if (input.target.scope === "file") {
    const file = await db.query.files.findFirst({
      where: eq(files.id, input.target.fileId),
    });
    if (!file) throw new OperationError("File not found", "not_found", 404);
    if (file.kind !== "map" || !file.name.toLowerCase().endsWith(".bsp")) {
      throw new OperationError("File is not a BSP map", "invalid_request", 400);
    }
    if (file.status !== "approved") {
      throw new OperationError(
        "BSP map is not approved",
        "invalid_request",
        400,
      );
    }
  } else if (input.target.scope === "folder") {
    const folder = await db.query.folders.findFirst({
      where: eq(folders.id, input.target.folderId),
    });
    if (!folder) throw new OperationError("Folder not found", "not_found", 404);
  }

  const job = await createJob({
    type: "regenerate-previews",
    input: {
      userId: context.user.id,
      target: input.target,
    },
    userId: context.user.id,
  });
  return { jobId: job.id, target: input.target };
}
