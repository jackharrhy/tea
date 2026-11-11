import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { chromium } from "playwright";
import { createRequestListener } from "remix/node-fetch-server";
import { createGarden } from "../app/router.tsx";

const directory = await fs.mkdtemp(
  path.join(os.tmpdir(), "garden-navigation-"),
);
await fs.writeFile(
  path.join(directory, "Home.md"),
  "---\npublic: true\n---\n```component\nMug\n```\n\n```component\nNowPlaying\n```\n\n[About](/about)",
);
await fs.writeFile(
  path.join(directory, "About.md"),
  "---\npublic: true\n---\nFixture about\n\n[Thumbnail tool](/tools/youtube-thumbnail-fetcher)",
);
const { router } = createGarden({
  development: false,
  directory,
  assetsDirectory: directory,
  origin: "https://example.test",
  assetOrigin: "https://media.example.test",
  lastfmKey: undefined,
});
const server = http.createServer(
  createRequestListener((request) => router.fetch(request)),
);
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert.ok(address && typeof address === "object");
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ channel: "chrome" });
try {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    const context = await browser.newContext({ reducedMotion });
    await context.route("**/gc.zgo.at/**", (route) => route.abort());
    let widgetLoads = 0;
    await context.route("**/tools/lastfm/now-playing", (route) => {
      widgetLoads++;
      assert.equal(route.request().headers()["x-remix-frame"], "true");
      if (reducedMotion === "reduce") return route.fulfill({ status: 204 });
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<p>Fixture now playing</p>",
      });
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const modelRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("cuppa.txt"))
        modelRequests.push(request.url());
    });
    await page.goto(base, { waitUntil: "networkidle" });
    if (reducedMotion === "no-preference")
      await page.getByText("Fixture now playing", { exact: true }).waitFor();
    await page.waitForFunction(
      () => performance.getEntriesByName("garden:mug-first-frame").length > 0,
    );
    assert.ok(widgetLoads > 0);
    assert.deepEqual(modelRequests, []);
    assert.equal(
      await page
        .locator("[data-mug-slot]")
        .evaluate((element) => getComputedStyle(element).viewTransitionName),
      "mug",
    );
    const popup = context.waitForEvent("page");
    await page
      .getByRole("link", { name: "About", exact: true })
      .first()
      .click({ modifiers: ["ControlOrMeta"] });
    const tab = await popup;
    await tab.waitForLoadState();
    assert.equal(new URL(tab.url()).pathname, "/about");
    await tab.close();
    assert.equal(new URL(page.url()).pathname, "/");
    await page.evaluate(() => {
      Object.assign(window, {
        originalCanvas: document.querySelector("canvas"),
        originalDocument: document,
      });
    });
    await page
      .getByRole("link", { name: "About", exact: true })
      .first()
      .click();
    await page.waitForURL("**/about");
    await page.waitForFunction(
      () =>
        document.querySelector("canvas")?.width === 100 &&
        !document.activeViewTransition,
    );
    assert.equal(await page.title(), "About · Jack Harrhy");
    await page.goBack();
    await page.waitForURL(base + "/");
    await page.waitForFunction(
      () =>
        document.querySelector("canvas")?.width === 250 &&
        !document.activeViewTransition,
    );
    await page.goForward();
    await page.waitForURL("**/about");
    await page.waitForFunction(
      () =>
        document.querySelector("canvas")?.width === 100 &&
        !document.activeViewTransition,
    );
    assert.equal(
      await page.evaluate(() => {
        const state = window as unknown as {
          originalCanvas: HTMLCanvasElement;
          originalDocument: Document;
        };
        return (
          state.originalCanvas === document.querySelector("canvas") &&
          state.originalDocument === document
        );
      }),
      true,
    );
    await page.getByRole("link", { name: "Thumbnail tool" }).click();
    await page.waitForURL("**/tools/youtube-thumbnail-fetcher");
    await page.waitForFunction(() => !document.activeViewTransition);
    await page.locator("input[name=url]").fill("https://youtu.be/dQw4w9WgXcQ");
    await page.getByRole("button", { name: "Fetch", exact: true }).click();
    await page.locator("#result img").waitFor();
    assert.equal(
      new URL(page.url()).pathname,
      "/tools/youtube-thumbnail-fetcher",
    );
    await page.locator("input[name=url]").fill("invalid");
    await page.getByRole("button", { name: "Fetch", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Could not extract video ID" })
      .waitFor();
    await page.locator("input[name=url]").fill("https://youtu.be/dQw4w9WgXcQ");
    await page.getByRole("button", { name: "Fetch", exact: true }).click();
    await page.locator("#result img").waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  }
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(base);
  await page.getByRole("link", { name: "About", exact: true }).first().click();
  assert.equal(await page.title(), "About · Jack Harrhy");
  await page.getByRole("link", { name: "Thumbnail tool" }).click();
  await page.locator("input[name=url]").fill("https://youtu.be/dQw4w9WgXcQ");
  await page.getByRole("button", { name: "Fetch", exact: true }).click();
  await page.getByAltText("YouTube video thumbnail").waitFor();
  await context.close();
  console.log(
    "Navigation, persistent canvas, history, reduced motion, forms, and no-JS fallback passed",
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(directory, { recursive: true });
}
