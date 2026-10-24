import { and, desc, eq, lt, or, sql } from "drizzle-orm";

import { files, folders } from "#db";
import { db } from "#db/connection.server";

const pageSize = 60;
const statuses = ["pending", "approved", "rejected"] as const;
type UploadStatus = (typeof statuses)[number];

export async function loadMyUploadsPage(url: URL, userId: string) {
  const rawStatus = url.searchParams.get("status") ?? "pending";
  const status: UploadStatus = statuses.includes(rawStatus as UploadStatus)
    ? (rawStatus as UploadStatus)
    : "pending";
  const cursor = url.searchParams.get("cursor") || undefined;

  const counts = await db
    .select({ status: files.status, count: sql<number>`count(*)` })
    .from(files)
    .where(eq(files.uploaderId, userId))
    .groupBy(files.status);
  const countMap: Record<UploadStatus, number> = {
    pending: 0,
    approved: 0,
    rejected: 0,
  };
  for (const row of counts) countMap[row.status] = row.count;

  const conditions = [eq(files.uploaderId, userId), eq(files.status, status)];
  if (cursor) {
    const cursorFile = await db.query.files.findFirst({
      where: eq(files.id, cursor),
    });
    if (cursorFile?.createdAt) {
      conditions.push(
        or(
          lt(files.createdAt, cursorFile.createdAt),
          and(eq(files.createdAt, cursorFile.createdAt), lt(files.id, cursor)),
        )!,
      );
    }
  }

  const rows = await db
    .select({
      id: files.id,
      path: files.path,
      name: files.name,
      kind: files.kind,
      mimeType: files.mimeType,
      size: files.size,
      width: files.width,
      height: files.height,
      hasPreview: files.hasPreview,
      status: files.status,
      folderId: files.folderId,
      createdAt: files.createdAt,
    })
    .from(files)
    .where(and(...conditions))
    .orderBy(desc(files.createdAt), desc(files.id))
    .limit(pageSize + 1);
  const hasMore = rows.length > pageSize;
  const pageFiles = hasMore ? rows.slice(0, pageSize) : rows;
  const nextCursor = hasMore ? (pageFiles.at(-1)?.id ?? null) : null;

  const folderMap: Record<string, { name: string; slug: string }> = {};
  if (status === "approved") {
    await Promise.all(
      [...new Set(pageFiles.map((file) => file.folderId))].map(
        async (folderId) => {
          const folder = await db.query.folders.findFirst({
            where: eq(folders.id, folderId),
            columns: { name: true, slug: true },
          });
          if (folder) folderMap[folderId] = folder;
        },
      ),
    );
  }

  return { files: pageFiles, countMap, status, nextCursor, folderMap };
}

export type MyUploadsPageData = Awaited<ReturnType<typeof loadMyUploadsPage>>;
