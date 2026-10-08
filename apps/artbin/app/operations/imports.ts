import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";

import { z } from "zod";

import { createJob } from "#lib/jobs.server";
import { queueRemoteImports } from "#lib/remote-import-queue.server";

import type { OperationContext } from "./context.ts";
import { requireOperationAdmin } from "./context.ts";
import { OperationError } from "./errors.ts";

export const importQueueInput = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("remote"),
      sourceUrls: z.array(z.url()).min(1).max(20),
      targetFolderId: z.string().min(1).nullable().default(null),
      confirm: z.literal(true),
    })
    .strict(),
  z
    .object({
      kind: z.literal("folder"),
      sourcePath: z.string().min(1),
      collectionName: z.string().min(1).optional(),
      confirm: z.literal(true),
    })
    .strict(),
  z
    .object({
      kind: z.literal("catalog"),
      source: z.enum([
        "texturetown",
        "texture-station",
        "sadgrl",
        "katamari",
        "early-web-graphics",
      ]),
      confirm: z.literal(true),
    })
    .strict(),
]);

export async function queueImportOperation(
  context: OperationContext,
  input: z.output<typeof importQueueInput>,
) {
  requireOperationAdmin(context);
  if (input.kind === "remote") {
    try {
      return await queueRemoteImports({
        sourceUrls: input.sourceUrls.join("\n"),
        targetFolderId: input.targetFolderId,
        userId: context.user.id,
      });
    } catch (error) {
      throw new OperationError(
        error instanceof Error ? error.message : "Invalid import URL",
        "invalid_request",
        400,
      );
    }
  }

  if (input.kind === "folder") {
    if (
      !existsSync(input.sourcePath) ||
      !(await stat(input.sourcePath).catch(() => null))?.isDirectory()
    ) {
      throw new OperationError(
        "The source folder does not exist",
        "invalid_request",
        400,
      );
    }
    const name = input.collectionName?.trim() || basename(input.sourcePath);
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!slug)
      throw new OperationError(
        "Collection name is invalid",
        "invalid_request",
        400,
      );
    const job = await createJob({
      type: "folder-import",
      input: {
        sourcePath: input.sourcePath,
        targetFolderSlug: slug,
        targetFolderName: name,
        userId: context.user.id,
      },
      userId: context.user.id,
    });
    return { count: 1, jobIds: [job.id] };
  }

  const job = await createJob({
    type: `${input.source}-import`,
    input: { userId: context.user.id },
    userId: context.user.id,
  });
  return { count: 1, jobIds: [job.id] };
}
