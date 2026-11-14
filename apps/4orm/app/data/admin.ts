import { CommunityError } from "./community.ts";
import type { Database, Member, Row } from "./community.ts";
import type { pageContent } from "./page-content.ts";
const cardColors = [
  "#ffd6a5",
  "#fdffb6",
  "#caffbf",
  "#9bf6ff",
  "#a0c4ff",
  "#bdb2ff",
  "#ffc6ff",
  "#ffadad",
  "#d0f4de",
  "#fefae0",
  "#fbc4ab",
  "#cdeac0",
];
function shuffledCardColors() {
  const colors = [...cardColors];
  for (let index = colors.length - 1; index > 0; index--) {
    const count = index + 1,
      limit = 2 ** 32 - (2 ** 32 % count);
    let random: number;
    do {
      random = crypto.getRandomValues(new Uint32Array(1))[0];
    } while (random >= limit);
    const selected = random % count;
    [colors[index], colors[selected]] = [colors[selected], colors[index]];
  }
  return colors;
}
export function createAdmin(
  db: Database,
  admin: (id: number) => Member,
  pageBodies: ReturnType<typeof pageContent>,
) {
  function requireAdmin(actorId: number | null) {
    if (actorId === null)
      throw new CommunityError(403, "Admin access required");
    return admin(actorId);
  }
  function update(
    table: "users" | "profile_cards",
    key: "id" | "user_id",
    id: number,
    defaults: Record<string, string>,
    input: Row,
  ) {
    if (!db.all(`SELECT ${key} FROM ${table} WHERE ${key}=?`, id).length)
      throw new CommunityError(404, "Not found");
    const fields = Object.keys(defaults);
    db.all(
      `UPDATE ${table} SET ${fields.map((f) => f + "=?").join(",")} WHERE ${key}=?`,
      ...fields.map((f) => String(input[f] ?? defaults[f])),
      id,
    );
  }
  function userRow(id: number) {
    const user = db.all(
      "SELECT id,username,display_name,is_admin,is_disabled,in_webring,created_at FROM users WHERE id=?",
      id,
    )[0];
    if (!user) throw new CommunityError(404, "Not found");
    return {
      user,
      stats: db.all(
        "SELECT count(id) AS file_count,coalesce(sum(size_bytes),0) AS total_bytes FROM media WHERE user_id=?",
        id,
      )[0],
    };
  }
  return {
    adminMediaInventory(actorId: number | null) {
      requireAdmin(actorId);
      return db.transaction(() => ({
        paths: db
          .all("SELECT storage_path FROM media")
          .map((row) => String(row.storage_path)),
        reserved: [
          ...new Set(
            [
              ...db.all("SELECT storage_path AS path FROM media_transfers"),
              ...db.all("SELECT old_path AS path FROM media_move_files"),
              ...db.all("SELECT new_path AS path FROM media_move_files"),
              ...db.all(
                "SELECT storage_path AS path FROM account_cleanup_objects",
              ),
              ...db.all(
                "SELECT storage_path AS path FROM orphan_cleanup_objects",
              ),
              ...db.all(
                "SELECT storage_path AS path FROM archive_staging_objects",
              ),
            ].map((row) => String(row.path)),
          ),
        ],
      }));
    },
    adminRandomizeCards(actorId: number | null) {
      requireAdmin(actorId);
      return db.transaction(() => {
        const cards = db.all(
          "SELECT user_id FROM profile_cards WHERE accent_color='#00ffff'",
        );
        const colors = shuffledCardColors();
        cards.forEach((card, index) =>
          db.all(
            "UPDATE profile_cards SET accent_color=? WHERE user_id=?",
            colors[index % colors.length],
            card.user_id,
          ),
        );
        return cards.length;
      });
    },
    adminUserRow(actorId: number | null, userId: number) {
      requireAdmin(actorId);
      return userRow(userId);
    },
    adminToggleAccount(
      actorId: number | null,
      userId: number,
      field: "is_admin" | "is_disabled",
    ) {
      requireAdmin(actorId);
      if (field !== "is_admin" && field !== "is_disabled")
        throw new CommunityError(422, "Invalid account action");
      return db.transaction(() => {
        userRow(userId);
        db.all(`UPDATE users SET ${field}=1-${field} WHERE id=?`, userId);
        return userRow(userId);
      });
    },
    adminSetWebring(actorId: number | null, userId: number, enabled: boolean) {
      requireAdmin(actorId);
      userRow(userId);
      db.all(
        "UPDATE users SET in_webring=? WHERE id=?",
        enabled ? 1 : 0,
        userId,
      );
      return userRow(userId);
    },
    adminIdentitySubject(
      actorId: number | null,
      userId: number,
      issuer: string,
    ) {
      requireAdmin(actorId);
      userRow(userId);
      const links = db.all(
        "SELECT subject FROM external_identities WHERE user_id=? AND issuer=?",
        userId,
        issuer,
      );
      if (links.length !== 1)
        throw new CommunityError(
          409,
          links.length
            ? "This account has ambiguous central identity links"
            : "This account has no central identity link",
        );
      return String(links[0].subject);
    },
    adminSnapshot(actorId: number | null) {
      requireAdmin(actorId);
      return {
        users: db.all(
          "SELECT id,username,display_name,is_admin,is_disabled,in_webring,created_at FROM users ORDER BY created_at",
        ),
        banner: db.all("SELECT * FROM site_settings WHERE id=1")[0] ?? null,
        storage: db.all(
          "SELECT u.id,count(m.id) AS file_count,coalesce(sum(m.size_bytes),0) AS total_bytes FROM users u LEFT JOIN media m ON m.user_id=u.id GROUP BY u.id",
        ),
        cards: db.all("SELECT * FROM profile_cards ORDER BY user_id"),
        threads: db.all(
          "SELECT t.id,t.title,t.is_pinned,t.is_locked,t.reply_count,t.created_at,u.username AS author_username FROM forum_threads t JOIN users u ON u.id=t.author_id ORDER BY t.created_at DESC",
        ),
        posts: db.all(
          "SELECT p.id,p.thread_id,p.content,p.content_format,p.created_at,p.is_edited,u.username AS author_username,t.title AS thread_title FROM forum_posts p JOIN users u ON u.id=p.author_id JOIN forum_threads t ON t.id=p.thread_id ORDER BY p.created_at DESC LIMIT 100",
        ),
        pages: db
          .all(
            "SELECT p.*,u.username FROM pages p JOIN users u ON u.id=p.user_id ORDER BY p.updated_at DESC",
          )
          .map(pageBodies.read),
      };
    },
    adminSaveBanner(actorId: number | null, input: Row) {
      requireAdmin(actorId);
      db.all(
        "INSERT INTO site_settings(id,banner_enabled,banner_html,banner_css) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET banner_enabled=excluded.banner_enabled,banner_html=excluded.banner_html,banner_css=excluded.banner_css",
        input.banner_enabled ? 1 : 0,
        String(input.banner_html ?? ""),
        String(input.banner_css ?? ""),
      );
    },
    adminSaveProfile(actorId: number | null, userId: number, input: Row) {
      requireAdmin(actorId);
      update(
        "users",
        "id",
        userId,
        {
          display_name: "",
          content: "",
          content_format: "html",
          custom_css: "",
          custom_html: "",
          layout: "default",
        },
        input,
      );
    },
    adminSaveCard(actorId: number | null, userId: number, input: Row) {
      requireAdmin(actorId);
      update(
        "profile_cards",
        "user_id",
        userId,
        {
          headline: "",
          content: "",
          content_format: "markdown",
          accent_color: "#00ffff",
          border_style: "outset",
          card_css: "",
        },
        input,
      );
    },
    adminSavePage(actorId: number | null, pageId: number, input: Row) {
      requireAdmin(actorId);
      const { slug, title } = input;
      if (typeof slug !== "string" || typeof title !== "string")
        throw new CommunityError(422, "slug and title required");
      return db.transaction(() => {
        if (!db.all("SELECT id FROM pages WHERE id=?", pageId).length)
          throw new CommunityError(404, "Not found");
        const content = String(input.content ?? "");
        const chunks = pageBodies.chunks(content);
        db.all(
          "UPDATE pages SET slug=?,title=?,content=?,content_format=?,is_public=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
          slug.trim(),
          title.trim(),
          chunks.length ? "" : content,
          String(input.content_format ?? "html"),
          input.is_public === "on" ? 1 : 0,
          pageId,
        );
        pageBodies.write(pageId, chunks);
      });
    },
  };
}
