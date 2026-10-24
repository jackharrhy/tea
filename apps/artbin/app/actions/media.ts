import { basename } from "node:path";

import { and, eq, or } from "drizzle-orm";
import { openLazyFile } from "remix/fs";
import { createFileResponse } from "remix/response/file";

import { files, folders, type User } from "#db";
import { db } from "#db/connection.server";
import { getFilePath, getPreviewPath } from "#lib/files.server";
import {
  ensureBspThumbnail,
  getBspWalkabilityPath,
} from "#lib/bsp-derivatives.server";

export async function serveMediaFile(input: {
  request: Request;
  fileId: string;
  filename: string;
  user: User | null;
}): Promise<Response> {
  if (!input.user) return new Response("Unauthorized", { status: 401 });
  const visibility = input.user.isAdmin
    ? eq(files.id, input.fileId)
    : andFileVisibility(input.fileId, input.user.id);
  const file = await db.query.files.findFirst({ where: visibility });
  if (!file) return notFound();

  const searchParams = new URL(input.request.url).searchParams;
  const preview = searchParams.get("preview") === "1";
  const thumbnail = searchParams.get("thumbnail") === "1";
  if (preview && thumbnail) return notFound();
  const bsp = /\.bsp$/i.test(file.name);
  const walkabilityFilename = file.name.replace(
    /\.bsp$/i,
    ".tea-maps-walkability.json",
  );
  const walkability = bsp && input.filename === walkabilityFilename;
  const expectedFilename = walkability
    ? walkabilityFilename
    : thumbnail && bsp
      ? `${file.name}.thumbnail.webp`
      : preview
        ? `${file.name}.preview.png`
        : file.name;
  if (
    input.filename !== expectedFilename ||
    (thumbnail && !bsp) ||
    ((preview || thumbnail) && !file.hasPreview)
  )
    return notFound();

  try {
    const path = walkability
      ? getBspWalkabilityPath(file.path)
      : thumbnail
        ? await ensureBspThumbnail(file.path)
        : preview
          ? getPreviewPath(file.path)
          : getFilePath(file.path);
    const lazyFile = openLazyFile(path, {
      name: expectedFilename,
      type: walkability
        ? "application/json"
        : thumbnail
          ? "image/webp"
          : preview
            ? "image/png"
            : file.mimeType,
    });
    return await createFileResponse(lazyFile, input.request, {
      cacheControl:
        preview || thumbnail || walkability
          ? "private, no-cache"
          : "private, max-age=3600",
    });
  } catch {
    return notFound();
  }
}

export async function serveFolderPreview(input: {
  request: Request;
  folderId: string;
  filename: string;
  user: User | null;
}): Promise<Response> {
  if (!input.user) return new Response("Unauthorized", { status: 401 });
  const folder = await db.query.folders.findFirst({
    where: eq(folders.id, input.folderId),
  });
  if (!folder?.previewPath || basename(folder.previewPath) !== input.filename)
    return notFound();

  const lazyFile = openLazyFile(getFilePath(folder.previewPath), {
    name: input.filename,
    type: "image/png",
  });
  try {
    return await createFileResponse(lazyFile, input.request, {
      cacheControl: "private, no-cache",
    });
  } catch {
    return notFound();
  }
}

function andFileVisibility(fileId: string, userId: string) {
  return and(
    eq(files.id, fileId),
    or(eq(files.status, "approved"), eq(files.uploaderId, userId)),
  );
}

function notFound(): Response {
  return new Response("Media not found", { status: 404 });
}
