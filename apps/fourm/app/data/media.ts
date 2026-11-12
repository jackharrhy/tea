import { CommunityError } from "./community.ts";
import type { Database, Member } from "./community.ts";

export const storageLimit = 500 * 1024 * 1024;
export const uploadLimit = 10 * 1024 * 1024;
export function createMedia(db: Database, member: (id: number) => Member) {
  db.all(`CREATE TABLE IF NOT EXISTS media_transfers (
    storage_path TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
    mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, state TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );`);
  return {
    media(actorId: number) {
      member(actorId);
      const items = db.all(
        "SELECT id,storage_path,mime_type,size_bytes,alt_text FROM media WHERE user_id=? ORDER BY id DESC",
        actorId,
      );
      const storageUsed = items.reduce(
        (sum, row) => sum + Number(row.size_bytes),
        0,
      );
      return {
        items,
        storage_used: storageUsed,
        storage_limit: storageLimit,
        storage_pct: (storageUsed / storageLimit) * 100,
      };
    },
    publishedMedia(path: string) {
      const row = db.all(
        "SELECT m.* FROM media m JOIN users u ON u.id=m.user_id WHERE storage_path=? AND u.is_disabled=0",
        path,
      )[0];
      if (!row) throw new CommunityError(404, "Media not found");
      return row;
    },
    reserveUpload(actorId: number, path: string, mime: string, size: number) {
      member(actorId);
      if (!Number.isSafeInteger(size) || size < 0 || size > uploadLimit)
        throw new CommunityError(413, "Files must be 10 MB or smaller");
      return db.transaction(() => {
        const used =
          Number(
            db.all(
              "SELECT coalesce(sum(size_bytes),0) AS total FROM media WHERE user_id=?",
              actorId,
            )[0].total,
          ) +
          Number(
            db.all(
              "SELECT coalesce(sum(size_bytes),0) AS total FROM media_transfers WHERE user_id=? AND state='uploading'",
              actorId,
            )[0].total,
          );
        if (used + size > storageLimit)
          throw new CommunityError(409, "Your 500 MB storage is full");
        db.all(
          "INSERT INTO media_transfers VALUES(?,?,?,?,'uploading',?)",
          path,
          actorId,
          mime,
          size,
          Date.now() + 3600000,
        );
      });
    },
    finishUpload(actorId: number, path: string) {
      member(actorId);
      return db.transaction(() => {
        const transfer = db.all(
          "SELECT * FROM media_transfers WHERE storage_path=? AND user_id=? AND state='uploading'",
          path,
          actorId,
        )[0];
        if (!transfer)
          throw new CommunityError(409, "Upload is no longer reserved");
        const item = db.all(
          "INSERT INTO media(user_id,storage_path,mime_type,size_bytes) VALUES(?,?,?,?) RETURNING id,storage_path,mime_type,size_bytes,alt_text",
          actorId,
          path,
          transfer.mime_type,
          transfer.size_bytes,
        )[0];
        db.all("DELETE FROM media_transfers WHERE storage_path=?", path);
        return item;
      });
    },
    abandonUpload(actorId: number, path: string) {
      db.all(
        "UPDATE media_transfers SET state='deleting',expires_at=0 WHERE storage_path=? AND user_id=?",
        path,
        actorId,
      );
    },
    deleteMedia(actorId: number, id: number) {
      member(actorId);
      return db.transaction(() => {
        const item = db.all(
          "SELECT * FROM media WHERE id=? AND user_id=?",
          id,
          actorId,
        )[0];
        if (!item) throw new CommunityError(404, "Media not found");
        db.all(
          "INSERT INTO media_transfers VALUES(?,?,?,?,'deleting',0)",
          item.storage_path,
          actorId,
          item.mime_type,
          item.size_bytes,
        );
        db.all("DELETE FROM media WHERE id=?", id);
      });
    },
    pendingMediaDeletes() {
      return db.all(
        "SELECT storage_path FROM media_transfers WHERE state='deleting' OR expires_at<=? LIMIT 100",
        Date.now(),
      );
    },
    finishMediaDelete(path: string) {
      db.all(
        "DELETE FROM media_transfers WHERE storage_path=? AND (state='deleting' OR expires_at<=?)",
        path,
        Date.now(),
      );
    },
    hasMediaTransfers() {
      return (
        db.all("SELECT storage_path FROM media_transfers LIMIT 1").length > 0
      );
    },
  };
}
