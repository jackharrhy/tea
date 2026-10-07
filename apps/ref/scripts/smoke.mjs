import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const base = process.env.REF_SMOKE_URL ?? "http://localhost:8788";
const password = process.env.REF_SMOKE_PASSWORD;
if (!["localhost", "127.0.0.1", "::1"].includes(new URL(base).hostname)) {
  throw new Error("Smoke test only accepts a local URL");
}
if (!password) throw new Error("Set REF_SMOKE_PASSWORD for the local instance");

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.locator("#password").fill("wrong-password");
  await page.getByRole("button", { name: "Enter" }).click();
  await page.getByText("Incorrect password").waitFor();
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Enter" }).click();
  await page.getByRole("heading", { name: "Boards" }).waitFor();
  await page.locator("input[name=title]").fill("Smoke board");
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/\/boards\/[0-9a-f-]+/);
  const boardId = page.url().split("/").at(-1);
  await page.locator("#connection.online").waitFor();

  const second = await context.newPage();
  second.on("pageerror", (error) => errors.push(error.message));
  await second.goto(`${base}/boards/${boardId}`);
  await second.locator("#connection.online").waitFor();

  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.locator("#file-input").setInputFiles({
    name: "sample.png",
    mimeType: "image/png",
    buffer: image,
  });
  await page.locator(".board-item").waitFor();
  await second.locator(".board-item").waitFor();
  const itemId = await page.locator(".board-item").getAttribute("data-item-id");
  assert.equal(
    await second.locator(".board-item").getAttribute("data-item-id"),
    itemId,
  );
  await page.locator(".board-item img[src]").waitFor();
  const mediaPath = await page
    .locator(".board-item img")
    .getAttribute("data-original");
  assert.ok(mediaPath);
  const mediaUrl = `${base}${mediaPath}`;
  const mediaResponse = await context.request.get(mediaUrl);
  assert.equal(mediaResponse.status(), 200);
  assert.equal(mediaResponse.headers()["cache-control"], "private, no-cache");
  const mediaEtag = mediaResponse.headers().etag;
  assert.ok(mediaEtag);
  assert.equal(
    (
      await context.request.get(mediaUrl, {
        headers: { "If-None-Match": mediaEtag },
      })
    ).status(),
    304,
  );
  const anonymous = await browser.newContext();
  assert.equal(
    (
      await anonymous.request.get(`${base}/api/boards/${boardId}/snapshot`)
    ).status(),
    404,
  );
  assert.equal((await anonymous.request.get(mediaUrl)).status(), 404);

  const viewBeforePan = await page
    .locator("#world")
    .evaluate((element) => element.style.transform);
  const zoomBeforePan = await page.locator("#zoom-label").textContent();
  await page.mouse.move(800, 700);
  await page.mouse.wheel(90, 60);
  await page.waitForFunction(
    (before) => document.querySelector("#world")?.style.transform !== before,
    viewBeforePan,
  );
  assert.equal(await page.locator("#zoom-label").textContent(), zoomBeforePan);
  await page.locator("#viewport").evaluate((element) => {
    element.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -25,
        clientX: 800,
        clientY: 500,
      }),
    );
  });
  await page.waitForFunction(
    (before) => document.querySelector("#zoom-label")?.textContent !== before,
    zoomBeforePan,
  );

  const before = await second
    .locator(".board-item")
    .evaluate((element) => element.style.left);
  const bounds = await page.locator(".board-item").boundingBox();
  assert.ok(bounds);
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 + 80,
    bounds.y + bounds.height / 2 + 30,
    {
      steps: 5,
    },
  );
  await page.mouse.up();
  await second.waitForFunction(
    (old) => document.querySelector(".board-item")?.style.left !== old,
    before,
  );
  await second.reload();
  await second.locator("#connection.online").waitFor();
  assert.notEqual(
    await second
      .locator(".board-item")
      .evaluate((element) => element.style.left),
    before,
  );

  await page.locator("#link-menu summary").click();
  await page.locator("#link-url").fill("https://example.com/");
  await page.locator("#link-form button").click();
  await page.locator(".link-item").waitFor({ timeout: 20_000 });
  await second.locator(".link-item").waitFor();
  assert.match(await page.locator(".link-card").innerText(), /Example Domain/);
  assert.equal(
    await page.evaluate(
      (id) =>
        fetch(`/api/boards/${id}/links`, {
          method: "POST",
          body: new URLSearchParams({ url: "http://127.0.0.1/" }),
        }).then((response) => response.status),
      boardId,
    ),
    400,
  );
  await page.locator("#link-menu summary").click();
  await page.locator("#link-url").fill("https://example.com/");
  await page.locator("#link-form button").click();
  assert.equal(await page.locator(".link-item").count(), 1);
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "https://example.org/");
    document.querySelector("#viewport")?.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
        clientX: 450,
        clientY: 350,
      }),
    );
  });
  await page.locator(".link-item").nth(1).waitFor({ timeout: 20_000 });
  await second.locator(".link-item").nth(1).waitFor();
  await page.reload();
  await page.locator(".link-item").nth(1).waitFor();

  await page.locator(".board-title-menu summary").click();
  await page
    .locator('form[action$="/rename"] input[name=title]')
    .fill("Renamed board");
  await page.getByRole("button", { name: "Rename" }).click();
  assert.equal(
    (await page.locator(".board-title-menu summary").textContent())?.trim(),
    "Renamed board",
  );
  await page.locator(`[data-item-id="${itemId}"]`).click();
  await page.getByRole("button", { name: "Remove image" }).click();
  await page
    .locator(`[data-item-id="${itemId}"]`)
    .waitFor({ state: "detached" });
  await second
    .locator(`[data-item-id="${itemId}"]`)
    .waitFor({ state: "detached" });
  assert.equal((await context.request.get(mediaUrl)).status(), 404);
  await page.evaluate(async () => fetch("/logout", { method: "POST" }));
  await page.locator("#connection.offline").waitFor({ timeout: 5_000 });
  assert.equal(
    (
      await context.request.get(`${base}/api/boards/${boardId}/snapshot`)
    ).status(),
    404,
  );
  assert.equal(
    await page.evaluate(
      (url) => fetch(url).then((response) => response.status),
      mediaUrl,
    ),
    404,
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      boardId,
      itemId,
      liveSync: true,
      persistence: true,
      privateMedia: true,
      linkPreview: true,
      mediaCleanup: true,
      logout: true,
    }),
  );
} finally {
  await browser.close();
}
