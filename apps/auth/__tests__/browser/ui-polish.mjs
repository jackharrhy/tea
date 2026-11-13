import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";
const server = spawn(process.execPath, ["__tests__/fixtures/ui-preview.mjs"], {
  env: { ...process.env, PORT: "0" },
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
    await page.goto(`${origin}/login`);
    const box = await page.locator("main").boundingBox();
    assert.ok(
      Math.abs(box.y + box.height / 2 - viewport.height / 2) < 2,
      "login centered",
    );
    await page.waitForTimeout(850);
    const opacity = await page
      .locator("canvas.auth-art")
      .evaluate((el) => Number(getComputedStyle(el).opacity));
    assert.ok(opacity > 0 && opacity < 0.55, "WebGL progressively fades in");
    assert.equal(
      await page.locator("svg.auth-art").getAttribute("hidden"),
      null,
    );
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `/tmp/auth-login-${viewport.width}.png` });
    await page
      .locator("canvas.auth-art")
      .evaluate((el) =>
        el
          .getContext("webgl2")
          .getExtension("WEBGL_lose_context")
          .loseContext(),
      );
    await page.waitForTimeout(100);
    assert.equal(await page.locator("canvas.auth-art").count(), 0);
    assert.ok(
      Number(
        await page
          .locator("svg.auth-art")
          .evaluate((el) => getComputedStyle(el).opacity),
      ) > 0,
    );
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(2300);
    assert.equal(await page.locator("canvas.auth-art").count(), 1);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(50);
    assert.equal(await page.locator("canvas.auth-art").count(), 0);
    assert.ok(
      Number(
        await page
          .locator("svg.auth-art")
          .evaluate((el) => getComputedStyle(el).opacity),
      ) > 0,
    );
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
  await page.goto(`${origin}/login`);
  await page.waitForTimeout(1000);
  assert.equal(await page.locator("canvas.auth-art").count(), 0);
  assert.ok(
    Number(
      await page
        .locator("svg.auth-art")
        .evaluate((el) => getComputedStyle(el).opacity),
    ) > 0,
  );
  assert.equal((await page.request.post(origin)).status(), 405);
  console.log(
    "UI polish: centered responsive login, gradual enhancement, reduced motion, no-WebGL fallback, header disclosure and read-only fixture passed",
  );
} finally {
  await browser.close();
  server.kill();
}
