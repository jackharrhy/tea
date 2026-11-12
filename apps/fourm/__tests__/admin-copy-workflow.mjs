import { exerciseAdminAccounts } from "./admin-accounts-workflow.mjs";
import { exerciseAdminEditors } from "./admin-editors-workflow.mjs";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
export async function exerciseAdminCopies({
  workflow,
  output,
  oracleRoot,
  authPath,
  restart,
}) {
  const auth = JSON.parse(await readFile(authPath, "utf8"));
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [name, origin] of [
      ["oracle", "http://127.0.0.1:18964"],
      ["native", "http://127.0.0.1:18974"],
    ]) {
      if (process.env.FOURM_COPY_ONLY === "native" && name !== "native")
        continue;
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        serviceWorkers: "block",
      });
      await context.route("**/*", (r) =>
        [origin, "http://127.0.0.1:18975"].includes(
          new URL(r.request().url()).origin,
        )
          ? r.continue()
          : r.abort(),
      );
      try {
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        assert.equal(
          (await context.request.get(origin + "/admin")).status(),
          403,
        );
        assert.equal(
          (
            await context.request.post(origin + "/admin/site-banner", {
              headers: { Origin: origin },
              form: { banner_html: "denied" },
            })
          ).status(),
          403,
        );
        if (name === "oracle") {
          const cookie = spawnSync(
            "/home/jack/repos/personal/4orm/.venv/bin/python",
            [
              fileURLToPath(new URL("./oracle-session.py", import.meta.url)),
              oracleRoot,
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
        } else {
          await page.goto(origin + "/login");
          await page
            .getByRole("button", {
              name: "Continue as local user",
              exact: true,
            })
            .click();
          await page.waitForURL(
            (u) => u.origin === origin && u.pathname.startsWith("/u/"),
          );
        }

        if (workflow === "accounts") {
          await exerciseAdminAccounts({
            page,
            context,
            origin,
            name,
            output,
            oracleRoot,
            authPath,
            restart,
          });
          assert.equal(errors.length, 0);
          results.push({ name, accountControls: true, browserErrors: 0 });
          continue;
        }
        await page.goto(origin + "/admin");
        const initial = {
          enabled: await page.locator('[name="banner_enabled"]').isChecked(),
          html: await page.locator("#site-banner-html").inputValue(),
          css: await page.locator("#site-banner-css").inputValue(),
        };
        await page.locator('[name="banner_enabled"]').check();
        await page
          .locator("#site-banner-html")
          .fill('<span id="isolated-banner">Isolated admin banner</span>');
        await page
          .locator("#site-banner-css")
          .fill(".site-banner { color: rgb(11,22,33); }");
        const preview = page
          .frameLocator("#site-banner-preview")
          .locator(".site-banner");
        await preview
          .getByText("Isolated admin banner", { exact: true })
          .waitFor();
        assert.equal(
          await preview.evaluate((e) => getComputedStyle(e).color),
          "rgb(11, 22, 33)",
        );
        assert.equal(
          await page.locator("#site-banner-preview").getAttribute("sandbox"),
          "",
        );
        for (const width of [1280, 390]) {
          await page.setViewportSize({ width, height: 900 });
          await page
            .locator("details.panel")
            .filter({
              has: page.locator('form[action="/admin/site-banner"]'),
            })
            .first()
            .screenshot({ path: output + `/${name}-banner-${width}.png` });
        }
        await page
          .getByRole("button", { name: "save site banner", exact: true })
          .click();
        await page.reload();
        assert.equal(
          await page.locator("#site-banner-html").inputValue(),
          '<span id="isolated-banner">Isolated admin banner</span>',
        );
        await restart(name);
        await page.goto(origin + "/admin");
        assert.equal(
          await page.locator('[name="banner_enabled"]').isChecked(),
          true,
        );
        for (const path of ["/", "/forum", "/settings"]) {
          await page.goto(origin + path);
          await page.locator("aside.site-banner #isolated-banner").waitFor();
        }
        for (const path of ["/admin", "/chat", "/how-to"]) {
          await page.goto(origin + path);
          assert.equal(await page.locator("aside.site-banner").count(), 0);
        }
        await page.goto(origin + "/admin");
        await page
          .locator('[name="banner_enabled"]')
          .setChecked(initial.enabled);
        await page.locator("#site-banner-html").fill(initial.html);
        await page.locator("#site-banner-css").fill(initial.css);
        await page
          .getByRole("button", { name: "save site banner", exact: true })
          .click();
        await page.reload();
        assert.equal(
          await page.locator("#site-banner-html").inputValue(),
          initial.html,
        );
        assert.equal(
          await page.locator("#site-banner-css").inputValue(),
          initial.css,
        );
        assert.equal(
          await page.locator('[name="banner_enabled"]').isChecked(),
          initial.enabled,
        );
        await exerciseAdminEditors({
          page,
          context,
          origin,
          userId: auth.userId,
          name,
          output,
          restart,
        });
        assert.equal(errors.length, 0);
        results.push({
          name,
          anonymousDenied: true,
          preview: true,
          sandbox: true,
          saved: true,
          coldRestart: true,
          routeScope: true,
          restored: true,
          browserErrors: 0,
        });
      } finally {
        await context.close();
      }
    }
    await writeFile(
      output + "/browser.json",
      JSON.stringify(
        { status: "PASS", results, productionTouched: false },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}
