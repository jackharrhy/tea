import { CommunityError } from "./community.ts";
import type { Database, Member, Row } from "./community.ts";

const sections: Record<string, Record<string, string>> = {
  profile: {
    display_name: "",
    content: "",
    content_format: "html",
    layout: "default",
  },
  css: { custom_css: "" },
  html: { custom_html: "" },
  guestbook: { guestbook_css: "", guestbook_html: "" },
  counter: { counter_css: "", counter_html: "" },
  status: {
    status_emoji: "",
    status_text: "",
    status_css: "",
    status_html: "",
  },
  player: { player_css: "", player_html: "" },
  signature: { forum_signature: "" },
  notifications: { notifications_enabled: "", watch_all_threads: "" },
};
export function createSettings(db: Database, member: (id: number) => Member) {
  return {
    saveSettingsSection(actorId: number, section: string, input: Row) {
      member(actorId);
      if (!Object.hasOwn(sections, section))
        throw new CommunityError(404, "Settings section not found");
      const values: Row = {};
      for (const [key, fallback] of Object.entries(sections[section]))
        values[key] = String(input[key] ?? fallback);
      if (section === "status") {
        values.status_emoji = Array.from(String(values.status_emoji))
          .slice(0, 10)
          .join("");
        values.status_text = Array.from(String(values.status_text))
          .slice(0, 140)
          .join("");
      }
      if (section === "signature")
        values.forum_signature = Array.from(String(values.forum_signature))
          .slice(0, 200)
          .join("");
      if (section === "notifications") {
        values.notifications_enabled =
          input.notifications_enabled === "on" ? 1 : 0;
        values.watch_all_threads = input.watch_all_threads === "on" ? 1 : 0;
      }
      if (section === "profile") {
        if (!["html", "markdown"].includes(String(values.content_format)))
          throw new CommunityError(422, "Unsupported profile content format");
        if (
          !["default", "simple", "raw", "cssonly"].includes(
            String(values.layout),
          )
        )
          throw new CommunityError(422, "Unsupported layout");
      }
      const keys = Object.keys(values);
      db.all(
        `UPDATE users SET ${keys.map((key) => `"${key}"=?`).join(",")}${section === "notifications" ? "" : ",updated_at=CURRENT_TIMESTAMP"}${section === "status" ? ",status_updated_at=CURRENT_TIMESTAMP" : ""} WHERE id=?`,
        ...keys.map((key) => values[key]),
        actorId,
      );
    },
  };
}
