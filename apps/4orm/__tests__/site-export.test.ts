import { unzipSync, strToU8, strFromU8 } from "fflate";
import { it, expect } from "vitest";
import {
  userExportHTML,
  exportPage,
  forumExportHTML,
  streamedZIP,
} from "../app/site-export.ts";

async function* entries() {
  yield { name: "one.html", body: strToU8("<p>one</p>") };
  yield {
    name: "media.bin",
    body: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1, 2]));
        c.enqueue(new Uint8Array([3]));
        c.close();
      },
    }),
  };
}
async function* broken() {
  yield { name: "one", body: strToU8("one") };
  throw new Error("source unavailable");
}

it("retains default, raw and CSS-only exports with relative media and owner customization", () => {
  const profile = {
    username: "alice",
    display_name: "<Alice>",
    layout: "default",
    content: '<img src="/uploads/alice/a.png">',
    content_format: "html",
    custom_css: "body{background:url(/uploads/alice/bg.png)}",
    custom_html: "<footer>custom</footer>",
  };
  const pages = [
    {
      slug: "one",
      title: "Page <1>",
      layout: "default",
      content: '<img src="/uploads/alice/a.png">',
      content_format: "html",
    },
  ];
  const files = userExportHTML(profile, pages, "https://4orm.harrhy.xyz");
  expect(Object.keys(files)).toEqual(["index.html", "pages/one.html"]);
  expect(files["index.html"]).toContain("<h1>&lt;Alice&gt;</h1>");
  expect(files["index.html"]).toContain('href="pages/one.html"');
  expect(files["index.html"]).toContain('src="uploads/a.png"');
  expect(files["pages/one.html"]).toContain('src="../uploads/a.png"');
  expect(files["pages/one.html"]).toContain('href="../style.css"');
  expect(files["index.html"]).toContain("<footer>custom</footer>");
  const raw = exportPage(
    "unused",
    "<body>original</body>",
    profile,
    "raw",
    "style.css",
    "https://4orm.harrhy.xyz",
  );
  expect(raw.startsWith("<body>original</body>\n<style>")).toBe(true);
  expect(raw).not.toContain('class="topbar"');
  expect(
    userExportHTML(
      { ...profile, layout: "cssonly" },
      [],
      "https://4orm.harrhy.xyz",
    )["index.html"],
  ).not.toContain("<img");
});

it("streams a readable ZIP with file bytes and propagates producer failures", async () => {
  const bytes = new Uint8Array(
    await new Response(streamedZIP(entries())).arrayBuffer(),
  );
  const files = unzipSync(bytes);
  expect(strFromU8(files["one.html"])).toBe("<p>one</p>");
  expect([...files["media.bin"]]).toEqual([1, 2, 3]);
  await expect(
    new Response(streamedZIP(broken())).arrayBuffer(),
  ).rejects.toThrow("source unavailable");
});
it("exports forum quote, signature, metadata and cross-user media references", () => {
  const html = forumExportHTML(
    [
      {
        id: 1,
        title: "<Topic>",
        author_username: "alice",
        author_display_name: "Alice",
        created_at: "2026-11-12 12:34:56",
        is_pinned: 1,
        is_locked: 1,
        reply_count: 1,
        custom_css: "img{background:url(/uploads/alice/a.png)}",
      },
    ],
    [
      {
        id: 2,
        thread_id: 1,
        author_username: "bob",
        author_display_name: "Bob",
        content: "[img]/uploads/bob/b.png[/img]",
        content_format: "bbcode",
        quoted_content: "<quote>",
        quoted_author: "<Alice>",
        author_signature: "[b]sig[/b]",
        created_at: "2026-11-12 12:35:00",
        is_edited: 1,
      },
    ],
    "https://4orm.harrhy.xyz",
  );
  expect(html["forum/1.html"]).toContain("&lt;Alice&gt; wrote:");
  expect(html["forum/1.html"]).toContain("&lt;quote&gt;");
  expect(html["forum/1.html"]).toContain("../users/bob/uploads/b.png");
  expect(html["forum/1.html"]).toContain("<strong>sig</strong>");
  expect(html["forum/1.html"]).toContain("📌 pinned · 🔒 locked");
  expect(html["forum/index.html"]).toContain('href="1.html"');
});
