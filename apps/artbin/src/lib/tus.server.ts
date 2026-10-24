import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { Server } from "@tus/server";
import { FileStore } from "@tus/file-store";
import { z } from "zod";
import { TEMP_DIR } from "./files.server.ts";
import { requireSessionUser } from "./session-auth.server.ts";
import { cleanFolderPath } from "@tea/artbin-core/detection/filenames";
import { eq } from "drizzle-orm";
import { db } from "#db/connection.server";
import { jobs } from "#db";

const parentFolder = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) => cleanFolderPath(value) === value && !value.startsWith("_"),
  );
const uploadPath = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    (value) =>
      !value.includes("\\") &&
      !value.startsWith("/") &&
      value.split("/").every((part) => part && part !== "." && part !== ".."),
  );
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const uploadMetadataSchema = z.discriminatedUnion("purpose", [
  z
    .object({
      purpose: z.literal("file"),
      parentFolder,
      path: uploadPath,
      sha256,
      sourceArchive: z.string().max(255).optional(),
      batchId: z.string().uuid().optional(),
    })
    .strict(),
  z
    .object({
      purpose: z.literal("archive"),
      path: uploadPath.refine(
        (path) => !path.includes("/") && /\.(pak|pk3|zip)$/i.test(path),
      ),
      sha256,
    })
    .strict(),
]);

export const tusUploadId = /^[a-f0-9]{32}$/;
let server: Server | undefined;

export function getTusServer(): Server {
  server ??= new Server({
    path: "/api/uploads",
    datastore: new FileStore({ directory: join(TEMP_DIR, "tus") }),
    maxSize: 512 * 1024 * 1024,
    relativeLocation: true,
    async onIncomingRequest(request, id) {
      const user = await requireSessionUser(request);
      if (request.method !== "POST" && id) {
        if (!tusUploadId.test(id))
          throw { status_code: 404, body: "Upload not found" };
        const upload = await getTusServer().datastore.getUpload(id);
        if (upload.metadata?.userId !== user.id)
          throw { status_code: 404, body: "Upload not found" };
      }
    },
    async onUploadCreate(request, upload) {
      const user = await requireSessionUser(request);
      const parsed = uploadMetadataSchema.safeParse(upload.metadata);
      if (!parsed.success || upload.size === undefined) {
        throw {
          status_code: 400,
          body: "Invalid upload metadata or missing Upload-Length",
        };
      }
      if (parsed.data.purpose === "archive" && !user.isAdmin)
        throw {
          status_code: 403,
          body: "Admin access required for archive uploads",
        };
      return { metadata: { ...parsed.data, userId: user.id } };
    },
  });
  return server;
}

// Retain failed uploads for a day; never expire bytes belonging to a queued/running job.
export async function cleanupTusUploads(): Promise<void> {
  const store = getTusServer().datastore as FileStore;
  await mkdir(store.directory, { recursive: true });
  const ids = await store.configstore.list!();
  for (const id of ids) {
    if (!tusUploadId.test(id)) continue;
    const upload = await store.configstore.get(id);
    if (!upload) continue;
    const job = await db.query.jobs.findFirst({
      where: eq(jobs.id, `process-upload-${id}`),
    });
    if (job?.status === "pending" || job?.status === "running") continue;
    const extraction = await db.query.jobs.findFirst({
      where: eq(jobs.id, `upload-extract-${id}`),
    });
    if (extraction?.status === "pending" || extraction?.status === "running")
      continue;
    const expired =
      Date.now() - Date.parse(upload.creation_date ?? "") > 24 * 60 * 60 * 1000;
    const consumed =
      job?.status === "completed" &&
      (upload.metadata?.purpose !== "archive" ||
        extraction?.status === "completed");
    if (consumed || expired) await store.remove(id);
  }
}
