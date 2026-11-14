import { expect, test } from "bun:test";
import { createElement } from "remix/component";
import { renderToString } from "remix/component/server";
import { PoolPage } from "../../app/page.tsx";
test("optional account action is plain Sign in without changing its route", async () => {
  const html = await renderToString(createElement(PoolPage, {}));
  expect(html).toMatch(/id="sign-in" href="\/auth\/login" hidden>Sign in<\/a>/);
  expect(html).not.toMatch(/Jack\s*Auth/i);
});
