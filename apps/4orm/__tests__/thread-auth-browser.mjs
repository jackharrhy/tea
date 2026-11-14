import { resolve } from "node:path";
import { reviewSourceFingerprint } from "../scripts/review-source.mjs";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
process.umask(0o077);
const root = "/home/jack/.local/state/form-harrhy-integration/candidate";
const auth = JSON.parse(
  await readFile(root + "/parity-cohort-20261112/review-auth.json", "utf8"),
);
const output =
  root + "/thread-auth-" + new Date().toISOString().replace(/[:.]/g, "");
await mkdir(output, { mode: 0o700 });
const runtime = JSON.parse(
  await readFile("apps/4orm/.review/parity-local/runtime.json", "utf8"),
);
assert.equal(
  runtime.sourceFingerprint,
  await reviewSourceFingerprint(resolve("apps/4orm")),
  "Refresh the owned candidate before browser verification",
);
const browser = await chromium.launch();
const results = [];
let phase = "start";
try {
  for (const width of [1280, 390])
    for (const [name, origin] of [
      ["oracle", "http://127.0.0.1:18964"],
      ["native", "http://127.0.0.1:18974"],
    ]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        serviceWorkers: "block",
      });
      await context.route("**/*", (r) =>
        [origin, "http://127.0.0.1:18975"].includes(
          new URL(r.request().url()).origin,
        )
          ? r.continue()
          : r.abort(),
      );
      if (name === "oracle") {
        const cookie = spawnSync(
          "/home/jack/repos/personal/4orm/.venv/bin/python",
          [
            fileURLToPath(new URL("./oracle-session.py", import.meta.url)),
            root + "/python-oracle",
            String(auth.userId),
          ],
          { encoding: "utf8" },
        );
        assert.equal(cookie.status, 0);
        await context.addCookies([
          {
            name: "session",
            value: cookie.stdout,
            domain: "127.0.0.1",
            path: "/",
            httpOnly: true,
            sameSite: "Lax",
          },
        ]);
      }
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      if (name === "native") {
        await page.goto(origin + "/login");
        await page
          .getByRole("button", { name: "Continue as local user", exact: true })
          .click();
        await page.waitForURL(
          (u) => u.origin === origin && u.pathname.startsWith("/u/"),
        );
      }
      const index = await (
        await context.request.get(origin + "/forum", {
          headers: { Accept: "application/json" },
        })
      ).json();
      let thread;
      for (const candidate of index.threads.filter((t) => !t.is_locked)) {
        const detail = await (
          await context.request.get(origin + "/forum/" + candidate.id, {
            headers: { Accept: "application/json" },
          })
        ).json();
        if (!detail.watching) {
          thread = candidate;
          break;
        }
      }
      assert.ok(
        thread,
        "Choose an unwatched thread so watch cleanup preserves existing receipts",
      );
      const path = "/forum/" + thread.id;
      const snapshot = async () => {
        const r = await context.request.get(origin + path, {
          headers: { Accept: "application/json" },
        });
        assert.equal(r.status(), 200);
        return r.json();
      };
      const before = await snapshot();
      try {
        phase = `${name}-${width}-quote`;
        await page.goto(origin + path);
        await page.waitForFunction(
          () => typeof window.quotePost === "function",
        );
        const quote = page
          .locator(".forum-post")
          .first()
          .getByRole("button", { name: "quote", exact: true });
        await quote.click();
        await writeFile(
          output + `/${name}-${width}-quote-diagnostic.json`,
          JSON.stringify(
            {
              inlineHandler: await quote.getAttribute("onclick"),
              errors,
              replyOpen: await page
                .locator("#reply-details")
                .getAttribute("open"),
            },
            null,
            2,
          ),
        );
        assert.equal(
          await page.locator("#reply-details").getAttribute("open"),
          "",
        );
        assert.equal(
          await page.locator("#quoted_post_id").inputValue(),
          String(before.posts[0].id),
        );
        assert.equal(
          await page.locator("#quoted_content").inputValue(),
          before.posts[0].content,
        );
        await page
          .locator("#quote-preview")
          .getByRole("button", { name: "remove", exact: true })
          .click();
        assert.equal(await page.locator("#quoted_post_id").inputValue(), "");
        await page
          .locator("#reply-content")
          .fill("[b]Isolated preview only[/b]");
        await page
          .getByRole("button", { name: "preview", exact: true })
          .click();
        await page
          .locator('#preview-reply-content[data-state="success"]')
          .waitFor();
        assert.equal(
          await page.locator("#preview-reply-content strong").textContent(),
          "Isolated preview only",
        );
        await page.locator(`form[action="${path}/watch"] button`).click();
        await page.waitForFunction(() => document.readyState === "complete");
        await page
          .locator(`form[action="${path}/watch"]`)
          .getByRole("button", {
            name: before.watching ? "👁 watch" : "👁 unwatch",
            exact: true,
          })
          .waitFor();
        assert.equal((await snapshot()).watching, !before.watching);
        const restore = await context.request.post(origin + path + "/watch", {
          headers: { Origin: origin, Accept: "application/json" },
        });
        assert.equal(restore.status(), 200);
        assert.equal((await snapshot()).watching, before.watching);
        await page.reload();
        await page.screenshot({
          path: output + `/${name}-${width}.png`,
          fullPage: true,
        });
        assert.equal(errors.length, 0);
        results.push({
          name,
          width,
          quoteSelectClear: true,
          preview: true,
          watchRestore: true,
          postsUnchanged:
            JSON.stringify((await snapshot()).posts) ===
            JSON.stringify(before.posts),
          browserErrors: 0,
        });
      } finally {
        if ((await snapshot()).watching !== before.watching)
          await context.request.post(origin + path + "/watch", {
            headers: { Origin: origin, Accept: "application/json" },
          });
        await context.close();
      }
    }
  assert.ok(results.every((r) => r.postsUnchanged));
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
    JSON.stringify({ status: "FAIL", phase, message: error.message }, null, 2),
  );
  console.error(
    "Thread auth verification failed; protected evidence: " + output,
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
