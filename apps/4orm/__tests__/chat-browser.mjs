import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { reviewSourceFingerprint } from "../scripts/review-source.mjs";
process.umask(0o077);
const root = "/home/jack/.local/state/form-harrhy-integration/candidate";
const output =
  root + "/chat-browser-" + new Date().toISOString().replace(/[:.]/g, "");
await mkdir(output, { mode: 0o700 });
const runtime = JSON.parse(
  await readFile("apps/4orm/.review/parity-local/runtime.json", "utf8"),
);
assert.equal(
  runtime.sourceFingerprint,
  await reviewSourceFingerprint(resolve("apps/4orm")),
);
const inventory = JSON.parse(
  await readFile(root + "/parity-cohort-20261112/inventory.json", "utf8"),
);
const browser = await chromium.launch();
const results = [];
let phase = "start";
try {
  for (const width of [1280, 390]) {
    const capture = {};
    for (const [name, origin] of [
      ["oracle", "http://127.0.0.1:18964"],
      ["native", "http://127.0.0.1:18974"],
    ]) {
      phase = `${name}-${width}`;
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
      assert.equal((await page.goto(origin + "/chat")).status(), 200);
      await page
        .locator("#chat-presence")
        .getByText("nobody here", { exact: true })
        .waitFor();
      await page.waitForFunction(
        () =>
          !document.querySelector(
            ".chat-room .htmx-added,.chat-room .htmx-settling,.chat-room .htmx-swapping",
          ),
      );
      assert.equal(await page.locator(".chat-input").count(), 0);
      assert.equal(
        await page.locator('.fourm-chat-empty a[href="/login"]').textContent(),
        "Sign in",
      );
      capture[name] = await page.evaluate(() => ({
        messages: [...document.querySelectorAll(".chat-msg")].map((m) => ({
          style: m.getAttribute("style"),
          username: m.querySelector(".chat-user").textContent,
          message: m.querySelector(".chat-text").textContent,
          href: m.querySelector("a").getAttribute("href"),
        })),
        presence: document.querySelector("#chat-presence").innerHTML,
        room: document.querySelector(".chat-room").getAttribute("sse-connect"),
      }));
      await page.screenshot({
        path: output + `/${name}-${width}.png`,
        fullPage: true,
      });
      assert.equal(errors.length, 0);
      assert.equal(
        capture[name].messages.length,
        Math.min(100, inventory.counts.chat_messages),
      );
      await context.close();
    }
    await writeFile(
      output + `/comparison-${width}.json`,
      JSON.stringify(capture, null, 2),
    );
    assert.deepEqual(
      capture.native,
      capture.oracle,
      "Chat history/presence differs; inspect protected comparison",
    );
    results.push({
      width,
      publicHistory: true,
      initialPresence: true,
      messages: capture.native.messages.length,
      browserErrors: 0,
    });
  }
  await writeFile(
    output + "/receipt.json",
    JSON.stringify(
      {
        status: "PASS",
        results,
        scope:
          "Read-only history and initial anonymous HTML SSE presence; not send/flood/restart acceptance",
        productionTouched: false,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ status: "PASS", output }));
} catch (error) {
  await writeFile(
    output + "/failure.json",
    JSON.stringify({ status: "FAIL", phase, message: error.message }, null, 2),
  );
  console.error("Chat browser failed; protected evidence: " + output);
  process.exitCode = 1;
} finally {
  await browser.close();
}
