import { and, count, desc, eq, isNull, or, sql } from "drizzle-orm";

import { db } from "#db/connection.server";
import { folders, tags } from "#db";
import { getFileCountsByKind, searchFiles } from "#lib/file-queries.server";
import type { FileKind } from "@tea/artbin-core/detection/kind";

import type { ViewMode } from "../ui/browse-tabs.tsx";

const views = new Set<ViewMode>([
  "folders",
  "textures",
  "models",
  "maps",
  "sounds",
  "all",
]);

export async function loadFoldersPage(url: URL) {
  const candidateView = url.searchParams.get("view") ?? "folders";
  const view: ViewMode = views.has(candidateView as ViewMode)
    ? (candidateView as ViewMode)
    : "folders";
  const query = url.searchParams.get("q")?.trim() ?? "";
  const tagSlug = url.searchParams.get("tag")?.trim() || null;
  const cursor = url.searchParams.get("cursor")?.trim() || undefined;

  const [fileCounts, allTags] = await Promise.all([
    getFileCountsByKind(),
    db.query.tags.findMany({ orderBy: [tags.name] }),
  ]);

  const [{ value: folderCount }] = await db
    .select({ value: count() })
    .from(folders)
    .where(
      and(isNull(folders.parentId), sql`substr(${folders.slug}, 1, 1) <> '_'`),
    );

  if (view === "folders") {
    const rootFolders = await db.query.folders.findMany({
      where: and(
        isNull(folders.parentId),
        sql`substr(${folders.slug}, 1, 1) <> '_'`,
      ),
      orderBy: [desc(folders.createdAt)],
    });
    const folderCounts = Object.fromEntries(
      await Promise.all(
        rootFolders.map(async (folder) => {
          const [{ total }] = await db
            .select({
              total: sql<number>`coalesce(sum(${folders.fileCount}), 0)`,
            })
            .from(folders)
            .where(
              or(
                eq(folders.slug, folder.slug),
                sql`${folders.slug} LIKE ${`${folder.slug}/%`}`,
              ),
            );
          return [folder.id, total ?? 0] as const;
        }),
      ),
    );

    return {
      view,
      query,
      tagSlug,
      folders: rootFolders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        slug: folder.slug,
        previewPath: folder.previewPath,
      })),
      folderCounts,
      counts: {
        folders: folderCount,
        textures: fileCounts.texture,
        models: fileCounts.model,
        maps: fileCounts.map,
        sounds: fileCounts.audio,
        all: fileCounts.all,
      },
      tags: allTags.map(({ id, name, slug }) => ({ id, name, slug })),
      searchResults: null,
    };
  }

  const kindMap: Record<Exclude<ViewMode, "folders">, FileKind | FileKind[]> = {
    textures: "texture",
    models: "model",
    maps: "map",
    sounds: "audio",
    all: ["texture", "model", "audio", "map", "archive", "config", "other"],
  };
  const searchResults = await searchFiles({
    kind: kindMap[view],
    query: query || undefined,
    tagSlug: tagSlug || undefined,
    cursor,
    limit: 50,
  });

  return {
    view,
    query,
    tagSlug,
    folders: [],
    folderCounts: {} as Record<string, number>,
    counts: {
      folders: folderCount,
      textures: fileCounts.texture,
      models: fileCounts.model,
      maps: fileCounts.map,
      sounds: fileCounts.audio,
      all: fileCounts.all,
    },
    tags: allTags.map(({ id, name, slug }) => ({ id, name, slug })),
    searchResults,
  };
}

export type FoldersPageData = Awaited<ReturnType<typeof loadFoldersPage>>;
