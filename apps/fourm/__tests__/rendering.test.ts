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
  expect(output).toContain("font-weight:bold");
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
