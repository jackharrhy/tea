import { CommunityError } from "./community.ts";
import type { Database, Member, Row } from "./community.ts";
import type { pageContent } from "./page-content.ts";
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
  return {
    adminSnapshot(actorId: number | null) {
      requireAdmin(actorId);
      return {
        users: db.all(
          "SELECT id,username,display_name,is_admin,is_disabled,in_webring,created_at FROM users ORDER BY created_at",
        ),
        banner: db.all("SELECT * FROM site_settings WHERE id=1")[0] ?? null,
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
