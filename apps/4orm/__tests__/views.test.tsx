import { expect, test } from "vitest";
import { renderToString } from "remix/component/server";
import { Format } from "../app/views.tsx";
import { ContentEditor } from "../app/settings-view.tsx";

test("editing preserves the selected content format in server-rendered HTML", async () => {
  const html = await renderToString(<Format value="bbcode" bbcode />);
  expect(html).toMatch(/<option(?=[^>]*value="bbcode")(?=[^>]*selected)[^>]*>/);
});

test("editing renders stored page content as escaped textarea text", async () => {
  const html = await renderToString(
    <ContentEditor
      id="edit_content"
      value="<p>Keep this</p>"
      format="markdown"
    />,
  );
  expect(html).toContain("&lt;p&gt;Keep this&lt;/p&gt;</textarea>");
  expect(html).toMatch(/<input(?=[^>]*value="markdown")(?=[^>]*checked)[^>]*>/);
  expect(html).not.toContain("defaultvalue=");
});
