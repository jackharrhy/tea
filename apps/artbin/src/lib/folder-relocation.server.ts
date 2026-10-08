import { dirname, join } from "node:path";
import { existsSync, renameSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import type { AppDb } from "#db/connection.server";
import { files, folders, type Folder } from "#db";
import { ensureDir, UPLOADS_DIR } from "./files.server.ts";
import {
  FOLDER_PREVIEW_FILENAME,
  getFolderPreviewPath,
} from "./folder-preview.server.ts";

export interface FolderRelocationDeps {
  db?: AppDb;
  uploadsDir?: string;
  exists?: (path: string) => boolean;
  rename?: (from: string, to: string) => void;
  ensureDir?: (path: string) => Promise<void>;
  generatePreview?: (folderId: string) => Promise<string | null>;
}

/** The only writer of existing folder slugs and their descendant paths. */
export async function relocateFolder(
  database: AppDb,
  folder: Folder,
  destination: { slug: string; name: string; parentId: string | null },
  deps: FolderRelocationDeps,
): Promise<{ updatedFolders: number; updatedFiles: number }> {
  const uploadsDir = deps.uploadsDir ?? UPLOADS_DIR;
  const exists = deps.exists ?? existsSync;
  const moveDirectory = deps.rename ?? renameSync;
  const from = join(uploadsDir, folder.slug);
  const to = join(uploadsDir, destination.slug);
  const prefix = `${folder.slug}/`;
  const descendants = sql`substr(${folders.slug}, 1, ${prefix.length}) = ${prefix}`;
  const containedFiles = sql`substr(${files.path}, 1, ${prefix.length}) = ${prefix}`;
  await (deps.ensureDir ?? ensureDir)(dirname(to));
  let moved = false;
  try {
    // No await between the path updates and the single filesystem rename. A failed
    // rename rolls SQLite back; a failed commit restores the directory below.
    return database.transaction(
      (tx) => {
        const current = tx
          .select()
          .from(folders)
          .where(eq(folders.id, folder.id))
          .get();
        if (
          !current ||
          current.slug !== folder.slug ||
          current.parentId !== folder.parentId
        )
          throw new Error(
            "Folder changed while preparing the move; please retry",
          );
        if (destination.parentId) {
          const parent = tx
            .select()
            .from(folders)
            .where(eq(folders.id, destination.parentId))
            .get();
          if (!parent || dirname(destination.slug) !== parent.slug)
            throw new Error(
              "Destination folder changed while preparing the move; please retry",
            );
          if (parent.id === folder.id || parent.slug.startsWith(prefix))
            throw new Error("Cannot move folder into its own descendant");
        }
        if (
          tx
            .select()
            .from(folders)
            .where(eq(folders.slug, destination.slug))
            .get()
        )
          throw new Error(`A folder already exists at "${destination.slug}"`);
        if (exists(to))
          throw new Error(`Directory already exists at "${destination.slug}"`);
        const sourceExists = exists(from);
        if (
          !sourceExists &&
          (current.previewPath ||
            tx
              .select({ id: files.id })
              .from(files)
              .where(containedFiles)
              .limit(1)
              .get())
        )
          throw new Error(`Source directory is missing: ${folder.slug}`);

        const childSlug = sql`${destination.slug} || substr(${folders.slug}, ${folder.slug.length + 1})`;
        const updatedFolders = tx
          .update(folders)
          .set({
            slug: childSlug,
            previewPath: sql`CASE WHEN ${folders.previewPath} IS NULL THEN NULL ELSE ${childSlug} || ${"/" + FOLDER_PREVIEW_FILENAME} END`,
          })
          .where(descendants)
          .run().changes;
        const updatedFiles = tx
          .update(files)
          .set({
            path: sql`${destination.slug} || substr(${files.path}, ${folder.slug.length + 1})`,
          })
          .where(containedFiles)
          .run().changes;
        tx.update(folders)
          .set({
            ...destination,
            previewPath: current.previewPath
              ? getFolderPreviewPath(destination.slug)
              : null,
          })
          .where(eq(folders.id, folder.id))
          .run();
        if (sourceExists) {
          moveDirectory(from, to);
          moved = true;
        }
        return { updatedFolders, updatedFiles };
      },
      { behavior: "immediate" },
    );
  } catch (error) {
    if (moved) {
      try {
        moveDirectory(to, from);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `Folder move failed and directory rollback failed: ${to} -> ${from}`,
          { cause: rollbackError },
        );
      }
    }
    throw error;
  }
}
