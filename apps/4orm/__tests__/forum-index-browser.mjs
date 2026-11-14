import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { reviewSourceFingerprint } from "../scripts/review-source.mjs";
process.umask(0o077);
const root = "/home/jack/.local/state/form-harrhy-integration/candidate";
const output =
  root + "/forum-index-" + new Date().toISOString().replace(/[:.]/g, "");
await mkdir(output, { mode: 0o700 });
const runtime = JSON.parse(
  await readFile("apps/4orm/.review/parity-local/runtime.json", "utf8"),
);
assert.equal(
  runtime.sourceFingerprint,
  await reviewSourceFingerprint(resolve("apps/4orm")),
);
const oracle = "http://127.0.0.1:18964",
  native = "http://127.0.0.1:18974";
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [1280, 390]) {
    const capture = {};
    for (const [name, origin] of [
      ["oracle", oracle],
      ["native", native],
    ]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        serviceWorkers: "block",
      });
      await context.route("**/*", (route) =>
        new URL(route.request().url()).origin === origin
          ? route.continue()
          : route.abort(),
      );
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const pages = [];
      for (const number of [1, 0, 2]) {
        const response = await context.request.get(
          origin + "/forum?page=" + number,
          { headers: { Accept: "application/json" } },
        );
        assert.equal(response.status(), 200);
        pages.push(await response.json());
      }
      for (const number of ["nope", "1.2"]) {
        const response = await context.request.get(
          origin + "/forum?page=" + number,
          { headers: { Accept: "application/json" } },
        );
        assert.equal(response.status(), 422);
      }
      assert.equal((await page.goto(origin + "/forum")).status(), 200);
      await page.locator(".forum-table").waitFor();
      await page.screenshot({
        path: output + `/${name}-${width}.png`,
        fullPage: true,
      });
      const dom = await page.evaluate(() => ({
        heading: document.querySelector("main h1").textContent,
        headers: [...document.querySelectorAll(".forum-table th")].map(
          (e) => e.textContent,
        ),
        rows: [...document.querySelectorAll(".forum-table tbody tr")].map(
          (row) => ({
            text: [...row.querySelectorAll("td")].map((e) =>
              e.textContent.replace(/\s+/g, " ").trim(),
            ),
            links: [...row.querySelectorAll("a")].map((a) =>
              a.getAttribute("href"),
            ),
          }),
        ),
        pagination: [...document.querySelectorAll(".pagination a")].map((a) =>
          a.getAttribute("href"),
        ),
      }));
      assert.equal(
        await page
          .getByRole("button", { name: "new thread", exact: true })
          .count(),
        0,
      );
      assert.equal(errors.length, 0);
      capture[name] = { pages, dom };
      await context.close();
    }
    await writeFile(
      output + `/comparison-${width}.json`,
      JSON.stringify(capture, null, 2),
    );
    assert.deepEqual(
      capture.native.pages,
      capture.oracle.pages,
      "Forum JSON differs; inspect protected comparison",
    );
    assert.deepEqual(
      capture.native.dom,
      capture.oracle.dom,
      "Forum DOM differs; inspect protected comparison",
    );
    results.push({
      width,
      json: true,
      composition: true,
      anonymousControls: true,
      browserErrors: 0,
    });
  }
  await writeFile(
    output + "/receipt.json",
    JSON.stringify(
      { status: "PASS", results, productionTouched: false },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ status: "PASS", output, results }));
} catch (error) {
  await writeFile(
    output + "/failure.json",
    JSON.stringify({ status: "FAIL", message: error.message }, null, 2),
  );
  console.error("Forum comparison failed; protected evidence: " + output);
  process.exitCode = 1;
} finally {
  await browser.close();
}
