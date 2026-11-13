import { expect, it } from "vitest";
import { pagesFeed, forumFeed } from "../app/feeds.ts";
it("matches page feed metadata, dates, escaping and revision-specific GUIDs", () => {
  const rows = [
    {
      username: "alice",
      display_name: 'A & "B"',
      slug: "notes",
      title: "<Notes>",
      updated_at: "2026-11-13 01:00:00.000000",
    },
  ];
  const global = pagesFeed("https://review.invalid", rows);
  expect(global).toContain(
    "<title>4orm updates</title><link>https://review.invalid/</link>",
  );
  expect(global).toContain(
    "<title>A &amp; &quot;B&quot;: &lt;Notes&gt;</title>",
  );
  expect(global).toContain(
    "<guid>https://review.invalid/u/alice/page/notes#2026-11-13 01:00:00</guid>",
  );
  expect(global).toContain(
    "<pubDate>Fri, 13 Nov 2026 01:00:00 +0000</pubDate>",
  );
  expect(pagesFeed("https://review.invalid", rows, rows[0])).toContain(
    "<title>4orm updates from A &amp; &quot;B&quot;</title>",
  );
});
it("uses forum post anchors and author/thread titles rather than thread listings", () => {
  const xml = forumFeed("https://review.invalid", [
    {
      id: 9,
      thread_id: 4,
      author_display_name: "Reply author",
      thread_title: "A thread",
      created_at: "2026-11-13T03:00:00+02:00",
    },
  ]);
  expect(xml).toContain("<title>Reply author in A thread</title>");
  expect(xml).toContain("<guid>https://review.invalid/forum/4#post-9</guid>");
  expect(xml).toContain("<pubDate>Fri, 13 Nov 2026 03:00:00 +0200</pubDate>");
});
