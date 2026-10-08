import type * as Route from "./types.ts";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireSessionUser } from "#lib/session-auth.server";
import { db } from "#db/connection.server";
import { folders } from "#db";
import { createJob } from "#lib/jobs.server";
import { cleanFolderPath } from "@artbin/core/detection/filenames";

export async function action({ request }: Route.ActionArgs) {
  const user = await requireSessionUser(request);
  if (!user.isAdmin) return Response.json({ finalized: 0 });
  const parsed = z
    .object({
      parentFolder: z
        .string()
        .min(1)
        .refine((slug) => cleanFolderPath(slug) === slug),
    })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Invalid folder", { status: 400 });
  const folder = await db.query.folders.findFirst({
    where: eq(folders.slug, parsed.data.parentFolder),
  });
  if (!folder) return new Response("Folder not found", { status: 404 });
  const job = await createJob({
    type: "upload-finalize",
    userId: user.id,
    input: parsed.data,
  });
  return Response.json({ jobId: job.id }, { status: 202 });
}
