import { expect, test } from "vitest";
import { renderToString } from "remix/component/server";
import { Guestbook } from "../app/widgets.tsx";
import { Profile } from "../app/views.tsx";

test("guestbook remains a bare embeddable document with the owner's saved assets", async () => {
  const html = await renderToString(
    <Guestbook
      owner={{
        id: 41,
        username: "owner",
        display_name: "Owner",
        guestbook_css: ".gb-entry { color: blue }",
        guestbook_html: "<footer>Saved footer</footer>",
      }}
      entries={[]}
      member={null}
    />,
  );
  expect(html).toContain("<html>");
  expect(html).not.toContain('class="topbar"');
  expect(html).toContain(".gb-entry { color: blue }");
  expect(html).toContain("<footer>Saved footer</footer>");
  expect(html).toContain('target="_parent"');
  expect(html).toContain('id="gb-entries"');
});

test("profile keeps embedded guestbook placement in saved content rather than adding a separate widget menu", async () => {
  const html = await renderToString(
    <Profile
      profile={{
        username: "owner",
        display_name: "Owner",
        content: '<iframe src="/u/owner/guestbook"></iframe>',
        content_format: "html",
      }}
      pages={[]}
    />,
  );
  expect(html).toContain(
    '<div class="e-note"><iframe src="/u/owner/guestbook"></iframe></div>',
  );
  expect(html).toContain('class="panel h-card"');
  expect(html).not.toContain(">Guestbook</a>");
});
