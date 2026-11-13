import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { schema } from "../app/data/schema.ts";
import { createWidgets } from "../app/data/widgets.ts";
import type { Row } from "../app/data/community.ts";
it("keeps the source public-page settling window, per-user filter and 100-entry limit", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(schema);
    db.exec(
      "INSERT INTO users(id,username,display_name,password_hash) VALUES(41,'fixture','Fixture',''); INSERT INTO users(id,username,display_name,password_hash,is_disabled) VALUES(72,'other','Other','',1)",
    );
    const widgets = createWidgets(
      {
        all(sql, ...values) {
          const query = db.prepare(sql);
          return query.columns().length
            ? (query.all(...values) as Row[])
            : (query.run(...values), []);
        },
        transaction: (fn) => fn(),
      },
      () => {
        throw Error("Not needed for public feed");
      },
    );
    const insert = db.prepare(
      "INSERT INTO pages(id,user_id,slug,title,is_public,updated_at) VALUES(?,?,?,?,?,?)",
    );
    for (let index = 0; index < 101; index++)
      insert.run(
        index + 1,
        41,
        "page-" + index,
        "Public " + index,
        1,
        new Date(Date.UTC(2000, 0, 1, 0, 0, index))
          .toISOString()
          .replace("T", " ")
          .replace(".000Z", ""),
      );
    insert.run(200, 41, "private", "Private", 0, "2001-01-01 00:00:00");
    insert.run(201, 41, "recent", "Recent", 1, "2999-01-01 00:00:00");
    insert.run(
      202,
      72,
      "public-other",
      "Other public",
      1,
      "2010-01-01 00:00:00",
    );
    const rows = widgets.feed(null);
    expect(rows).toHaveLength(100);
    expect(rows[0].username).toBe("other");
    expect(
      rows.some((row) => row.slug === "private" || row.slug === "recent"),
    ).toBe(false);
    expect(widgets.feed("fixture")).toHaveLength(100);
    expect(
      widgets.feed("fixture").every((row) => row.username === "fixture"),
    ).toBe(true);
    db.exec(
      "INSERT INTO forum_threads(id,author_id,title) VALUES(1,41,'Thread'); INSERT INTO forum_posts(id,thread_id,author_id,content,created_at) VALUES(1,1,41,'Post','2000-01-01 00:00:00'),(2,1,72,'Reply','2001-01-01 00:00:00')",
    );
    expect(
      widgets.forumFeed().map((row) => [row.id, row.author_display_name]),
    ).toEqual([
      [2, "Other"],
      [1, "Fixture"],
    ]);
  } finally {
    db.close();
  }
});
