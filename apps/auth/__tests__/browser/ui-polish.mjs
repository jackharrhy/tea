import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";
const server = spawn(process.execPath, ["__tests__/fixtures/ui-preview.mjs"], {
  env: {
    ...process.env,
    PORT: "0",
    DOODLE_POOL_FILE: "",
    RADIO_ENROLLMENT_DB_FILE: "",
  },
  stdio: ["ignore", "pipe", "inherit"],
});
const [output] = await once(server.stdout, "data");
const origin = output.toString().match(/http:\/\/127\.0\.0\.1:\d+/)[0];
const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader"],
});
try {
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport });
    page.on("pageerror", (error) => console.log(error.message));
    await page.goto(`${origin}/login`);
    const box = await page.locator("main").boundingBox();
    assert.ok(
      Math.abs(box.y + box.height / 2 - viewport.height / 2) < 2,
      "login centered",
    );
    assert.equal(await page.locator("canvas").count(), 0);
    assert.equal(await page.locator("svg.auth-art").count(), 0);
    assert.equal(
      await page.locator('script[src="/assets/doodle-motion.mjs"]').count(),
      0,
    );
    await page.locator("#background-explorer summary").click();
    await page.evaluate(() => {
      window.fixtureMarker = "same-document";
    });
    await page.getByLabel("Background", { exact: true }).selectOption("webgl");
    await page.getByLabel("Existing effect").selectOption("caustic-glass");
    await page.getByLabel("Color", { exact: true }).selectOption("cyan");
    assert.equal(
      await page.getByRole("button", { name: "Apply & keep this URL" }).count(),
      0,
    );
    await page.waitForFunction(() =>
      document
        .querySelector("#explorer-status")
        .textContent.includes("held at time zero"),
    );
    await page.locator("#background-explorer summary").click();
    assert.ok(page.url().includes("effect=caustic-glass"));
    assert.equal(
      await page.evaluate(() => window.fixtureMarker),
      "same-document",
    );
    assert.equal(await page.locator("svg.auth-art").count(), 0);
    const canvas = page.locator("canvas.auth-art");
    const first = await canvas.screenshot({
      timeout: 5000,
      style: "#main, #background-explorer { visibility: hidden !important; }",
    });
    await page.waitForTimeout(150);
    assert.deepEqual(
      await canvas.screenshot({
        timeout: 5000,
        style: "#main, #background-explorer { visibility: hidden !important; }",
      }),
      first,
      "stable selected option",
    );
    await page.reload({ waitUntil: "domcontentloaded", timeout: 5000 });
    await canvas.waitFor({ timeout: 5000 });
    assert.deepEqual(
      await canvas.screenshot({
        timeout: 5000,
        style: "#main, #background-explorer { visibility: hidden !important; }",
      }),
      first,
      "reload preserves fixed seed/time",
    );
    await page.screenshot({ path: `/tmp/auth-explorer-${viewport.width}.png` });
    await canvas.evaluate((el) =>
      el.getContext("webgl2").getExtension("WEBGL_lose_context").loseContext(),
    );
    await page.waitForFunction(() =>
      document
        .querySelector("#explorer-status")
        .textContent.includes("WebGL unavailable"),
    );
    assert.equal(await page.locator("svg.auth-art").count(), 0);
    await page.goto(`${origin}/login?layer=webgl&effect=silk&motion=animate`);
    await canvas.waitFor({ timeout: 5000 });
    assert.equal(await page.locator("svg.auth-art").count(), 0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(() =>
      document
        .querySelector("#explorer-status")
        .textContent.includes("reduced motion"),
    );
    const still = await canvas.screenshot({
      timeout: 5000,
      style: "#main, #background-explorer { visibility: hidden !important; }",
    });
    await page.waitForTimeout(150);
    assert.deepEqual(
      await canvas.screenshot({
        timeout: 5000,
        style: "#main, #background-explorer { visibility: hidden !important; }",
      }),
      still,
    );
    await page.goto(`${origin}/login?layer=plain`);
    assert.equal(await page.locator("canvas").count(), 0);
    assert.equal(await page.locator("svg.auth-art").count(), 0);
    await page.goto(origin);
    assert.equal(await page.locator("h1").textContent(), "Your apps");
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    if (viewport.width < 760) {
      await page.locator("summary").click();
      await page
        .getByRole("navigation", { name: "Mobile", exact: true })
        .getByText("People")
        .waitFor({ state: "visible" });
    }
    await page.screenshot({ path: `/tmp/auth-header-${viewport.width}.png` });
    await page.close();
  }
  const page = await browser.newPage();
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
  });
  await page.goto(`${origin}/login?layer=webgl`);
  await page.waitForFunction(() =>
    document
      .querySelector("#explorer-status")
      .textContent.includes("WebGL unavailable"),
  );
  assert.equal(await page.locator("canvas").count(), 0);
  assert.equal(await page.locator("svg.auth-art").count(), 0);
  assert.equal((await page.request.post(`${origin}/login`)).status(), 405);
  assert.equal((await page.request.get(`${origin}/support`)).status(), 404);
  console.log(
    "UI explorer: responsive centering/header, immediate plain/WebGL controls, deterministic hold/reload, reduced motion and WebGL fallback passed",
  );
} finally {
  await browser.close();
  server.kill();
}
