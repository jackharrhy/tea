import { describe, expect, test } from "bun:test";
import { highlightTemplateSource } from "../src/services/source-highlighter";

describe("template source highlighting", () => {
  test("highlights markup without turning template source into executable HTML", async () => {
    const highlighted = await highlightTemplateSource(
      '<main>Hello</main></code></pre><script>alert("nope")</script>',
      "html",
    );

    expect(highlighted).toContain('class="shiki github-light"');
    expect(highlighted).toContain("&#x3C;");
    expect(highlighted).not.toContain("<script>");
    expect(highlighted).not.toContain("</code></pre><script>");
  });
});
