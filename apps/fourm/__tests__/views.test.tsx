import { expect, test } from "vitest";
import { renderToString } from "remix/component/server";
import { Format, PageEditor } from "../app/views.tsx";

test("editing preserves the selected content format in server-rendered HTML", async () => {
  const html = await renderToString(<Format value="bbcode" bbcode />);
  expect(html).toMatch(/<option(?=[^>]*value="bbcode")(?=[^>]*selected)[^>]*>/);
});

test("editing renders stored page content as escaped textarea text", async () => {
  const html = await renderToString(
    <PageEditor
      page={{
        slug: "hello.world",
        content: "<p>Keep this</p>",
        content_format: "markdown",
      }}
    />,
  );
  expect(html).toContain("&lt;p&gt;Keep this&lt;/p&gt;</textarea>");
  expect(html).toMatch(
    /<option(?=[^>]*value="markdown")(?=[^>]*selected)[^>]*>/,
  );
  expect(html).not.toContain("defaultvalue=");
});
