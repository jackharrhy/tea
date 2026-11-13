import { CommunityError } from "./community.ts";
import type { Database, Member } from "./community.ts";
import { requireIdleMedia } from "./media-moves.ts";
export function accountCleanupSchema(db: Database) {
  db.all(`CREATE TABLE IF NOT EXISTS account_cleanup_users(username TEXT PRIMARY KEY,user_id INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS account_cleanup_objects(storage_path TEXT PRIMARY KEY,username TEXT NOT NULL REFERENCES account_cleanup_users(username) ON DELETE CASCADE);`);
}
export function createAccountDeletion(
  db: Database,
  admin: (id: number) => Member,
) {
  return {
    beginAccountDelete(actorId: number | null, userId: number, mode: string) {
      if (actorId === null)
        throw new CommunityError(403, "Admin access required");
      admin(actorId);
      if (actorId === userId)
        throw new CommunityError(400, "Cannot delete your own account");
      return db.transaction(() => {
        const root = db.all(
          "SELECT id,username,invited_by_user_id FROM users WHERE id=?",
          userId,
        )[0];
        if (!root) throw new CommunityError(404, "Not found");
        const users =
          mode === "prune"
            ? db.all(
                `WITH RECURSIVE subtree(id) AS (SELECT id FROM users WHERE id=? UNION SELECT u.id FROM users u JOIN subtree s ON u.invited_by_user_id=s.id) SELECT u.id,u.username FROM users u JOIN subtree s ON s.id=u.id`,
                userId,
              )
            : [root];
        const ids = users.map((u) => Number(u.id));
        const placeholders = ids.map(() => "?").join(",");
        for (const user of users) {
          requireIdleMedia(db, Number(user.id));
          if (
            db.all(
              "SELECT storage_path FROM media_transfers WHERE user_id=? LIMIT 1",
              user.id,
            ).length
          )
            throw new CommunityError(
              409,
              "Wait for media transfers to finish before deleting this account",
            );
          db.all(
            "INSERT INTO account_cleanup_users(username,user_id) VALUES(?,?)",
            user.username,
            user.id,
          );
        }
        db.all(
          `INSERT INTO account_cleanup_objects(storage_path,username) SELECT m.storage_path,u.username FROM media m JOIN users u ON u.id=m.user_id WHERE m.user_id IN (${placeholders})`,
          ...ids,
        );
        if (mode !== "prune")
          db.all(
            "UPDATE users SET invited_by_user_id=? WHERE invited_by_user_id=?",
            root.invited_by_user_id,
            userId,
          );
        const requests = db.all(
          `SELECT id FROM auth_enrollments WHERE user_id IN (${placeholders}) OR invite_id IN (SELECT id FROM invites WHERE created_by_user_id IN (${placeholders}))`,
          ...ids,
          ...ids,
        );
        for (const request of requests) {
          db.all(
            "DELETE FROM enrollment_grants WHERE request_id=?",
            request.id,
          );
          db.all(
            "DELETE FROM enrollment_completions WHERE request_id=?",
            request.id,
          );
        }
        for (const id of ids.toReversed()) {
          db.all("DELETE FROM browser_sessions WHERE user_id=?", id);
          db.all("DELETE FROM users WHERE id=?", id);
        }
        db.all(
          "DELETE FROM account_cleanup_users WHERE NOT EXISTS(SELECT 1 FROM account_cleanup_objects o WHERE o.username=account_cleanup_users.username)",
        );
        return users.length;
      });
    },
    pendingAccountCleanup() {
      return db.all(
        "SELECT storage_path FROM account_cleanup_objects ORDER BY storage_path LIMIT 100",
      );
    },
    finishAccountCleanup(path: string) {
      db.transaction(() => {
        db.all(
          "DELETE FROM account_cleanup_objects WHERE storage_path=?",
          path,
        );
        db.all(
          "DELETE FROM account_cleanup_users WHERE NOT EXISTS(SELECT 1 FROM account_cleanup_objects o WHERE o.username=account_cleanup_users.username)",
        );
      });
    },
    hasAccountCleanup() {
      return (
        db.all("SELECT username FROM account_cleanup_users LIMIT 1").length > 0
      );
    },
  };
}
