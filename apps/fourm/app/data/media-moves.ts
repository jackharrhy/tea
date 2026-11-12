import { CommunityError } from "./community.ts";
import type { Database, Member, Row } from "./community.ts";
import { chosenFilename, numberedFilename } from "../media-filename.ts";

export function mediaMoveSchema(db: Database) {
  db.all(`CREATE TABLE IF NOT EXISTS media_moves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
    kind TEXT NOT NULL CHECK(kind IN ('file','username')),
    target TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('copying','cleanup')),
    preserve_updated_at INTEGER NOT NULL DEFAULT 0 CHECK(preserve_updated_at IN (0,1))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS media_move_username ON media_moves(target) WHERE kind='username';
  CREATE TABLE IF NOT EXISTS media_move_files (
    move_id INTEGER NOT NULL REFERENCES media_moves(id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL REFERENCES media(id),
    old_path TEXT NOT NULL UNIQUE,
    new_path TEXT NOT NULL UNIQUE,
    size_bytes INTEGER NOT NULL,
    copied INTEGER NOT NULL DEFAULT 0 CHECK(copied IN (0,1)),
    PRIMARY KEY(move_id,media_id)
  );`);
  if (
    !db
      .all("PRAGMA table_info(media_moves)")
      .some((column) => column.name === "preserve_updated_at")
  )
    db.all(
      "ALTER TABLE media_moves ADD COLUMN preserve_updated_at INTEGER NOT NULL DEFAULT 0 CHECK(preserve_updated_at IN (0,1))",
    );
}

export function requireIdleMedia(db: Database, actorId: number) {
  if (db.all("SELECT id FROM media_moves WHERE user_id=?", actorId).length)
    throw new CommunityError(
      409,
      "Your media move is still finishing. Try again shortly.",
    );
}

export function usernameReserved(db: Database, username: string) {
  return (
    db.all(
      "SELECT id FROM media_moves WHERE kind='username' AND target=? UNION ALL SELECT user_id FROM account_cleanup_users WHERE username=? LIMIT 1",
      username,
      username,
    ).length > 0
  );
}

export function availableMediaPath(
  db: Database,
  username: string,
  filename: string,
  unavailable: readonly string[] = [],
) {
  const blocked = new Set(unavailable);
  function occupied(path: string) {
    return (
      blocked.has(path) ||
      db.all(
        `SELECT storage_path FROM media WHERE storage_path=?
      UNION ALL SELECT storage_path FROM media_transfers WHERE storage_path=?
      UNION ALL SELECT old_path FROM media_move_files WHERE old_path=? OR new_path=?
      UNION ALL SELECT storage_path FROM account_cleanup_objects WHERE storage_path=? LIMIT 1`,
        path,
        path,
        path,
        path,
        path,
      ).length > 0
    );
  }
  let path = `${username}/${filename}`,
    index = 2;
  while (occupied(path))
    path = `${username}/${numberedFilename(filename, index++)}`;
  return path;
}

