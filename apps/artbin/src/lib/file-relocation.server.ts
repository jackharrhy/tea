import { eq } from "drizzle-orm";
import { files, folders, type File } from "#db";
import { dirname } from "node:path";
import { db } from "#db/connection.server";
import { moveFile } from "./files.server.ts";

/** Relocate the original, its derivatives, and its indexed location together. */
export function relocateFile(
  file: Pick<File, "id" | "path">,
  destination: Pick<File, "path" | "folderId"> & { status?: File["status"] },
): void {
  let moved = false;
  try {
    db.transaction(
      (tx) => {
        const current = tx
          .select()
          .from(files)
          .where(eq(files.id, file.id))
          .get();
        if (!current || current.path !== file.path)
          throw new Error(
            "File changed while preparing the move; please retry",
          );
        const parent = tx
          .select()
          .from(folders)
          .where(eq(folders.id, destination.folderId))
          .get();
        if (!parent || parent.slug !== dirname(destination.path))
          throw new Error(
            "Destination folder changed while preparing the move; please retry",
          );
        tx.update(files).set(destination).where(eq(files.id, file.id)).run();
        moveFile(file.path, destination.path);
        moved = true;
      },
      { behavior: "immediate" },
    );
  } catch (error) {
    if (moved) {
      try {
        moveFile(destination.path, file.path);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "File relocation and rollback failed",
          {
            cause: rollbackError,
          },
        );
      }
    }
    throw error;
  }
}
