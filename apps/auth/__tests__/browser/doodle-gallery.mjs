import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";
const directory = await mkdtemp(tmpdir() + "/auth-gallery-");
const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["tools/doodle-gallery/server.mjs"], {
  env: {
    ...process.env,
    GALLERY_HOST: "127.0.0.1",
    GALLERY_PORT: String(port),
    GALLERY_POOL_FILE: directory + "/pool.json",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let browser;
try {
  await once(server.stdout, "data");
  browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
  const context = await browser.newContext({
      viewport: { width: 1000, height: 900 },
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.name));
  await page.goto(origin);
  await page
    .getByRole("button", { name: "Preview Silk braid", exact: true })
    .waitFor();
  assert.equal(await page.locator(".concept").count(), 10);
  assert.equal(await page.locator(".mock-form input").count(), 0);
  for (const name of [
    "Silk folds",
    "Silk",
    "Silk sheen",
    "Silk veil",
    "Caustics",
    "Caustic glass",
    "Caustic ripples",
    "Silk braid",
    "Caustic tide",
    "Deep water",
  ]) {
    await page
      .getByRole("button", { name: "Preview " + name, exact: true })
      .click();
    assert((await page.locator("#renderer").innerText()).includes("WebGL"));
  }
  await page.getByRole("button", { name: "Preview Silk", exact: true }).click();
  await page.getByLabel("Motion", { exact: true }).uncheck();
  const neutralFrame = await page.locator(".motion-canvas").screenshot();
  await page.getByLabel("Color strength", { exact: true }).fill("1.65");
  assert.notDeepEqual(
    neutralFrame,
    await page.locator(".motion-canvas").screenshot(),
  );
  await page.getByLabel("Saturation", { exact: true }).fill("1.8");
  await page
    .getByRole("button", { name: "Preview Silk braid", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Color strength", { exact: true }).inputValue(),
    "0.8",
  );
  await page.getByRole("button", { name: "Preview Silk", exact: true }).click();
  assert.equal(
    await page.getByLabel("Color strength", { exact: true }).inputValue(),
    "1.65",
  );
  await page.getByLabel("Silk", { exact: true }).check();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByText("Saved", { exact: true }).waitFor();
  assert.deepEqual(
    JSON.parse(await readFile(directory + "/pool.json", "utf8")).enabled,
    ["silk", "silk-braid"],
  );
  assert.equal(
    JSON.parse(await readFile(directory + "/pool.json", "utf8")).settings.silk
      .color,
    1.65,
  );
  await page.reload();
  await page.getByRole("button", { name: "Preview Silk", exact: true }).click();
  assert.equal(
    await page.getByLabel("Saturation", { exact: true }).inputValue(),
    "1.8",
  );
  const forged = await context.request.patch(origin + "/api/pool", {
    headers: { origin: "http://wrong.invalid" },
    data: { enabled: ["silk-braid"], expectedRevision: 1 },
  });
  assert.equal(forged.status(), 403);
  const invalidSettings = await context.request.patch(origin + "/api/pool", {
    headers: { origin },
    data: {
      enabled: ["silk-braid"],
      expectedRevision: 1,
      settings: { silk: { color: 99 } },
    },
  });
  assert.equal(invalidSettings.status(), 400);
  const invalid = await context.request.patch(origin + "/api/pool", {
    headers: { origin },
    data: { enabled: [], expectedRevision: 1 },
  });
  assert.equal(invalid.status(), 400);
  await page.getByLabel("Motion", { exact: true }).uncheck();
  await page.locator(".stage").scrollIntoViewIfNeeded();
  const still = await page.locator(".motion-canvas").screenshot();
  await page.waitForTimeout(250);
  assert.deepEqual(still, await page.locator(".motion-canvas").screenshot());
  await page
    .locator(".motion-canvas")
    .evaluate((canvas) =>
      canvas
        .getContext("webgl2")
        .getExtension("WEBGL_lose_context")
        .loseContext(),
    );
  await page.waitForFunction(() => !document.querySelector(".motion-canvas"));
  assert.equal(await page.locator("#art svg").getAttribute("hidden"), null);
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS real WebGL gallery: ten shaders, private pool persistence/Origin, paused frame, context-loss fallback and mobile.",
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await once(server, "exit");
  await rm(directory, { recursive: true, force: true });
}