function usernameValue(input: string) {
  const username = input.trim().toLowerCase();
  if (!/^[a-z0-9_-]{3,32}$/.test(username))
    throw new CommunityError(
      422,
      "username must be 3-32 chars, lowercase letters, numbers, hyphens, or underscores",
    );
  return username;
}
export function createMediaMoves(
  db: Database,
  member: (id: number) => Member,
  admin: (id: number) => Member,
) {
  function begin(
    actorId: number,
    kind: "file" | "username",
    target: string,
    items: Row[],
    preserveUpdatedAt = false,
  ) {
    const current = db.all(
      "SELECT * FROM media_moves WHERE user_id=?",
      actorId,
    )[0];
    if (current) {
      if (current.kind === kind && current.target === target) return current;
      throw new CommunityError(
        409,
        "Your previous media move is still finishing. Try again shortly.",
      );
    }
    if (
      db.all(
        "SELECT storage_path FROM media_transfers WHERE user_id=? LIMIT 1",
        actorId,
      ).length
    )
      throw new CommunityError(
        409,
        "Wait for your uploads or deletions to finish before renaming.",
      );
    const owner = db.all("SELECT username FROM users WHERE id=?", actorId)[0];
    if (!owner) throw new CommunityError(404, "Member not found");
    const actor = { username: String(owner.username) };
    const move = db.all(
      "INSERT INTO media_moves(user_id,kind,target,state,preserve_updated_at) VALUES(?,?,?,'copying',?) RETURNING *",
      actorId,
      kind,
      target,
      preserveUpdatedAt ? 1 : 0,
    )[0];
    for (const item of items) {
      const filename =
        kind === "file"
          ? target
          : String(item.storage_path).slice(actor.username.length + 1);
      const path = availableMediaPath(
        db,
        kind === "username" ? target : actor.username,
        filename,
      );
      db.all(
        "INSERT INTO media_move_files(move_id,media_id,old_path,new_path,size_bytes) VALUES(?,?,?,?,?)",
        move.id,
        item.id,
        item.storage_path,
        path,
        item.size_bytes,
      );
    }
    return move;
  }
  function beginUsernameMove(
    actorId: number,
    previousUsername: string,
    username: string,
    preserveUpdatedAt: boolean,
  ) {
    return db.transaction(() => {
      const current = db.all(
        "SELECT * FROM media_moves WHERE user_id=?",
        actorId,
      )[0];
      if (current)
        return begin(actorId, "username", username, [], preserveUpdatedAt);
      if (username === previousUsername) return null;
      if (
        db.all("SELECT id FROM users WHERE username=?", username).length ||
        usernameReserved(db, username)
      )
        throw new CommunityError(409, "That username is already taken");
      if (
        db.all(
          "SELECT id FROM auth_enrollments WHERE username=? AND consumed_at IS NULL AND expires_at>?",
          username,
          Math.floor(Date.now() / 1000),
        ).length
      )
        throw new CommunityError(409, "That username is already taken");
      const items = db
        .all("SELECT * FROM media WHERE user_id=? ORDER BY id", actorId)
        .filter((item) =>
          String(item.storage_path).startsWith(previousUsername + "/"),
        );
      return begin(actorId, "username", username, items, preserveUpdatedAt);
    });
  }
  return {
    beginMediaRename(actorId: number, id: number, filename: string) {
      member(actorId);
      return db.transaction(() => {
        const item = db.all(
          "SELECT * FROM media WHERE id=? AND user_id=?",
          id,
          actorId,
        )[0];
        if (!item) throw new CommunityError(404, "Media not found");
        const target = chosenFilename(filename, String(item.storage_path));
        const current = db.all(
          "SELECT * FROM media_moves WHERE user_id=?",
          actorId,
        )[0];
        if (
          current &&
          !db.all(
            "SELECT media_id FROM media_move_files WHERE move_id=? AND media_id=?",
            current.id,
            id,
          ).length
        )
          throw new CommunityError(
            409,
            "Your previous media move is still finishing. Try again shortly.",
          );
        return begin(actorId, "file", target, [item]);
      });
    },
    beginUsernameRename(actorId: number, input: string) {
      const actor = member(actorId);
      return beginUsernameMove(
        actorId,
        actor.username,
        usernameValue(input),
        false,
      );
    },
    beginAdminUsernameRename(
      actorId: number,
      userId: number,
      input: string,
      displayName: string,
    ) {
      admin(actorId);
      const username = usernameValue(input);
      const user = db.all("SELECT username FROM users WHERE id=?", userId)[0];
      if (!user) throw new CommunityError(404, "Member not found");
      if (displayName.trim())
        db.all(
          "UPDATE users SET display_name=? WHERE id=?",
          displayName.trim(),
          userId,
        );
      return beginUsernameMove(userId, String(user.username), username, true);
    },
    pendingMediaMoves() {
      return db.all("SELECT * FROM media_moves ORDER BY id");
    },
    mediaMoveFiles(id: number) {
      return db.all(
        "SELECT * FROM media_move_files WHERE move_id=? ORDER BY media_id",
        id,
      );
    },
    retargetMediaMoveFile(
      moveId: number,
      mediaId: number,
      unavailable: string[],
    ) {
      return db.transaction(() => {
        const move = db.all(
          "SELECT * FROM media_moves WHERE id=? AND state='copying'",
          moveId,
        )[0];
        const file = db.all(
          "SELECT * FROM media_move_files WHERE move_id=? AND media_id=? AND copied=0",
          moveId,
          mediaId,
        )[0];
        if (!move || !file)
          throw new CommunityError(
            409,
            "A verified media copy cannot be retargeted",
          );
        const username =
          move.kind === "username"
            ? String(move.target)
            : String(
                db.all("SELECT username FROM users WHERE id=?", move.user_id)[0]
                  .username,
              );
        const filename =
          move.kind === "file"
            ? String(move.target)
            : String(file.old_path).slice(
                String(file.old_path).indexOf("/") + 1,
              );
        const path = availableMediaPath(db, username, filename, unavailable);
        db.all(
          "UPDATE media_move_files SET new_path=? WHERE move_id=? AND media_id=? AND copied=0",
          path,
          moveId,
          mediaId,
        );
        return path;
      });
    },
    copiedMediaMoveFile(moveId: number, mediaId: number) {
      db.all(
        "UPDATE media_move_files SET copied=1 WHERE move_id=? AND media_id=? AND EXISTS(SELECT 1 FROM media_moves WHERE id=? AND state='copying')",
        moveId,
        mediaId,
        moveId,
      );
    },
    commitMediaMove(id: number) {
      return db.transaction(() => {
        const move = db.all("SELECT * FROM media_moves WHERE id=?", id)[0];
        if (!move || move.state === "cleanup") return;
        if (
          db.all(
            "SELECT media_id FROM media_move_files WHERE move_id=? AND copied=0",
            id,
          ).length
        )
          throw new CommunityError(409, "Media copies are not complete");
        const files = db.all(
          "SELECT * FROM media_move_files WHERE move_id=?",
          id,
        );
        for (const file of files) {
          const item = db.all(
            "UPDATE media SET storage_path=? WHERE id=? AND user_id=? AND storage_path=? RETURNING id",
            file.new_path,
            file.media_id,
            move.user_id,
            file.old_path,
          )[0];
          if (!item)
            throw new CommunityError(409, "Media changed during rename");
        }
        if (move.kind === "username")
          db.all(
            "UPDATE users SET username=?,updated_at=CASE WHEN ? THEN updated_at ELSE CURRENT_TIMESTAMP END WHERE id=?",
            move.target,
            move.preserve_updated_at,
            move.user_id,
          );
        db.all("UPDATE media_moves SET state='cleanup' WHERE id=?", id);
      });
    },
    finishMediaMove(id: number) {
      db.all("DELETE FROM media_moves WHERE id=? AND state='cleanup'", id);
    },
    hasMediaMoves() {
      return db.all("SELECT id FROM media_moves LIMIT 1").length > 0;
    },
  };
}
