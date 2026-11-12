import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { reviewSourceFingerprint } from "../scripts/review-source.mjs";
process.umask(0o077);
const root = "/home/jack/.local/state/form-harrhy-integration/candidate";
const output =
  root + "/thread-browser-" + new Date().toISOString().replace(/[:.]/g, "");
await mkdir(output, { mode: 0o700 });
const runtime = JSON.parse(
  await readFile("apps/fourm/.review/parity-local/runtime.json", "utf8"),
);
assert.equal(
  runtime.sourceFingerprint,
  await reviewSourceFingerprint(resolve("apps/fourm")),
);
const oracle = "http://127.0.0.1:18964",
  native = "http://127.0.0.1:18974";
const index = await (
  await fetch(oracle + "/forum", { headers: { Accept: "application/json" } })
).json();
assert.ok(index.threads.length);
const id = index.threads[0].id;
const browser = await chromium.launch();
try {
  const results = [];
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
      await context.route("**/*", (r) =>
        new URL(r.request().url()).origin === origin ? r.continue() : r.abort(),
      );
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      assert.equal((await page.goto(origin + "/forum/" + id)).status(), 200);
      await page.screenshot({
        path: output + `/${name}-${width}.png`,
        fullPage: true,
      });
      const dom = await page.evaluate(() => ({
        heading: document.querySelector("main h1").textContent,
        posts: [...document.querySelectorAll(".forum-post")].map((p) => ({
          id: p.id,
          text: p.textContent.replace(/\s+/g, " ").trim(),
          content: p.querySelector(".forum-post-content").innerHTML,
          quote:
            p
              .querySelector(".forum-quote")
              ?.textContent.replace(/\s+/g, " ")
              .trim() ?? null,
        })),
        login: document.querySelector('main a[href="/login"]')?.textContent,
      }));
      const json = await (
        await context.request.get(origin + "/forum/" + id, {
          headers: { Accept: "application/json" },
        })
      ).json();
      capture[name] = { dom, json, errors };
      await context.close();
    }
    await writeFile(
      output + `/comparison-${width}.json`,
      JSON.stringify(capture, null, 2),
    );
    assert.deepEqual(
      capture.native,
      capture.oracle,
      "Thread differs; inspect protected comparison",
    );
    results.push({ width, anonymousThread: true, json: true });
  }
  await writeFile(
    output + "/receipt.json",
    JSON.stringify(
      { status: "PASS", results, productionTouched: false },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ status: "PASS", output }));
} catch (error) {
  await writeFile(
    output + "/failure.json",
    JSON.stringify({ status: "FAIL", message: error.message }, null, 2),
  );
  console.error("Thread comparison failed; protected evidence: " + output);
  process.exitCode = 1;
} finally {
  await browser.close();
}
