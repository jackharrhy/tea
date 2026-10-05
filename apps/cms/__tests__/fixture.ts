import { join } from "node:path";
import bcrypt from "bcryptjs";
import { openDatabase } from "@tea/cms-core/data/database.ts";
import { ContentStore } from "@tea/cms-core/data/content.ts";
import { AuthStore } from "@tea/cms-core/data/auth.ts";
import type { SiteRuntime } from "@tea/cms-core/site.ts";

export const credentials = {
  email: "editor@example.test",
  password: "generated-fixture-password",
};
export async function seedFixture(site: SiteRuntime) {
  const { sqlite } = await openDatabase(join(site.dataDir, "tea.db"));
  try {
    const user = sqlite
      .prepare("INSERT INTO users(email,password_hash) VALUES (?,?)")
      .run(credentials.email, await bcrypt.hash(credentials.password, 4));
    const session = new AuthStore(sqlite).createSession(
      Number(user.lastInsertRowid),
    );
    const store = new ContentStore(sqlite);
    const home = store.homepage();
    const blocks = [
      {
        id: "heading",
        type: "heading",
        props: { level: 1 },
        content: [{ type: "text", text: site.name }],
      },
      {
        id: "text",
        type: "paragraph",
        props: {},
        content: [
          {
            type: "text",
            text: "A generated fixture for editing and publishing.",
          },
        ],
      },
    ];
    store.savePage("", { ...home, blocks }, home.revision);
    const created = store.createPage("Example page", "example");
    if (!created.ok) throw new Error(created.error);
    store.publishDraft("example", created.page.revision);
    store.saveSidebar(
      {
        top_image_id: null,
        categories: [
          {
            categoryTitle: "Pages",
            items: [{ text: "Example page", pageSlug: "example" }],
          },
        ],
        links: [],
      },
      store.sidebar().revision,
    );
    return { cookie: `tea-session-${site.id}=${session.id}` };
  } finally {
    sqlite.close();
  }
}
