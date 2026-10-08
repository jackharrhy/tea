import { createRequestLogger } from "evlog";
import { eq } from "drizzle-orm";
import { db } from "#db/connection.server";
import { jobs } from "#db";
import { requireSessionUser } from "#lib/session-auth.server";
import { getTusServer, tusUploadId } from "#lib/tus.server";

export async function handleTus(request: Request): Promise<Response> {
  const user = await requireSessionUser(request);
  if (!["POST", "PATCH", "HEAD", "OPTIONS"].includes(request.method)) {
    return new Response("Method not allowed", { status: 405 });
  }
  const log = createRequestLogger();
  const started = Date.now();
  log.set({
    upload: {
      userId: user.id,
      method: request.method,
      path: new URL(request.url).pathname,
      contentLength: request.headers.get("content-length"),
      offset: request.headers.get("upload-offset"),
    },
  });
  try {
    const response = await getTusServer().handleWeb(request);
    log.set({
      upload: { status: response.status, durationMs: Date.now() - started },
    });
    return response;
  } catch (error) {
    log.error(error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    log.emit();
  }
}

export async function commitUpload(
  request: Request,
  uploadId: string,
): Promise<Response> {
  const user = await requireSessionUser(request);
  if (!tusUploadId.test(uploadId))
    return new Response("Upload not found", { status: 404 });
  const id = `process-upload-${uploadId}`;
  const existing = await db.query.jobs.findFirst({ where: eq(jobs.id, id) });
  if (existing) {
    if (existing.userId !== user.id)
      return new Response("Upload not found", { status: 404 });
    return Response.json({ jobId: id }, { status: 202 });
  }
  let upload;
  try {
    upload = await getTusServer().datastore.getUpload(uploadId);
  } catch {
    return new Response("Upload not found", { status: 404 });
  }
  if (upload.metadata?.userId !== user.id)
    return new Response("Upload not found", { status: 404 });
  if (upload.size === undefined || upload.offset !== upload.size) {
    return new Response("Upload is incomplete", { status: 409 });
  }
  await db
    .insert(jobs)
    .values({
      id,
      type: "process-upload",
      userId: user.id,
      status: "pending",
      input: JSON.stringify({ uploadId }),
    })
    .onConflictDoNothing();
  return Response.json({ jobId: id }, { status: 202 });
}

export async function readUploadJob(
  request: Request,
  jobId: string,
): Promise<Response> {
  const user = await requireSessionUser(request);
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (
    !job ||
    job.userId !== user.id ||
    !["process-upload", "upload-finalize"].includes(job.type)
  ) {
    return new Response("Job not found", { status: 404 });
  }
  return Response.json(
    {
      id: job.id,
      status: job.status,
      progress: job.progress,
      progressMessage: job.progressMessage,
      error: job.error,
      output: job.output ? JSON.parse(job.output) : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
