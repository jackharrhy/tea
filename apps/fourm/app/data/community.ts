import { orphanCleanupSchema, createOrphanCleanup } from "./orphan-cleanup.ts";
import {
  accountCleanupSchema,
  createAccountDeletion,
} from "./account-deletion.ts";
import { createAdmin } from "./admin.ts";
import { createPushDevices } from "./push.ts";
import { createChatRoom } from "./chat-room.ts";
import { mediaMoveSchema, createMediaMoves } from "./media-moves.ts";
import { createSettings } from "./settings.ts";
import { pageContent } from "./page-content.ts";
import { schema, coreTables } from "./schema.ts";
import { createEnrollments } from "./enrollment.ts";
import { createMedia } from "./media.ts";
import { createWidgets } from "./widgets.ts";

export type Row = Record<string, string | number | null>;
export interface Database {
  all(sql: string, ...values: (string | number | null)[]): Row[];
  transaction<T>(operation: () => T): T;
}
export interface Member {
  id: number;
  username: string;
  display_name: string;
  is_admin: number;
  is_disabled: number;
  has_accepted_trust: number;
}
export class CommunityError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}
const memberColumns =
  "id, username, display_name, is_admin, is_disabled, has_accepted_trust";
const missing = () => new CommunityError(404, "Not found");

function required(value: unknown, max: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new CommunityError(
      422,
      `${label} is required (up to ${max} characters)`,
    );
  return value;
}
function slug(value: string) {
  if (!/^[^/]{1,80}$/.test(value) || value === "." || value === "..")
    throw new CommunityError(422, "Invalid page slug");
  return value;
}
function format(value: unknown) {
  if (!["html", "markdown", "bbcode"].includes(String(value)))
    throw new CommunityError(422, "Choose HTML, Markdown or BBCode");
  return String(value);
}

