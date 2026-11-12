import { CommunityError } from "./community.ts";
import type { Database, Member } from "./community.ts";

export function orphanCleanupSchema(db: Database) {
  db.all(
    "CREATE TABLE IF NOT EXISTS orphan_cleanup_objects(storage_path TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS archive_staging_objects(storage_path TEXT PRIMARY KEY);",
  );
}
export function createOrphanCleanup(
  db: Database,
  admin: (id: number) => Member,
) {
  function authorize(actorId: number | null) {
    if (actorId === null)
      throw new CommunityError(403, "Admin access required");
    admin(actorId);
  }
  function reserved(path: string) {
    return (
      db.all(
        `SELECT storage_path FROM media_transfers WHERE storage_path=?
      UNION ALL SELECT old_path FROM media_move_files WHERE old_path=? OR new_path=?
      UNION ALL SELECT storage_path FROM account_cleanup_objects WHERE storage_path=?
      UNION ALL SELECT storage_path FROM archive_staging_objects WHERE storage_path=? LIMIT 1`,
        path,
        path,
        path,
        path,
        path,
      ).length > 0
    );
  }
  return {
    reserveArchiveObject(path: string) {
      if (
        db.all(
          "SELECT storage_path FROM orphan_cleanup_objects WHERE storage_path=?",
          path,
        ).length
      )
        throw new CommunityError(
          409,
          "This storage path is reserved for orphan cleanup",
        );
      db.all(
        "INSERT INTO archive_staging_objects VALUES(?) ON CONFLICT DO NOTHING",
        path,
      );
    },
    releasePublishedArchiveObject(path: string) {
      db.all(
        "DELETE FROM archive_staging_objects WHERE storage_path=? AND storage_path IN (SELECT storage_path FROM media)",
        path,
      );
    },
    beginOrphanCleanup(actorId: number | null, path: string) {
      authorize(actorId);
      const parts = path.split("/");
      if (
        parts.length !== 2 ||
        parts.some((part) => !part || part.startsWith("."))
      )
        throw new CommunityError(422, "Invalid member media path");
      return db.transaction(() => {
        if (
          db.all("SELECT id FROM media WHERE storage_path=?", path).length ||
          reserved(path)
        )
          return false;
        return (
          db.all(
            "INSERT INTO orphan_cleanup_objects VALUES(?) ON CONFLICT DO NOTHING RETURNING storage_path",
            path,
          ).length > 0
        );
      });
    },
    pendingOrphanCleanup() {
      return db.all(
        "SELECT storage_path FROM orphan_cleanup_objects ORDER BY storage_path LIMIT 100",
      );
    },
    finishOrphanCleanup(path: string) {
      db.all("DELETE FROM orphan_cleanup_objects WHERE storage_path=?", path);
    },
    hasOrphanCleanup() {
      return (
        db.all("SELECT storage_path FROM orphan_cleanup_objects LIMIT 1")
          .length > 0
      );
    },
    adminMediaRecords(actorId: number | null) {
      authorize(actorId);
      return db.all("SELECT id,storage_path FROM media ORDER BY id");
    },
    removeMissingMediaRecord(
      actorId: number | null,
      mediaId: number,
      path: string,
    ) {
      authorize(actorId);
      return db.transaction(() => {
        if (
          reserved(path) ||
          db.all(
            "SELECT storage_path FROM orphan_cleanup_objects WHERE storage_path=?",
            path,
          ).length
        )
          return false;
        return (
          db.all(
            "DELETE FROM media WHERE id=? AND storage_path=? RETURNING id",
            mediaId,
            path,
          ).length > 0
        );
      });
    },
  };
}
