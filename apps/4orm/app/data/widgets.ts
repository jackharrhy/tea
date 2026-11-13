import { CommunityError } from "./community.ts";
import type { Database, Member, Row } from "./community.ts";

export function createWidgets(db: Database, member: (id: number) => Member) {
  db.all(
    "CREATE TABLE IF NOT EXISTS counter_visits(user_id INTEGER NOT NULL,visitor_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(user_id,visitor_hash));",
  );
  function owner(username: string) {
    const row = db.all(
      "SELECT id,username,display_name,status_emoji,status_text,status_updated_at,guestbook_css,guestbook_html,counter_css,counter_html,status_css,status_html,player_css,player_html,in_webring FROM users WHERE username=?",
      username,
    )[0];
    if (!row) throw new CommunityError(404, "Member not found");
    return row;
  }
  return {
    guestbook(username: string) {
      const user = owner(username);
      return {
        owner: user,
        entries: db.all(
          "SELECT g.*,u.username,u.display_name FROM guestbook_entries g JOIN users u ON u.id=g.author_id WHERE g.user_id=? ORDER BY g.created_at DESC",
          user.id,
        ),
      };
    },
    signGuestbook(actorId: number, username: string, message: string) {
      member(actorId);
      const user = owner(username);
      if (!message) throw new CommunityError(422, "Write a message");
      message = Array.from(message).slice(0, 500).join("");
      db.all(
        "INSERT INTO guestbook_entries(user_id,author_id,message) VALUES(?,?,?)",
        user.id,
        actorId,
        message,
      );
    },
    deleteGuestbook(actorId: number, username: string, id: number) {
      member(actorId);
      const user = db.all("SELECT id FROM users WHERE username=?", username)[0];
      if (!user || user.id !== actorId)
        throw new CommunityError(
          403,
          "Only the guestbook owner can remove entries",
        );
      db.all(
        "DELETE FROM guestbook_entries WHERE user_id=? AND id=?",
        actorId,
        id,
      );
    },
    counter(username: string, visitorHash: string) {
      const user = owner(username);
      return db.transaction(() => {
        db.all("DELETE FROM counter_visits WHERE expires_at<=?", Date.now());
        if (
          !db.all(
            "SELECT user_id FROM counter_visits WHERE user_id=? AND visitor_hash=?",
            user.id,
            visitorHash,
          ).length
        ) {
          db.all(
            "INSERT INTO counter_visits VALUES(?,?,?)",
            user.id,
            visitorHash,
            Date.now() + 60000,
          );
          db.all(
            "INSERT INTO visitor_counters(user_id,total_views) VALUES(?,1) ON CONFLICT(user_id) DO UPDATE SET total_views=total_views+1,updated_at=CURRENT_TIMESTAMP",
            user.id,
          );
        }
        return {
          owner: user,
          total_views: Number(
            db.all(
              "SELECT total_views FROM visitor_counters WHERE user_id=?",
              user.id,
            )[0].total_views,
          ),
        };
      });
    },
    status: owner,
    webring(username: string) {
      const members = db.all(
        "SELECT username,display_name FROM users WHERE in_webring=1 AND is_disabled=0 ORDER BY created_at,id",
      );
      const index = members.findIndex((row) => row.username === username);
      return {
        members,
        previous:
          index < 0
            ? null
            : members[(index - 1 + members.length) % members.length],
        next: index < 0 ? null : members[(index + 1) % members.length],
      };
    },
    setWebring(actorId: number, enabled: boolean) {
      member(actorId);
      db.all(
        "UPDATE users SET in_webring=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        enabled ? 1 : 0,
        actorId,
      );
    },
    setAvatar(actorId: number, mediaId: number | null) {
      member(actorId);
      if (
        mediaId !== null &&
        !db.all(
          "SELECT id FROM media WHERE id=? AND user_id=? AND mime_type LIKE 'image/%'",
          mediaId,
          actorId,
        ).length
      )
        throw new CommunityError(
          403,
          "Choose an image from your own media library",
        );
      db.all("UPDATE users SET avatar_media_id=? WHERE id=?", mediaId, actorId);
    },
    playlist(username: string) {
      const user = owner(username);
      return db.all(
        "SELECT p.*,m.storage_path,m.mime_type FROM playlist_items p JOIN media m ON m.id=p.media_id WHERE p.user_id=? ORDER BY p.position,p.id",
        user.id,
      );
    },
    addTrack(actorId: number, mediaId: number, title: string | null = null) {
      member(actorId);
      const media = db.all(
        "SELECT id FROM media WHERE id=? AND user_id=?",
        mediaId,
        actorId,
      )[0];
      if (!media)
        throw new CommunityError(
          403,
          "Choose a file from your own media library",
        );
      db.all(
        "INSERT INTO playlist_items(user_id,media_id,title,position) VALUES(?,?,?,(SELECT coalesce(max(position),-1)+1 FROM playlist_items WHERE user_id=?))",
        actorId,
        mediaId,
        title === null ? null : title.slice(0, 200),
        actorId,
      );
    },
    removeTrack(actorId: number, id: number) {
      member(actorId);
      db.all(
        "DELETE FROM playlist_items WHERE user_id=? AND id=?",
        actorId,
        id,
      );
    },
    moveTrack(actorId: number, id: number, direction: string) {
      member(actorId);
      if (!["up", "down"].includes(direction)) return;
      db.transaction(() => {
        const items = db.all(
          "SELECT id,position FROM playlist_items WHERE user_id=? ORDER BY position,id",
          actorId,
        );
        const index = items.findIndex((item) => item.id === id),
          other = index + (direction === "up" ? -1 : 1);
        if (index < 0 || other < 0 || other >= items.length) return;
        db.all(
          "UPDATE playlist_items SET position=? WHERE id=? AND user_id=?",
          items[other].position,
          id,
          actorId,
        );
        db.all(
          "UPDATE playlist_items SET position=? WHERE id=? AND user_id=?",
          items[index].position,
          items[other].id,
          actorId,
        );
      });
    },
    profileCard(actorId: number) {
      member(actorId);
      return (
        db.all("SELECT * FROM profile_cards WHERE user_id=?", actorId)[0] ?? {
          user_id: actorId,
        }
      );
    },
    saveCard(actorId: number, input: Row) {
      member(actorId);
      const headline = String(input.headline ?? ""),
        text = String(input.content ?? "");
      db.all(
        "INSERT INTO profile_cards(user_id,headline,content,content_format,accent_color,border_style,card_css) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET headline=excluded.headline,content=excluded.content,content_format=excluded.content_format,accent_color=excluded.accent_color,border_style=excluded.border_style,card_css=excluded.card_css,updated_at=CURRENT_TIMESTAMP",
        actorId,
        headline,
        text,
        String(input.content_format ?? "html"),
        String(input.accent_color ?? "#00ffff"),
        String(input.border_style ?? "outset"),
        String(input.card_css ?? ""),
      );
    },
    publicCards() {
      return db.all(
        "SELECT c.*,u.username,u.display_name FROM profile_cards c JOIN users u ON u.id=c.user_id WHERE u.is_disabled=0 ORDER BY u.created_at,u.id",
      );
    },
    feed(username: string | null) {
      return db.all(
        "SELECT p.slug,p.title,p.updated_at,u.username,u.display_name FROM pages p JOIN users u ON u.id=p.user_id WHERE p.is_public=1 AND p.updated_at<=datetime('now','-20 minutes') AND (? IS NULL OR u.username=?) ORDER BY p.updated_at DESC LIMIT 100",
        username,
        username,
      );
    },
    forumFeed() {
      return db.all(
        "SELECT p.id,p.thread_id,p.created_at,t.title AS thread_title,u.username AS author_username,u.display_name AS author_display_name FROM forum_posts p JOIN users u ON u.id=p.author_id JOIN forum_threads t ON t.id=p.thread_id ORDER BY p.created_at DESC LIMIT 100",
      );
    },
    lineage() {
      return db.all(
        "SELECT id,username,display_name,invited_by_user_id FROM users ORDER BY created_at",
      );
    },
  };
}
