import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { FileKind } from "@tea/artbin-core/detection/kind";
import type { User } from "#db";
import { files, folders, remoteImports, tags } from "#db";
import { db } from "#db/connection.server";
import {
  getDescendantFolderIds,
  getFileCountsByKind,
  getFolderTrail,
  searchFiles,
} from "#lib/file-queries.server";
import {
  getVisibleWADLibraryByPath,
  inspectWADFile,
  isWADFilename,
} from "#lib/wad-assets.server";

import type { ViewMode } from "../ui/browse-tabs.tsx";

const views = new Set<ViewMode>([
  "folders",
  "textures",
  "models",
  "maps",
  "sounds",
  "all",
]);

export interface VirtualWadLibrary {
  id: string;
  path: string;
  name: string;
  version: "WAD2" | "WAD3";
  textureCount: number;
  previewTextures: Array<{ index: number; name: string }>;
}

export async function loadFolderPage(url: URL, path: string, user: User) {
  const folder = await db.query.folders.findFirst({
    where: eq(folders.slug, path),
  });
  if (!folder) {
    const library = await getVisibleWADLibraryByPath(path, user);
    if (!library) return null;
    return {
      page: "wad" as const,
      ...library,
      folderTrail: await getFolderTrail(library.file.folderId),
      query: url.searchParams.get("q")?.trim() ?? "",
    };
  }

  if (folder.slug.startsWith("_")) return null;

  const candidateView = url.searchParams.get("view") ?? "folders";
  const view: ViewMode = views.has(candidateView as ViewMode)
    ? (candidateView as ViewMode)
    : "folders";
  const query = url.searchParams.get("q")?.trim() ?? "";
  const tagSlug = url.searchParams.get("tag")?.trim() || null;
  const cursor = url.searchParams.get("cursor")?.trim() || undefined;
  const slugParts = folder.slug.split("/");
  const ancestorSlugs = slugParts
    .slice(0, -1)
    .map((_, index) => slugParts.slice(0, index + 1).join("/"));

  const [
    remoteImport,
    ancestors,
    descendantFolderIds,
    allTags,
    childFolders,
    allFolders,
  ] = await Promise.all([
    db.query.remoteImports.findFirst({
      where: eq(remoteImports.folderId, folder.id),
      orderBy: (table, { desc: descending }) => [descending(table.updatedAt)],
      columns: {
        provider: true,
        externalId: true,
        sourceUrl: true,
        title: true,
        author: true,
        game: true,
      },
    }),
    ancestorSlugs.length
      ? db.query.folders.findMany({
          where: inArray(folders.slug, ancestorSlugs),
          columns: { id: true, name: true, slug: true },
        })
      : Promise.resolve([]),
    getDescendantFolderIds(folder.id),
    db.query.tags.findMany({ orderBy: [tags.name] }),
    db.query.folders.findMany({
      where: and(
        eq(folders.parentId, folder.id),
        sql`substr(${folders.slug}, 1, 1) <> '_'`,
      ),
      orderBy: [folders.name],
    }),
    user.isAdmin
      ? db.query.folders.findMany({
          where: sql`substr(${folders.slug}, 1, 1) <> '_'`,
          orderBy: [folders.slug],
        })
      : Promise.resolve([]),
  ]);
  ancestors.toSorted(
    (a, b) => a.slug.split("/").length - b.slug.split("/").length,
  );
  const fileCounts = await getFileCountsByKind(descendantFolderIds);

  const shared = {
    page: "folder" as const,
    folder,
    remoteImport: remoteImport ?? null,
    ancestors,
    childFolders,
    allFolders: allFolders.map(({ id, name, slug, parentId }) => ({
      id,
      name,
      slug,
      parentId,
    })),
    view,
    query,
    tagSlug,
    tags: allTags.map(({ id, name, slug }) => ({ id, name, slug })),
  };

  if (view === "folders") {
    const folderFiles = await db
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
        sha256: files.sha256,
      })
      .from(files)
      .where(and(eq(files.folderId, folder.id), eq(files.status, "approved")))
      .orderBy(desc(files.createdAt))
      .limit(100);

    const wadLibraries = (
      await Promise.all(
        folderFiles
          .filter((file) => isWADFilename(file.name))
          .map(async (file) => {
            try {
              const contents = await inspectWADFile(file.path, file.sha256);
              if (!contents) return null;
              return {
                id: file.id,
                path: file.path,
                name: file.name,
                version: contents.version,
                textureCount: contents.textures.length,
                previewTextures: contents.textures
                  .slice(0, 4)
                  .map(({ index, name }) => ({ index, name })),
              } satisfies VirtualWadLibrary;
            } catch {
              return null;
            }
          }),
      )
    ).filter((library): library is VirtualWadLibrary => library !== null);

    return {
      ...shared,
      fileCounts: {
        ...fileCounts,
        folders: childFolders.length + wadLibraries.length,
      } as Record<string, number>,
      files: folderFiles,
      wadLibraries,
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
    folderIds: descendantFolderIds,
    cursor,
    limit: 50,
  });

  return {
    ...shared,
    fileCounts: { ...fileCounts, folders: childFolders.length } as Record<
      string,
      number
    >,
    files: [],
    wadLibraries: [] as VirtualWadLibrary[],
    searchResults,
  };
}

export type FolderPageData = NonNullable<
  Awaited<ReturnType<typeof loadFolderPage>>
>;
export type DirectoryPageData = Extract<FolderPageData, { page: "folder" }>;
export type WadPageData = Extract<FolderPageData, { page: "wad" }>;
