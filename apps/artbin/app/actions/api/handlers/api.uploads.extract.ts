import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#db/connection.server";
import { folders, jobs } from "#db";
import { requireSessionAdmin } from "#lib/session-auth.server";
import { getTusServer, tusUploadId } from "#lib/tus.server";
import { cleanFolderSlug } from "@tea/artbin-core/detection/filenames";

const destinationSchema = z
  .object({
    folderName: z.string().trim().min(1).max(255),
    folderSlug: z
      .string()
      .min(1)
      .max(255)
      .refine((slug) => cleanFolderSlug(slug) === slug),
    parentFolderId: z.string().min(1).optional(),
  })
  .strict();

/** Extract an owned, analyzed upload. Clients never supply a temporary filesystem path. */
export async function extractUpload(
  request: Request,
  uploadId: string,
): Promise<Response> {
  const user = await requireSessionAdmin(request);
  if (!tusUploadId.test(uploadId))
    return new Response("Upload not found", { status: 404 });
  const parsed = destinationSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return new Response("Invalid destination", { status: 400 });
  const id = `upload-extract-${uploadId}`;
  const existing = await db.query.jobs.findFirst({ where: eq(jobs.id, id) });
  if (existing) {
    if (existing.userId !== user.id)
      return new Response("Upload not found", { status: 404 });
    return Response.json({ jobId: id }, { status: 202 });
  }
  const analysis = await db.query.jobs.findFirst({
    where: eq(jobs.id, `process-upload-${uploadId}`),
  });
  if (!analysis || analysis.userId !== user.id)
    return new Response("Upload not found", { status: 404 });
  if (analysis.status !== "completed")
    return new Response("Archive analysis is not complete", { status: 409 });
  let upload;
  try {
    upload = await getTusServer().datastore.getUpload(uploadId);
  } catch {
    return new Response("Upload has expired; please upload again", {
      status: 410,
    });
  }
  if (
    upload.metadata?.userId !== user.id ||
    upload.metadata.purpose !== "archive"
  )
    return new Response("Not an archive upload", { status: 400 });
  const { folderName, folderSlug, parentFolderId } = parsed.data;
  const parent = parentFolderId
    ? await db.query.folders.findFirst({
        where: eq(folders.id, parentFolderId),
      })
    : undefined;
  if (parentFolderId && (!parent || parent.slug.startsWith("_")))
    return new Response("Parent folder not found", { status: 404 });
  const targetFolderSlug = parent ? `${parent.slug}/${folderSlug}` : folderSlug;
  if (
    await db.query.folders.findFirst({
      where: eq(folders.slug, targetFolderSlug),
    })
  )
    return new Response("Folder already exists", { status: 409 });
  await db
    .insert(jobs)
    .values({
      id,
      type: "extract-archive",
      userId: user.id,
      input: JSON.stringify({
        tempFile: upload.storage!.path,
        originalName: upload.metadata.path,
        targetFolderSlug,
        targetFolderName: folderName,
        parentFolderId: parent?.id ?? null,
        userId: user.id,
        skipTempCleanup: true,
      }),
    })
    .onConflictDoNothing();
  return Response.json({ jobId: id }, { status: 202 });
}
