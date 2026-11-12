import { setTimeout as delay } from "node:timers/promises";
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
  root + "/forum-write-" + new Date().toISOString().replace(/[:.]/g, "");
await mkdir(output, { mode: 0o700 });
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

      const forum = async () =>
        (
          await context.request.get(origin + "/forum", {
            headers: { Accept: "application/json" },
          })
        ).json();
      const before = await forum();
      let threadId;
      try {
        phase = `${name}-${width}-create`;
        await page.goto(origin + "/forum/new");
        await page
          .locator('[name="title"]')
          .fill("Isolated parity write workflow");
        await page
          .locator("#thread-content")
          .fill("[b]Original temporary post[/b]");
        await page
          .locator("details")
          .filter({ has: page.getByText("thread styling", { exact: true }) })
          .locator("summary")
          .click();
        await page
          .locator('[name="custom_css"]')
          .fill(".forum-post { --isolated-parity: 1; }");
        await page
          .locator('[name="custom_html"]')
          .fill('<aside data-parity-intro="yes">Temporary intro</aside>');
        await page
          .getByRole("button", { name: "create thread", exact: true })
          .click();
        await page.waitForURL(
          (u) => u.origin === origin && /^\/forum\/\d+$/.test(u.pathname),
        );
        threadId = Number(new URL(page.url()).pathname.split("/").at(-1));
        assert.ok(threadId);
        const detail = async () =>
          (
            await context.request.get(origin + "/forum/" + threadId, {
              headers: { Accept: "application/json" },
            })
          ).json();
        assert.equal(
          await page
            .locator('[data-parity-intro="yes"]')
            .evaluate((element) => element.parentElement.tagName),
          "MAIN",
        );
        const created = await detail();
        assert.equal(created.posts.length, 1);
        assert.equal(created.watching, true);
        assert.equal(
          created.custom_html,
          '<aside data-parity-intro="yes">Temporary intro</aside>',
        );
        const originalId = created.posts[0].id;
        await page
          .locator(".forum-post")
          .first()
          .getByRole("button", { name: "quote", exact: true })
          .click();
        await page.locator("#reply-content").fill("Temporary quoted reply");
        await delay(10500);
        phase = `${name}-${width}-reply`;
        await page
          .getByRole("button", { name: "post reply", exact: true })
          .click();
        await page.waitForURL(
          (u) =>
            u.pathname === "/forum/" + threadId &&
            u.searchParams.get("page") === "1",
        );
        const replied = await detail();
        assert.equal(replied.posts.length, 2);
        const quote = replied.posts[1];
        assert.equal(quote.quoted_content, "[b]Original temporary post[/b]");
        assert.equal(quote.quoted_content_format, "bbcode");
        phase = `${name}-${width}-edit`;
        await page
          .locator(`#post-${originalId}`)
          .getByRole("button", { name: "edit", exact: true })
          .click();
        await page
          .locator("#edit-post-content")
          .fill("Edited temporary original");
        await page.getByRole("button", { name: "save", exact: true }).click();
        await page.waitForURL((u) => u.pathname === "/forum/" + threadId);
        await page.reload();
        const edited = await detail();
        assert.equal(edited.posts[0].content, "Edited temporary original");
        assert.equal(edited.posts[0].is_edited, true);
        assert.equal(
          edited.posts[1].quoted_content,
          "[b]Original temporary post[/b]",
        );
        await page.screenshot({
          path: output + `/${name}-${width}.png`,
          fullPage: true,
        });
        page.on("dialog", (d) => d.accept());
        await page
          .locator(`#post-${quote.id}`)
          .getByRole("button", { name: "delete", exact: true })
          .click();
        await page.locator(`#post-${quote.id}`).waitFor({ state: "detached" });
        assert.equal((await detail()).posts.length, 1);
        await page
          .getByRole("button", { name: "delete thread", exact: true })
          .click();
        await page.waitForURL(origin + "/forum");
        assert.equal(
          (await context.request.get(origin + "/forum/" + threadId)).status(),
          404,
        );
        assert.deepEqual((await forum()).threads, before.threads);
        assert.equal(errors.length, 0);
        results.push({
          name,
          width,
          create: true,
          stylingStored: true,
          quotedReply: true,
          editReopen: true,
          quoteSnapshotPreserved: true,
          deletePost: true,
          deleteThread: true,
          baselineThreadsPreserved: true,
          browserErrors: 0,
        });
      } finally {
        if (threadId) {
          const response = await context.request.get(
            origin + "/forum/" + threadId,
            { headers: { Accept: "application/json" } },
          );
          if (response.status() === 200) {
            const record = await response.json();
            assert.equal(record.title, "Isolated parity write workflow");
            assert.equal(
              (
                await context.request.post(
                  origin + "/forum/" + threadId + "/delete",
                  { headers: { Origin: origin, Accept: "application/json" } },
                )
              ).status(),
              200,
            );
          }
        }
        await context.close();
      }
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
    JSON.stringify({ status: "FAIL", phase, message: error.message }, null, 2),
  );
  console.error(
    "Forum write verification failed; protected evidence: " + output,
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
