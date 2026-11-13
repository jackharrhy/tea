import { it, expect } from "vitest";
import { content, postContent } from "../app/rendering.ts";

it("renders member Markdown and preserves deliberately trusted page HTML", () => {
  expect(content("# Hello", "markdown")).toContain("<h1>Hello</h1>");
  expect(content("<script>memberCustomization()</script>", "html")).toContain(
    "<script>",
  );
});
it("sanitizes shared posts while retaining BBCode links, images and emphasis", () => {
  const output = postContent(
    "[b]Hello[/b] [url=https://example.com]link[/url] [img]https://example.com/image.png[/img]<script>bad()</script>",
    "bbcode",
  );
  expect(output).toContain("<strong>Hello</strong>");
  expect(output).toContain('href="https://example.com"');
  expect(output).toContain("<img");
  expect(output).not.toContain("<script>");
  expect(
    postContent(
      '<a href="javascript:alert(1)">bad</a><img src="x" onerror="alert(1)">',
      "html",
    ),
  ).not.toMatch(/javascript:|onerror/);
});

it("matches source BBCode escaping, line breaks, emphasis, images and code", () => {
  expect(postContent(`it's "okay" & <script>x</script>`, "bbcode")).toBe(
    "it&#39;s &quot;okay&quot; &amp; &lt;script&gt;x&lt;/script&gt;",
  );
  expect(
    postContent("[b]Bold[/b] [i]italic[/i] [u]u[/u] [s]s[/s]", "bbcode"),
  ).toBe("<strong>Bold</strong> <em>italic</em> <u>u</u> s");
  expect(postContent("one\ntwo", "bbcode")).toBe("one<br>two");
  expect(postContent("[img]https://example.com/a.png[/img]", "bbcode")).toBe(
    '<img src="https://example.com/a.png" alt="">',
  );
  expect(postContent("[code]<b>x</b>\nhello[/code]", "bbcode")).toBe(
    "<code>&lt;b&gt;x&lt;/b&gt;\nhello</code>",
  );
  expect(postContent("[quote=Sam]hello[/quote]", "bbcode")).toBe(
    "<blockquote>hello</blockquote>",
  );
  expect(postContent("[size=20]large[/size]", "bbcode")).toBe(
    "[size=20]large[/size]",
  );
});

it("matches source automatic links, punctuation, and Markdown media boundaries", () => {
  expect(postContent("See https://example.com now -- okay...", "bbcode")).toBe(
    'See <a href="https://example.com">https://example.com</a> now &ndash; okay&#8230;',
  );
  expect(postContent("[code]https://example.com -- ...[/code]", "bbcode")).toBe(
    "<code>https://example.com -- ...</code>",
  );
  expect(postContent("![sample](https://example.com/a.png)", "markdown")).toBe(
    '<p><img alt="sample" src="https://example.com/a.png"></p>',
  );
  expect(
    postContent('<img src="https://example.com/a.png">\n\nNext', "markdown"),
  ).toBe('<p><img src="https://example.com/a.png"></p>\n<p>Next</p>');
  expect(
    postContent(
      '<iframe src="https://example.com" allowfullscreen></iframe>',
      "markdown",
    ),
  ).toBe('<iframe src="https://example.com" allowfullscreen=""></iframe>');
  expect(
    postContent("[url=javascript:alert(1)]bad[/url]", "bbcode"),
  ).not.toContain("href=");
});

it("renders Python-style Markdown image sizing and keeps shared-post sanitization", () => {
  expect(
    content('![sample](/image.png){width="120" height=80 .photo}', "markdown"),
  ).toContain('width="120"');
  expect(
    content('![sample](/image.png){width="120" height=80 .photo}', "markdown"),
  ).toContain('class="photo"');
  const shared = postContent(
    '![sample](/image.png){width=120 height=80 onerror="bad()" .photo}',
    "markdown",
  );
  expect(shared).toContain('width="120"');
  expect(shared).toContain('height="80"');
  expect(shared).not.toMatch(/onerror|class=|\{width/);
});
it("renders heading and paragraph attributes without changing code or raw HTML", () => {
  expect(content("# Heading ## {.title}", "markdown")).toContain(
    '<h1 class="title">Heading</h1>',
  );
  expect(content("# Heading {.one .two #anchor}", "markdown")).toContain(
    '<h1 class="one two" id="anchor">Heading</h1>',
  );
  expect(content("Paragraph\n{: .note}", "markdown")).toContain(
    '<p class="note">Paragraph</p>',
  );
  expect(content("`code`{.inline}", "markdown")).toContain(
    '<code class="inline">code</code>',
  );
  expect(
    content("```text\n![sample](/x){width=120}\n```", "markdown"),
  ).toContain("{width=120}");
  expect(content("<span>Raw</span>{.literal}", "markdown")).toContain(
    "</span>{.literal}",
  );
});
