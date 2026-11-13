import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const state = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../.local-real",
);
const { password } = JSON.parse(
  readFileSync(resolve(state, "seed.json"), "utf8"),
);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const seen = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (["/login", "/auth/callback", "/folders"].includes(url.pathname))
      seen.push([url.origin, url.pathname, response.status()]);
  });
  await page.goto("http://localhost:18892/login");
  await page.getByRole("link", { name: "Sign in" }).click();
  assert.equal(new URL(page.url()).origin, "http://localhost:18888");
  await page.locator('input[name="username"]').fill("local-artbin");
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("http://localhost:18892/folders");
  await page.getByRole("heading", { name: "Browse" }).waitFor();
  assert(
    seen.some(
      ([origin, path, status]) =>
        origin === "http://localhost:18892" &&
        path === "/auth/callback" &&
        status === 302,
    ),
  );
  assert(
    seen.some(
      ([origin, path, status]) =>
        origin === "http://localhost:18892" &&
        path === "/folders" &&
        status === 200,
    ),
  );
  const cookie = (await page.context().cookies("http://localhost:18892")).find(
    (item) => item.name === "artbin_session",
  );
  assert(cookie?.httpOnly);
  await page.reload();
  await page.getByRole("heading", { name: "Browse" }).waitFor();
  const home = await page.goto("http://localhost:18888/");
  assert.equal(home.status(), 200);
  await page.getByText("Artbin", { exact: true }).waitFor();

  const overlap = await browser.newContext();
  try {
    const first = await overlap.newPage();
    const second = await overlap.newPage();
    for (const tab of [first, second]) {
      await tab.goto("http://localhost:18892/login");
      await tab.getByRole("link", { name: "Sign in" }).click();
      assert.equal(new URL(tab.url()).origin, "http://localhost:18888");
    }
    const transactions = (
      await overlap.cookies("http://localhost:18892")
    ).filter((item) => item.name.startsWith("artbin_oauth_"));
    assert.equal(transactions.length, 2);
    for (const tab of [first, second]) {
      await tab.locator('input[name="username"]').fill("local-artbin");
      await tab.locator('input[name="password"]').fill(password);
      await tab.getByRole("button", { name: "Sign in" }).click();
      if (new URL(tab.url()).origin === "http://localhost:18888") {
        await tab.getByText("This form expired", { exact: false }).waitFor();
        assert.equal(
          await tab.locator('input[name="password"]').inputValue(),
          "",
        );
        await tab.locator('input[name="username"]').fill("local-artbin");
        await tab.locator('input[name="password"]').fill(password);
        await tab.getByRole("button", { name: "Sign in" }).click();
      }
      await tab.waitForURL("http://localhost:18892/folders");
    }
  } finally {
    await overlap.close();
  }
  console.log(
    "PASS native issuer → Jack Auth UI → Artbin callback/session/reload; overlapping starts recover both sessions",
  );
} finally {
  await browser.close();
}
