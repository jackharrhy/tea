import { expect, test } from "vitest";
import { guestbookDocument } from "../app/widgets.tsx";
import { profileBody, rawMemberPage } from "../app/member-pages.tsx";

test("guestbook remains a bare embeddable document with the owner's saved assets", async () => {
  const html = await guestbookDocument({
    owner: {
      id: 41,
      username: "owner",
      display_name: "Owner",
      guestbook_css: ".gb-entry { color: blue }",
      guestbook_html: "<footer>Saved footer</footer>",
    },
    entries: [],
    member: null,
  });
  expect(html).toContain("<html>");
  expect(html).not.toContain('class="topbar"');
  expect(html).toContain(".gb-entry { color: blue }");
  expect(html).toContain("<footer>Saved footer</footer></body>");
  expect(html).toContain('target="_parent"');
  expect(html).toContain('id="gb-entries"');
});

test("profile keeps embedded guestbook placement in saved content rather than adding a separate widget menu", async () => {
  const html = await profileBody(
    {
      username: "owner",
      display_name: "Owner",
      content: '<iframe src="/u/owner/guestbook"></iframe>',
      content_format: "html",
    },
    [],
  );
  expect(html).toContain(
    '<div class="e-note"><iframe src="/u/owner/guestbook"></iframe></div>',
  );
  expect(html).toContain('class="panel h-card"');
  expect(html).not.toContain(">Guestbook</a>");
});

test("raw profile metadata precedes user scripts and css-only profiles retain the original blank content area", async () => {
  const profile = {
    username: "owner",
    display_name: "Owner",
    content:
      "<html><head><script>window.first = window.__4ORM.username</script></head><body>Member content</body></html>",
    content_format: "html",
    custom_html: "<footer>Saved</footer>",
    custom_css: "body{color:blue}",
  };
  const html = rawMemberPage(profile, profile, {
    username: "owner",
    pages: [],
  });
  expect(html.indexOf("window.__4ORM =")).toBeLessThan(
    html.indexOf("window.first"),
  );
  const cssOnly = await profileBody({ ...profile, layout: "cssonly" }, []);
  expect(cssOnly).toBe("<style>body{color:blue}</style><footer>Saved</footer>");
});
