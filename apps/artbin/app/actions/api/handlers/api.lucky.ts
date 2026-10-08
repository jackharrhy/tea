import type * as Route from "./types.ts";
import { and, count, eq, inArray, like, ne, notLike, sql } from "drizzle-orm";
import { db } from "#db/connection.server";
import { files, folders } from "#db";
import { getUserFromRequest } from "#lib/auth.server";
import { getDescendantFolderIds } from "#lib/file-queries.server";
import { getVisibleWADLibrary, inspectWADFile } from "#lib/wad-assets.server";
import { getWADTextureHref } from "#lib/wad-paths";

interface LuckyTarget {
  href: string;
}

function getExcludedFilePath(excludeHref?: string): string | undefined {
  if (!excludeHref?.startsWith("/file/")) return undefined;
  try {
    return decodeURI(excludeHref.slice("/file/".length));
  } catch {
    return excludeHref.slice("/file/".length);
  }
}

async function findWADTextureTargets(
  folderIds?: string[],
  excludeHref?: string,
): Promise<LuckyTarget[]> {
  const conditions = [eq(files.status, "approved"), like(files.name, "%.wad")];
  if (folderIds) conditions.push(inArray(files.folderId, folderIds));

  const wadFiles = await db
    .select({ id: files.id, path: files.path, sha256: files.sha256 })
    .from(files)
    .where(and(...conditions));

  const libraries = await Promise.all(
    wadFiles.map(async (file) => {
      try {
        const contents = await inspectWADFile(file.path, file.sha256);
        return contents ? { file, contents } : null;
      } catch {
        return null;
      }
    }),
  );

  return libraries.flatMap((library) =>
    library
      ? library.contents.textures
          .map((texture) => ({
            href: getWADTextureHref(
              library.file.path,
              texture,
              library.contents.textures,
            ),
          }))
          .filter((target) => target.href !== excludeHref)
      : [],
  );
}

async function findRandomTarget(
  folderIds?: string[],
  excludeHref?: string,
): Promise<LuckyTarget | undefined> {
  const virtualTargets = await findWADTextureTargets(folderIds, excludeHref);
  const regularConditions = [
    eq(files.status, "approved"),
    notLike(files.name, "%.wad"),
  ];
  if (folderIds) regularConditions.push(inArray(files.folderId, folderIds));

  const excludedFilePath = getExcludedFilePath(excludeHref);
  if (excludedFilePath)
    regularConditions.push(ne(files.path, excludedFilePath));

  const [{ value: regularCount }] = await db
    .select({ value: count() })
    .from(files)
    .where(and(...regularConditions));

  const targetIndex = Math.floor(
    Math.random() * (regularCount + virtualTargets.length),
  );
  if (targetIndex < virtualTargets.length) return virtualTargets[targetIndex];
  if (regularCount === 0) return undefined;

  const [randomFile] = await db
    .select({ path: files.path })
    .from(files)
    .where(and(...regularConditions))
    .orderBy(sql`RANDOM()`)
    .limit(1);

  return randomFile ? { href: `/file/${randomFile.path}` } : undefined;
}

export async function action({ request }: Route.ActionArgs) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const formData = await request.formData();
  const folderIdValue = formData.get("folderId");
  const wadFileIdValue = formData.get("wadFileId");
  const excludeHrefValue = formData.get("excludeHref");
  const folderId =
    typeof folderIdValue === "string" && folderIdValue
      ? folderIdValue
      : undefined;
  const wadFileId =
    typeof wadFileIdValue === "string" && wadFileIdValue
      ? wadFileIdValue
      : undefined;
  const excludeHref =
    typeof excludeHrefValue === "string" && excludeHrefValue
      ? excludeHrefValue
      : undefined;

  if (wadFileId) {
    const library = await getVisibleWADLibrary(wadFileId, user);
    if (!library)
      return Response.json({ error: "WAD not found" }, { status: 404 });

    let targets = library.contents.textures
      .map((texture) => ({
        href: getWADTextureHref(
          library.file.path,
          texture,
          library.contents.textures,
        ),
      }))
      .filter((target) => target.href !== excludeHref);
    if (targets.length === 0 && excludeHref) {
      targets = library.contents.textures.map((texture) => ({
        href: getWADTextureHref(
          library.file.path,
          texture,
          library.contents.textures,
        ),
      }));
    }

    const target = targets[Math.floor(Math.random() * targets.length)];
    return target
      ? Response.json(target)
      : Response.json({ error: "No textures found" }, { status: 404 });
  }

  let folderIds: string[] | undefined;
  if (folderId) {
    const folder = await db.query.folders.findFirst({
      where: eq(folders.id, folderId),
      columns: { id: true },
    });
    if (!folder) {
      return Response.json({ error: "Folder not found" }, { status: 404 });
    }
    folderIds = await getDescendantFolderIds(folder.id);
  }

  let target = await findRandomTarget(folderIds, excludeHref);
  if (!target && excludeHref) target = await findRandomTarget(folderIds);

  if (!target) {
    return Response.json({ error: "No assets found" }, { status: 404 });
  }

  return Response.json(target);
}
