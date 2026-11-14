import { expect, test } from "vitest";
import { createElement } from "remix/component";
import { renderToString } from "remix/component/server";
import { AuthPage } from "../page.tsx";
test("public Ref contains only its wordmark and plain sign-in action", async () => {
  const html = await renderToString(createElement(AuthPage, {}));
  expect(html).toContain('<h1 class="wordmark">ref</h1>');
  expect(html).toMatch(/href="\/auth\/login"[^>]*>Sign in<\/a>/);
  expect(html).not.toMatch(
    /Jack\s*Auth|A shared board|Collect visual references|auth-intro/i,
  );
});
test("minimal sign-in retains escaped actionable errors", async () => {
  const html = await renderToString(
    createElement(AuthPage, { error: "Try again <safely>" }),
  );
  expect(html).toContain('role="alert"');
  expect(html).toContain("Try again &lt;safely&gt;");
});
