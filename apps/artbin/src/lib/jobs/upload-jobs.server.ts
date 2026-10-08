import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { createHash } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "#db/connection.server";
import { files, folders, jobs, users, type Job } from "#db";
import {
  cleanFolderPath,
  cleanFolderSlug,
} from "@artbin/core/detection/filenames";
import { registerJobHandler, updateJobProgress } from "../jobs.server.ts";
import { getTusServer, uploadMetadataSchema } from "../tus.server.ts";
import {
  finalizeFolders,
  getFilePath,
  getOrCreateFolder,
  ingestFile,
  sanitizeFilename,
} from "../files.server.ts";
import { createUploadSession } from "../inbox.server.ts";
import { isBspFile } from "../game-textures.server.ts";
import {
  parseBspTextures,
  isQuakePaletteFormat,
} from "@jackharrhy/worldview/core";
import { resolveApprovedBspPalette } from "../bsp-assets.server.ts";
import { refreshBspDependencyManifest } from "../bsp-derivatives.server.ts";
import {
  parseArchive,
  getFileEntries,
  getDirectoryPaths,
} from "../archives.server.ts";

export async function handleUpload(job: Job, input: Record<string, unknown>) {
  const uploadId = z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .parse(input.uploadId);
  const user = await db.query.users.findFirst({
    where: eq(users.id, job.userId!),
  });
  if (!user) throw new Error("Upload owner no longer exists");
  const upload = await getTusServer().datastore.getUpload(uploadId);
  const { userId: _owner, ...submitted } = upload.metadata!;
  void _owner;
  const metadata = uploadMetadataSchema.parse(submitted);
  if (upload.offset !== upload.size || upload.metadata?.userId !== user.id)
    throw new Error("Upload is incomplete or belongs to another user");
  const buffer = await readFile(upload.storage!.path);
  if (createHash("sha256").update(buffer).digest("hex") !== metadata.sha256)
    throw new Error("Uploaded file checksum does not match");
  if (metadata.purpose === "archive") {
    if (!user.isAdmin)
      throw new Error("Admin access required for archive uploads");
    const archive = await parseArchive(upload.storage!.path);
    const entries = getFileEntries(archive.entries);
    const name = metadata.path.replace(/\.[^.]+$/, "");
    return {
      purpose: "archive",
      archiveAnalysis: {
        originalName: metadata.path,
        archiveType: archive.type,
        totalFiles: entries.length,
        totalDirs: getDirectoryPaths(archive.entries).length,
        suggestedName: name
          .replace(/[-_]/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase()),
        suggestedSlug: cleanFolderSlug(name),
        sampleFiles: entries.slice(0, 20).map((e) => e.name),
      },
    };
  }
  const fileDir = dirname(metadata.path);
  const folderSlug = cleanFolderPath(
    fileDir === "."
      ? metadata.parentFolder
      : `${metadata.parentFolder}/${fileDir}`,
  );
  const parent = await db.query.folders.findFirst({
    where: eq(folders.slug, metadata.parentFolder),
  });
  if (!parent) throw new Error(`Folder not found: ${metadata.parentFolder}`);
  let folder = user.isAdmin
    ? parent
    : await createUploadSession(
        user.id,
        metadata.batchId ? `${user.id}-${metadata.batchId}` : uploadId,
      );
  if (fileDir !== ".") {
    for (const part of fileDir.split("/")) {
      const slug = `${folder.slug}/${cleanFolderSlug(part)}`;
      const id = await getOrCreateFolder(slug, part, folder.id);
      folder = { id, slug };
    }
  }
  const destination = await db.query.folders.findFirst({
    where: eq(folders.slug, folderSlug),
  });
  const targetPath = `${folder.slug}/${sanitizeFilename(basename(metadata.path))}`;
  const existing = await db.query.files.findFirst({
    where: eq(files.path, targetPath),
  });
  if (
    existing &&
    (existing.sha256 !== metadata.sha256 || existing.size !== buffer.length)
  )
    throw new Error(
      `A different file already exists at ${targetPath}; rename or remove it first`,
    );
  // A restarted worker can encounter a file it indexed before its job status was saved.
  if (existing) {
    const saved = await readFile(getFilePath(targetPath));
    if (createHash("sha256").update(saved).digest("hex") !== metadata.sha256)
      throw new Error(
        `Stored file differs from its indexed checksum: ${targetPath}`,
      );
    if (/\.bsp$/i.test(existing.name))
      await refreshBspDependencyManifest(targetPath, buffer);
  }
  let file: { name: string; path: string; fileId: string };
  if (existing) {
    file = { name: existing.name, path: existing.path, fileId: existing.id };
  } else {
    const result = await ingestFile({
      buffer,
      fileName: basename(metadata.path),
      folderSlug: folder.slug,
      folderId: folder.id,
      source: "upload",
      uploaderId: user.id,
      sourceArchive: metadata.sourceArchive,
      status: user.isAdmin ? "approved" : "pending",
      suggestedFolderId: user.isAdmin ? null : (destination?.id ?? parent.id),
    });
    if (result.isErr()) throw result.error;
    file = result.value;
  }
  const bsp =
    user.isAdmin && /\.bsp$/i.test(file.name) && isBspFile(buffer)
      ? parseBspTextures(buffer)
      : null;
  const canExtract =
    bsp &&
    bsp.textures.length > 0 &&
    (!isQuakePaletteFormat(bsp.identification.format) ||
      (await resolveApprovedBspPalette(file)));
  if (canExtract) {
    const name = file.name.replace(/\.bsp$/i, "");
    await db
      .insert(jobs)
      .values({
        id: `upload-bsp-${uploadId}`,
        type: "extract-bsp",
        userId: user.id,
        input: JSON.stringify({
          bspPath: getFilePath(file.path),
          targetFolderSlug: `${folder.slug}/${cleanFolderSlug(name)}-textures`,
          targetFolderName: `${name} Textures`,
          userId: user.id,
        }),
      })
      .onConflictDoNothing();
  }
  return {
    purpose: "file",
    path: metadata.path,
    fileId: file.fileId,
    pendingUpload: !user.isAdmin,
  };
}

export async function handleFinalize(job: Job, input: Record<string, unknown>) {
  const slug = z.string().min(1).parse(input.parentFolder);
  const prefix = `${slug.replace(/[\\%_]/g, "\\$&")}/%`;
  const descendants = await db.query.folders.findMany({
    where: or(
      eq(folders.slug, slug),
      sql`${folders.slug} LIKE ${prefix} ESCAPE '\\'`,
    ),
  });
  const errors: string[] = [];
  await finalizeFolders(
    descendants.map((folder) => folder.id),
    (error, id) => errors.push(`${id}: ${error.message}`),
    (current, total) =>
      updateJobProgress(
        job.id,
        total ? Math.floor((current / total) * 100) : 100,
        `Refreshing folder previews: ${current}/${total}`,
      ),
  );
  if (errors.length)
    throw new Error(`Folder finalization failed: ${errors.join("; ")}`);
  return { finalized: descendants.length };
}

registerJobHandler("process-upload", handleUpload);
registerJobHandler("upload-finalize", handleFinalize);

export async function recoverUploadJobs(): Promise<void> {
  await db
    .update(jobs)
    .set({ status: "pending", startedAt: null })
    .where(
      and(
        eq(jobs.status, "running"),
        inArray(jobs.type, ["process-upload", "upload-finalize"]),
      ),
    );
}
