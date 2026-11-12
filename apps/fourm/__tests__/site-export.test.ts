import { it, expect } from "vitest";
import { userExportHTML, exportPage } from "../app/site-export.ts";
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
