import { db } from "#db/connection.server";
import { files, folders, fileTags, tags } from "#db";
import { eq, like, and, or, inArray, desc, lt, sql } from "drizzle-orm";
import type { FileKind } from "@tea/artbin-core/detection/kind";

export interface SearchFilesOptions {
  kind?: FileKind | FileKind[]; // Filter by file kind(s)
  query?: string; // Search filename
  tagSlug?: string; // Filter by tag
  folderIds?: string[]; // Limit to these folders (for subtree queries)
  cursor?: string; // Cursor for pagination (file ID)
  limit?: number; // Results per page
  includeAllStatuses?: boolean; // If true, include pending/rejected files
}

export interface SearchFilesResult {
  files: {
    id: string;
    path: string;
    name: string;
    kind: string | null;
    mimeType: string;
    size: number;
    width: number | null;
    height: number | null;
    hasPreview: boolean | null;
    folderId: string;
  }[];
  nextCursor: string | null;
  total: number;
}

export async function searchFiles(
  options: SearchFilesOptions,
): Promise<SearchFilesResult> {
  const { kind, query, tagSlug, folderIds, cursor, limit = 50 } = options;

  // Build conditions array
  const conditions: any[] = [];

  // Status filter: only show approved files by default
  if (!options.includeAllStatuses) {
    conditions.push(eq(files.status, "approved"));
  }

  // Kind filter
  if (kind) {
    if (Array.isArray(kind)) {
      conditions.push(inArray(files.kind, kind));
    } else {
      conditions.push(eq(files.kind, kind));
    }
  }

  // Search query
  if (query) {
    conditions.push(like(files.name, `%${query}%`));
  }

  // Folder filter
  if (folderIds && folderIds.length > 0) {
    conditions.push(inArray(files.folderId, folderIds));
  }

  // Tag filter - need a subquery
  if (tagSlug) {
    const tag = await db.query.tags.findFirst({
      where: eq(tags.slug, tagSlug),
    });

    if (tag) {
      const taggedFileIds = await db
        .select({ fileId: fileTags.fileId })
        .from(fileTags)
        .where(eq(fileTags.tagId, tag.id));

      const ids = taggedFileIds.map((r) => r.fileId);
      if (ids.length > 0) {
        conditions.push(inArray(files.id, ids));
      } else {
        // No files have this tag, return empty
        return { files: [], nextCursor: null, total: 0 };
      }
    } else {
      // Tag doesn't exist, return empty
      return { files: [], nextCursor: null, total: 0 };
    }
  }

  // Cursor pagination
  if (cursor) {
    // Get the createdAt of cursor file for consistent ordering
    const cursorFile = await db.query.files.findFirst({
      where: eq(files.id, cursor),
    });
    if (cursorFile && cursorFile.createdAt) {
      conditions.push(
        or(
          lt(files.createdAt, cursorFile.createdAt),
          and(eq(files.createdAt, cursorFile.createdAt), lt(files.id, cursor)),
        ),
      );
    }
  }

  // Execute query
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
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
      folderId: files.folderId,
    })
    .from(files)
    .where(whereClause)
    .orderBy(desc(files.createdAt), desc(files.id))
    .limit(limit + 1); // Fetch one extra to check if there's more

  // Get total count (without cursor/limit)
  const countConditions = conditions.filter((_, i) => {
    // Remove cursor condition for total count
    return !cursor || i < conditions.length - 1;
  });
  const countWhere =
    countConditions.length > 0 ? and(...countConditions) : undefined;

  const [{ count: total }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(files)
    .where(countWhere);

  // Check if there's more
  const hasMore = results.length > limit;
  const returnedFiles = hasMore ? results.slice(0, limit) : results;
  const nextCursor = hasMore
    ? returnedFiles[returnedFiles.length - 1].id
    : null;

  return {
    files: returnedFiles,
    nextCursor,
    total,
  };
}

/**
 * Get a folder and all its descendants using a recursive CTE.
 * Single query regardless of tree depth.
 */
export async function getDescendantFolderIds(
  folderId: string,
): Promise<string[]> {
  const result = db.all<{ id: string }>(
    sql`WITH RECURSIVE tree AS (
      SELECT id FROM folders WHERE id = ${folderId}
      UNION ALL
      SELECT f.id FROM folders f JOIN tree ON f.parent_id = tree.id
    ) SELECT id FROM tree`,
  );
  return result.map((r) => r.id);
}

/** Return a folder and its ancestors in breadcrumb order. */
export async function getFolderTrail(folderId: string) {
  const folder = await db.query.folders.findFirst({
    where: eq(folders.id, folderId),
    columns: { id: true, name: true, slug: true },
  });
  if (!folder) return [];

  const slugParts = folder.slug.split("/");
  const trailSlugs = slugParts.map((_, index) =>
    slugParts.slice(0, index + 1).join("/"),
  );
  const trail = await db.query.folders.findMany({
    where: inArray(folders.slug, trailSlugs),
    columns: { id: true, name: true, slug: true },
  });
  trail.toSorted((a, b) => a.slug.split("/").length - b.slug.split("/").length);
  return trail;
}

/**
 * Get all ancestor folder IDs by walking up the parent chain using a recursive CTE.
 * Includes the input folder IDs themselves.
 */
export async function getAncestorFolderIds(
  folderIds: string[],
  database = db,
): Promise<string[]> {
  if (folderIds.length === 0) return [];

  const result = database.all<{ id: string }>(
    sql`WITH RECURSIVE ancestors AS (
      SELECT value AS id FROM json_each(${JSON.stringify(folderIds)})
      UNION
      SELECT f.parent_id AS id FROM folders f JOIN ancestors a ON f.id = a.id WHERE f.parent_id IS NOT NULL
    ) SELECT DISTINCT id FROM ancestors`,
  );
  return result.map((r) => r.id);
}

export async function getFileCountsByKind(
  folderIds?: string[],
): Promise<Record<string, number>> {
  const statusFilter = eq(files.status, "approved");
  const folderFilter =
    folderIds && folderIds.length > 0
      ? inArray(files.folderId, folderIds)
      : undefined;
  const condition = folderFilter
    ? and(statusFilter, folderFilter)
    : statusFilter;

  const results = await db
    .select({
      kind: files.kind,
      count: sql<number>`count(*)`,
    })
    .from(files)
    .where(condition)
    .groupBy(files.kind);

  const counts: Record<string, number> = {
    texture: 0,
    model: 0,
    audio: 0,
    map: 0,
    archive: 0,
    config: 0,
    other: 0,
  };

  let total = 0;
  for (const row of results) {
    if (row.kind) {
      counts[row.kind] = row.count;
      total += row.count;
    }
  }
  counts.all = total;

  return counts;
}