export function createCommunity(
  db: Database,
  { forumRateLimit = true, chatFloodLimit = true } = {},
) {
  db.all(schema);
  mediaMoveSchema(db);
  accountCleanupSchema(db);
  orphanCleanupSchema(db);
  const pageBodies = pageContent(db);
  db.all(`CREATE TABLE IF NOT EXISTS browser_sessions (
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL
  ); CREATE TABLE IF NOT EXISTS login_transactions (
    state_hash TEXT PRIMARY KEY, body TEXT NOT NULL, expires_at INTEGER NOT NULL
  );`);
  db.all(
    "CREATE TABLE IF NOT EXISTS archive_receipts (digest TEXT PRIMARY KEY, receipt TEXT NOT NULL);",
  );

  function enforceForumRate(actorId: number) {
    if (!forumRateLimit) return;
    const latest = db.all(
      "SELECT created_at FROM forum_posts WHERE author_id=? ORDER BY created_at DESC LIMIT 1",
      actorId,
    )[0];
    if (!latest) return;
    const input = String(latest.created_at).replace(" ", "T");
    const last = new Date(
      /(?:Z|[+-]\d\d:\d\d)$/.test(input) ? input : input + "Z",
    ).getTime();
    const wait = Math.trunc(10 - (Date.now() - last) / 1000);
    if (wait > 0)
      throw new CommunityError(429, "please wait before posting again", wait);
  }

  function member(id: number): Member {
    const found = db.all(
      `SELECT ${memberColumns} FROM users WHERE id=?`,
      id,
    )[0];
    if (!found || found.is_disabled)
      throw new CommunityError(403, "Membership is unavailable");
    return found as unknown as Member;
  }
  function admin(id: number) {
    const actor = member(id);
    if (!actor.is_admin) throw new CommunityError(403, "Admin access required");
    return actor;
  }
  function owned(actorId: number, ownerId: number) {
    const actor = member(actorId);
    if (actor.id !== ownerId && !actor.is_admin)
      throw new CommunityError(403, "This belongs to another member");
  }

  function writePage(actorId: number, pageSlug: string, input: Row) {
    member(actorId);
    const title = String(input.title ?? "");
    const content = String(input.content ?? "");
    const parts = pageBodies.chunks(content);
    db.all(
      `INSERT INTO pages(user_id,slug,title,content,content_format,layout,is_public)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,slug) DO UPDATE SET
    title=excluded.title,content=excluded.content,content_format=excluded.content_format,
    layout=excluded.layout,is_public=excluded.is_public,updated_at=CURRENT_TIMESTAMP`,
      actorId,
      pageSlug,
      title,
      parts.length ? "" : content,
      String(input.content_format ?? "html"),
      String(input.layout ?? "default"),
      input.is_public ? 1 : 0,
    );
    const id = db.all(
      "SELECT id FROM pages WHERE user_id=? AND slug=?",
      actorId,
      pageSlug,
    )[0].id;
    pageBodies.write(Number(id), parts);
    return pageBodies.read(
      db.all(
        "SELECT * FROM pages WHERE user_id=? AND slug=?",
        actorId,
        pageSlug,
      )[0],
    );
  }

  return {
    settingsSnapshot(actorId: number) {
      const user = member(actorId);
      return {
        profile: this.profile(user.username),
        pages: db.all(
          "SELECT slug,title,is_public,updated_at FROM pages WHERE user_id=? ORDER BY updated_at DESC",
          actorId,
        ),
        card: this.profileCard(actorId),
        media: this.media(actorId).items,
        tracks: this.playlist(user.username),
        invites: this.invites(actorId),
      };
    },
    publicProfile(username: string) {
      const profile = this.profile(username);
      return {
        profile,
        pages: db.all(
          "SELECT slug,title FROM pages WHERE user_id=? AND is_public=1 ORDER BY updated_at DESC",
          profile.id,
        ),
      };
    },
    home() {
      return {
        cards:
          db.all(`SELECT u.username,c.headline,c.content,c.content_format,c.accent_color,c.border_style,c.card_css
          FROM users u JOIN profile_cards c ON u.id=c.user_id
          LEFT JOIN (SELECT user_id,MAX(updated_at) latest_page_at FROM pages GROUP BY user_id) p ON p.user_id=u.id
          ORDER BY MAX(u.updated_at,c.updated_at,COALESCE(p.latest_page_at,u.created_at)) DESC`),
        recent:
          db.all(`SELECT p.*,t.title thread_title,u.username author_username,u.display_name author_display_name
          FROM forum_posts p JOIN forum_threads t ON t.id=p.thread_id JOIN users u ON u.id=p.author_id
          WHERE p.created_at>=datetime('now','-2 hours') ORDER BY p.created_at DESC LIMIT 5`),
      };
    },
    siteBanner() {
      return db.all("SELECT * FROM site_settings WHERE id=1")[0] ?? null;
    },
    ...createSettings(db, member),
    ...createAdmin(db, admin, pageBodies),
    ...createOrphanCleanup(db, admin),
    ...createAccountDeletion(db, admin),
    ...createEnrollments(db, member),
    ...createMedia(db, member),
    ...createMediaMoves(db, member, admin),
    ...createWidgets(db, member),
    ...createPushDevices(db, member),
    member,
    acceptTrust(actorId: number) {
      member(actorId);
      db.all("UPDATE users SET has_accepted_trust=1 WHERE id=?", actorId);
    },
    assertArchiveRestoreAuthority(issuer: string, subject: string) {
      if (
        db.all("SELECT storage_path FROM orphan_cleanup_objects LIMIT 1").length
      )
        throw new CommunityError(
          409,
          "Orphan cleanup must finish before restoring an archive",
        );
      if (db.all("SELECT username FROM account_cleanup_users LIMIT 1").length)
        throw new CommunityError(
          409,
          "Account media cleanup must finish before restoring an archive",
        );
      if (!Number(db.all("SELECT count(*) AS count FROM users")[0].count))
        return;
      const link = db.all(
        "SELECT user_id FROM external_identities WHERE issuer=? AND subject=?",
        issuer,
        subject,
      )[0];
      if (!link)
        throw new CommunityError(
          403,
          "Archive administrator is not linked to a local member",
        );
      admin(Number(link.user_id));
    },
    exportArchive(actorId: number) {
      admin(actorId);
      return db.transaction(() =>
        Object.fromEntries(
          coreTables.map((table) => [
            table,
            db
              .all(`SELECT * FROM "${table}"`)
              .map((row) => (table === "pages" ? pageBodies.read(row) : row)),
          ]),
        ),
      );
    },
    restore(tables: Record<string, Row[]>, digest?: string) {
      if (
        db.all("SELECT storage_path FROM orphan_cleanup_objects LIMIT 1").length
      )
        throw new CommunityError(
          409,
          "Orphan cleanup must finish before restoring an archive",
        );
      if (db.all("SELECT username FROM account_cleanup_users LIMIT 1").length)
        throw new CommunityError(
          409,
          "Account media cleanup must finish before restoring an archive",
        );
      if (digest) {
        const previous = db.all(
          "SELECT receipt FROM archive_receipts WHERE digest=?",
          digest,
        )[0];
        if (previous)
          return JSON.parse(String(previous.receipt)) as { members: number };
      }
      if (db.all("SELECT id FROM users LIMIT 1").length)
        throw new CommunityError(409, "Restore requires an empty community");
      const allowed = coreTables;
      if (Object.keys(tables).some((table) => !allowed.includes(table)))
        throw new CommunityError(422, "Archive contains an unknown table");
      for (const row of tables.users ?? []) {
        if (row.password_hash !== "")
          throw new CommunityError(
            422,
            "Local password credentials must not be imported",
          );
      }
      db.transaction(() => {
        db.all("PRAGMA defer_foreign_keys=ON");
        for (const [table, rows] of Object.entries(tables)) {
          const columns = new Set(
            db
              .all(`PRAGMA table_info("${table}")`)
              .map((row) => String(row.name)),
          );
          for (const row of rows) {
            const keys = Object.keys(row);
            if (!keys.length || keys.some((key) => !columns.has(key)))
              throw new CommunityError(422, "Archive contains unknown columns");
            const parts =
              table === "pages"
                ? pageBodies.chunks(String(row.content ?? ""))
                : [];
            const stored = parts.length ? { ...row, content: "" } : row;
            db.all(
              `INSERT INTO "${table}" (${keys.map((key) => `"${key}"`).join(",")}) VALUES(${keys.map(() => "?").join(",")})`,
              ...keys.map((key) => stored[key]),
            );
            if (table === "pages") pageBodies.write(Number(row.id), parts);
          }
        }
        db.all(
          "DELETE FROM archive_staging_objects WHERE storage_path IN (SELECT storage_path FROM media)",
        );
        if (db.all("PRAGMA foreign_key_check").length)
          throw new CommunityError(
            422,
            "Archive has broken ownership references",
          );
        if (digest)
          db.all(
            "INSERT INTO archive_receipts VALUES(?,?)",
            digest,
            JSON.stringify({
              members: db.all("SELECT count(*) AS count FROM users")[0].count,
            }),
          );
      });
      return {
        members: db.all("SELECT count(*) AS count FROM users")[0].count,
      };
    },
    resolveIdentity(issuer: string, subject: string) {
      const link = db.all(
        "SELECT user_id FROM external_identities WHERE issuer=? AND subject=?",
        issuer,
        subject,
      )[0];
      if (!link)
        throw new CommunityError(
          403,
          "This identity is not linked to a member",
        );
      return member(Number(link.user_id));
    },
    session(hash: string) {
      const row = db.all(
        "SELECT user_id FROM browser_sessions WHERE token_hash=? AND expires_at>?",
        hash,
        Date.now(),
      )[0];
      if (!row) return null;
      try {
        return member(Number(row.user_id));
      } catch {
        return null;
      }
    },
    createSession(hash: string, userId: number, expiresAt: number) {
      member(userId);
      db.all(
        "INSERT INTO browser_sessions VALUES (?,?,?)",
        hash,
        userId,
        Math.min(expiresAt, Date.now() + 3600000),
      );
    },
    endSession(hash: string) {
      db.all("DELETE FROM browser_sessions WHERE token_hash=?", hash);
    },
    saveLogin(hash: string, body: string) {
      db.all("DELETE FROM login_transactions WHERE expires_at<=?", Date.now());
      db.all(
        "INSERT INTO login_transactions VALUES (?,?,?)",
        hash,
        body,
        Date.now() + 600000,
      );
    },
    consumeLogin(hash: string) {
      return db.transaction(() => {
        const row = db.all(
          "SELECT body FROM login_transactions WHERE state_hash=? AND expires_at>?",
          hash,
          Date.now(),
        )[0];
        db.all("DELETE FROM login_transactions WHERE state_hash=?", hash);
        return row ? String(row.body) : null;
      });
    },
    members() {
      return db.all(
        "SELECT id,username,display_name,status_emoji,status_text FROM users WHERE is_disabled=0 ORDER BY username",
      );
    },
    fullSiteExport(actorId: number | null) {
      if (actorId === null)
        throw new CommunityError(403, "Admin access required");
      admin(actorId);
      return db.transaction(() => ({
        users: db
          .all("SELECT username FROM users ORDER BY created_at")
          .map((row) => this.userSiteExport(actorId, String(row.username))),
        threads: db.all(
          "SELECT t.*,u.username AS author_username,u.display_name AS author_display_name FROM forum_threads t JOIN users u ON u.id=t.author_id ORDER BY t.created_at",
        ),
        posts: db.all(
          "SELECT p.*,u.username AS author_username,u.display_name AS author_display_name,u.forum_signature AS author_signature FROM forum_posts p JOIN users u ON u.id=p.author_id ORDER BY p.created_at",
        ),
      }));
    },
    userSiteExport(actorId: number | null, username: string) {
      const profile = this.profile(username);
      if (actorId === null)
        throw new CommunityError(403, "Export permission required");
      const actor = member(actorId);
      if (actor.id !== Number(profile.id) && !actor.is_admin)
        throw new CommunityError(403, "Export permission required");
      return {
        profile,
        pages: db
          .all(
            "SELECT * FROM pages WHERE user_id=? AND is_public=1 ORDER BY created_at",
            profile.id,
          )
          .map(pageBodies.read),
        media: db.all(
          "SELECT storage_path FROM media WHERE user_id=?",
          profile.id,
        ),
      };
    },
    profile(username: string) {
      const user = db.all(
        `SELECT u.id,u.username,u.display_name,u.content,u.content_format,u.custom_css,u.custom_html,u.layout,
        u.status_emoji,u.status_text,u.status_updated_at,u.forum_signature,u.avatar_media_id,
        u.guestbook_css,u.guestbook_html,u.counter_css,u.counter_html,u.status_css,u.status_html,
        u.player_css,u.player_html,u.in_webring,u.notifications_enabled,u.watch_all_threads,u.created_at,u.updated_at,
        m.storage_path AS avatar_path FROM users u LEFT JOIN media m ON m.id=u.avatar_media_id WHERE u.username=?`,
        username,
      )[0];
      if (!user) throw missing();
      return user;
    },
    pages(userId: number, actorId: number | null) {
      return db
        .all(
          "SELECT * FROM pages WHERE user_id=? AND (is_public=1 OR user_id=?) ORDER BY updated_at DESC",
          userId,
          actorId,
        )
        .map(pageBodies.read);
    },
    page(userId: number, pageSlug: string, actorId: number | null) {
      const page = db.all(
        "SELECT * FROM pages WHERE user_id=? AND slug=? AND (is_public=1 OR user_id=?)",
        userId,
        pageSlug,
        actorId,
      )[0];
      if (!page) throw missing();
      return pageBodies.read(page);
    },
    savePage(actorId: number, pageSlug: string, input: Row) {
      slug(pageSlug);
      required(input.title, 140, "Title");
      format(input.content_format ?? "html");
      return db.transaction(() => writePage(actorId, pageSlug, input));
    },
    createSettingsPage(actorId: number, pageSlug: string, input: Row) {
      member(actorId);
      if (
        db.all(
          "SELECT id FROM pages WHERE user_id=? AND slug=?",
          actorId,
          pageSlug,
        ).length
      )
        throw new CommunityError(409, "a page with that slug already exists");
      return db.transaction(() =>
        writePage(actorId, pageSlug, { ...input, is_public: 1 }),
      );
    },
    editSettingsPage(actorId: number, oldSlug: string, input: Row) {
      member(actorId);
      const existing = this.page(actorId, oldSlug, actorId);
      const newSlug = String(input.new_slug ?? "").trim();
      if (
        db.all(
          "SELECT id FROM pages WHERE user_id=? AND slug=? AND id<>?",
          actorId,
          newSlug,
          existing.id,
        ).length
      )
        throw new CommunityError(409, "a page with that slug already exists");
      return db.transaction(() => {
        db.all("UPDATE pages SET slug=? WHERE id=?", newSlug, existing.id);
        return writePage(actorId, newSlug, {
          ...input,
          title: String(input.title ?? "").trim(),
        });
      });
    },
    deletePage(actorId: number, pageSlug: string) {
      member(actorId);
      this.page(actorId, pageSlug, actorId);
      db.all("DELETE FROM pages WHERE user_id=? AND slug=?", actorId, pageSlug);
    },
    saveProfile(actorId: number, input: Row) {
      member(actorId);
      const display = required(input.display_name, 80, "Display name");
      const allowed = [
        "content",
        "content_format",
        "custom_css",
        "custom_html",
        "layout",
        "forum_signature",
        "status_text",
        "status_emoji",
      ];
      if (input.content_format !== undefined) format(input.content_format);
      if (
        String(input.status_text ?? "").length > 140 ||
        String(input.status_emoji ?? "").length > 10
      )
        throw new CommunityError(422, "Status is too long");
      db.transaction(() => {
        db.all(
          "UPDATE users SET display_name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
          display,
          actorId,
        );
        for (const key of allowed)
          if (input[key] !== undefined) {
            if (String(input[key]).length > 500000)
              throw new CommunityError(413, "Profile is too large");
            db.all(`UPDATE users SET ${key}=? WHERE id=?`, input[key], actorId);
          }
      });
    },
    threads() {
      return db.all(`SELECT t.*,u.username,u.display_name FROM forum_threads t JOIN users u ON u.id=t.author_id
        ORDER BY t.is_pinned DESC,t.last_reply_at DESC,t.id DESC LIMIT 100`);
    },
    forumIndex(page = 1) {
      const current = Math.max(1, page);
      const total = Number(
        db.all("SELECT count(*) AS count FROM forum_threads")[0].count,
      );
      return {
        threads: db.all(
          `SELECT t.*,u.username AS author_username,
          u.display_name AS author_display_name FROM forum_threads t
          JOIN users u ON u.id=t.author_id
          ORDER BY t.is_pinned DESC,t.last_reply_at DESC LIMIT 25 OFFSET ?`,
          (current - 1) * 25,
        ),
        total,
        page: current,
        total_pages: Math.max(1, Math.ceil(total / 25)),
      };
    },
    thread(id: number, page = 1, actorId: number | null = null) {
      const thread = db.all(
        "SELECT t.*,u.username,u.display_name,u.username AS author_username,u.display_name AS author_display_name FROM forum_threads t JOIN users u ON u.id=t.author_id WHERE t.id=?",
        id,
      )[0];
      if (!thread) throw missing();
      const current = Math.max(1, page);
      const total = Number(
        db.all(
          "SELECT count(*) AS count FROM forum_posts WHERE thread_id=?",
          id,
        )[0].count,
      );
      return {
        thread,
        total_posts: total,
        page: current,
        total_pages: Math.max(1, Math.ceil(total / 50)),
        watching:
          actorId !== null &&
          Boolean(
            db.all(
              "SELECT 1 FROM thread_watchers WHERE user_id=? AND thread_id=?",
              actorId,
              id,
            ).length,
          ),
        posts: db.all(
          "SELECT p.*,u.username,u.display_name,u.forum_signature,u.username AS author_username,u.display_name AS author_display_name,u.forum_signature AS author_signature FROM forum_posts p JOIN users u ON u.id=p.author_id WHERE thread_id=? ORDER BY p.created_at ASC LIMIT 50 OFFSET ?",
          id,
          (current - 1) * 50,
        ),
      };
    },
    createThread(
      actorId: number,
      title: string,
      content: string,
      contentFormat: string,
      customization: Row = {},
    ) {
      member(actorId);
      required(title, 200, "Title");
      required(content, 500000, "Post");
      format(contentFormat);
      return db.transaction(() => {
        enforceForumRate(actorId);
        const thread = db.all(
          "INSERT INTO forum_threads(author_id,title,last_reply_by_id,custom_css,custom_html) VALUES(?,?,?,?,?) RETURNING id",
          actorId,
          title.trim(),
          actorId,
          String(customization.custom_css ?? ""),
          String(customization.custom_html ?? ""),
        )[0];
        db.all(
          "INSERT INTO forum_posts(thread_id,author_id,content,content_format) VALUES(?,?,?,?)",
          thread.id,
          actorId,
          content,
          contentFormat,
        );
        db.all(
          "INSERT OR IGNORE INTO thread_watchers(user_id,thread_id) VALUES(?,?)",
          actorId,
          thread.id,
        );
        return Number(thread.id);
      });
    },
    toggleThreadWatch(actorId: number, threadId: number) {
      member(actorId);
      this.thread(threadId);
      return db.transaction(() => {
        const existing = db.all(
          "SELECT 1 FROM thread_watchers WHERE user_id=? AND thread_id=?",
          actorId,
          threadId,
        ).length;
        if (existing)
          db.all(
            "DELETE FROM thread_watchers WHERE user_id=? AND thread_id=?",
            actorId,
            threadId,
          );
        else
          db.all(
            "INSERT INTO thread_watchers(user_id,thread_id) VALUES(?,?)",
            actorId,
            threadId,
          );
        return !existing;
      });
    },
    reply(
      actorId: number,
      threadId: number,
      content: string,
      contentFormat: string,
      quote: Row = {},
    ) {
      member(actorId);
      required(content, 500000, "Reply");
      format(contentFormat);
      return db.transaction(() => {
        enforceForumRate(actorId);
        const { thread } = this.thread(threadId);
        if (thread.is_locked)
          throw new CommunityError(403, "This thread is locked");
        const quotedId = quote.quoted_post_id
          ? Number(quote.quoted_post_id)
          : null;
        const quoted = quotedId
          ? db.all(
              "SELECT content_format FROM forum_posts WHERE id=?",
              quotedId,
            )[0]
          : null;
        const post = db.all(
          "INSERT INTO forum_posts(thread_id,author_id,content,content_format,quoted_post_id,quoted_content,quoted_content_format,quoted_author) VALUES(?,?,?,?,?,?,?,?) RETURNING id",
          threadId,
          actorId,
          content,
          contentFormat,
          quotedId,
          quote.quoted_content || null,
          quoted?.content_format ?? null,
          quote.quoted_author || null,
        )[0];
        db.all(
          "UPDATE forum_threads SET reply_count=reply_count+1,last_reply_at=CURRENT_TIMESTAMP,last_reply_by_id=? WHERE id=?",
          actorId,
          threadId,
        );
        return Number(post.id);
      });
    },
    editPost(
      actorId: number,
      postId: number,
      content: string,
      contentFormat: string,
    ) {
      const row = db.all(
        "SELECT author_id FROM forum_posts WHERE id=?",
        postId,
      )[0];
      if (!row) throw missing();
      owned(actorId, Number(row.author_id));
      required(content, 500000, "Post");
      format(contentFormat);
      db.all(
        "UPDATE forum_posts SET content=?,content_format=?,is_edited=1,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        content,
        contentFormat,
        postId,
      );
    },
    deleteThread(actorId: number, threadId: number) {
      const actor = member(actorId);
      const found = db.all(
        "SELECT author_id FROM forum_threads WHERE id=?",
        threadId,
      )[0];
      if (!found || (Number(found.author_id) !== actorId && !actor.is_admin))
        throw missing();
      db.all("DELETE FROM forum_threads WHERE id=?", threadId);
    },
    threadForEdit(actorId: number, threadId: number) {
      const { thread } = this.thread(threadId);
      owned(actorId, Number(thread.author_id));
      return thread;
    },
    editThread(actorId: number, threadId: number, input: Row) {
      this.threadForEdit(actorId, threadId);
      db.all(
        "UPDATE forum_threads SET title=?,custom_css=?,custom_html=? WHERE id=?",
        String(input.title ?? "").trim(),
        String(input.custom_css ?? ""),
        String(input.custom_html ?? ""),
        threadId,
      );
    },
    moderate(actorId: number, threadId: number, action: string) {
      admin(actorId);
      this.thread(threadId);
      if (action === "delete")
        db.all("DELETE FROM forum_threads WHERE id=?", threadId);
      else if (action === "lock" || action === "pin") {
        const key = action === "lock" ? "is_locked" : "is_pinned";
        db.all(`UPDATE forum_threads SET ${key}=1-${key} WHERE id=?`, threadId);
      } else throw new CommunityError(422, "Unknown moderation action");
    },
    ...createChatRoom(db, member, chatFloodLimit),
    chat(actorId: number, after: number) {
      member(actorId);
      return db.all(
        "SELECT c.*,u.username,u.display_name FROM chat_messages c JOIN users u ON u.id=c.author_id WHERE c.id>? ORDER BY c.id LIMIT 200",
        after,
      );
    },
    adminMembers(actorId: number) {
      admin(actorId);
      return db.all(`SELECT ${memberColumns} FROM users ORDER BY username`);
    },
    postForEdit(actorId: number, postId: number) {
      const post = db.all("SELECT * FROM forum_posts WHERE id=?", postId)[0];
      if (!post) throw missing();
      owned(actorId, Number(post.author_id));
      return post;
    },
    deletePost(actorId: number, postId: number) {
      return db.transaction(() => {
        const post = this.postForEdit(actorId, postId);
        db.all("DELETE FROM forum_posts WHERE id=?", postId);
        db.all(
          "UPDATE forum_threads SET reply_count=reply_count-1 WHERE id=?",
          post.thread_id,
        );
        return Number(post.thread_id);
      });
    },
    setDisabled(actorId: number, userId: number, disabled: boolean) {
      admin(actorId);
      if (!db.all("SELECT id FROM users WHERE id=?", userId).length)
        throw missing();
      if (actorId === userId && disabled)
        throw new CommunityError(409, "You cannot disable yourself");
      db.all(
        "UPDATE users SET is_disabled=? WHERE id=?",
        disabled ? 1 : 0,
        userId,
      );
      if (disabled)
        db.all("DELETE FROM browser_sessions WHERE user_id=?", userId);
    },
  };
}

export type Community = ReturnType<typeof createCommunity>;
