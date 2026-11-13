import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { unzipSync } from "fflate";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
process.umask(0o077);
const root = "/home/jack/.local/state/form-harrhy-integration/candidate";
const source = resolve(process.argv[2] ?? "");
assert.ok(source.startsWith(root + "/site-export-"));
const download = JSON.parse(
  await readFile(join(source, "receipt.json"), "utf8"),
);
assert.equal(download.status, "PASS");
const output =
  root + "/site-export-reopen-" + new Date().toISOString().replace(/[:.]/g, "");
await mkdir(output, { mode: 0o700 });
const selected = new Map();
for (const row of download.results)
  if (!selected.has(row.layout)) selected.set(row.layout, row);
const pageOwner = download.results.toSorted((a, b) => b.html - a.html)[0];
if (
  ![...selected.values()].some((r) => r.memberIndex === pageOwner.memberIndex)
)
  selected.set("page-navigation", pageOwner);
const browser = await chromium.launch();
const checks = [];
try {
  for (const row of selected.values())
    for (const width of [1280, 390]) {
      const pair = [];
      for (const name of ["oracle", "native"]) {
        const files = unzipSync(
          await readFile(join(source, `${name}-${row.memberIndex}.zip`)),
        );
        const prefix = Object.keys(files)
          .find((p) => p.endsWith("/index.html"))
          .slice(0, -"index.html".length);
        const origin = "http://isolated-export.invalid";
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          serviceWorkers: "block",
        });
        await context.addInitScript(() => {
          Math.random = () => 0.25;
          const OriginalDate = Date;
          const epoch = OriginalDate.UTC(2026, 10, 12, 12, 0, 0);
          globalThis.Date = class extends OriginalDate {
            constructor(...args) {
              super(...(args.length ? args : [epoch]));
            }
            static now() {
              return epoch;
            }
          };
        });
        const blocked = [];
        const errors = [];
        try {
          await context.route("**/*", (route) => {
            const u = new URL(route.request().url());
            const path = decodeURIComponent(u.pathname.slice(1));
            if (u.origin !== origin) {
              blocked.push(u.origin);
              return route.abort();
            }
            if (!files[path])
              return route.fulfill({ status: 404, body: "not exported" });
            const type = path.endsWith(".html")
              ? "text/html; charset=utf-8"
              : path.endsWith(".css")
                ? "text/css"
                : /\.png$/i.test(path)
                  ? "image/png"
                  : /\.jpe?g$/i.test(path)
                    ? "image/jpeg"
                    : /\.gif$/i.test(path)
                      ? "image/gif"
                      : /\.svg$/i.test(path)
                        ? "image/svg+xml"
                        : "application/octet-stream";
            return route.fulfill({
              status: 200,
              contentType: type,
              body: Buffer.from(files[path]),
            });
          });
          const page = await context.newPage();
          page.on("pageerror", (e) => errors.push(e.message));
          assert.equal(
            (await page.goto(origin + "/" + prefix + "index.html")).status(),
            200,
          );
          await page.waitForTimeout(200);
          const state = await page.evaluate(() => ({
            title: document.title,
            text: document.body.textContent.replace(/\s+/g, " ").trim(),
            scrollWidth: document.documentElement.scrollWidth,
            links: Array.from(document.querySelectorAll("a"), (a) => ({
              href: a.getAttribute("href"),
              text: a.textContent,
            })),
          }));
          const screenshot = join(
            output,
            `${name}-${row.memberIndex}-${width}.png`,
          );
          await page.screenshot({
            path: screenshot,
            fullPage: true,
            animations: "disabled",
          });
          const link = page.locator('a[href^="pages/"]').first();
          let navigation = false;
          if (await link.count()) {
            await link.click();
            assert.ok(page.url().endsWith(".html"));
            assert.equal(await page.locator("body").count(), 1);
            navigation = true;
          }
          pair.push({
            state,
            errors,
            blockedOrigins: [...new Set(blocked)].toSorted((a, b) =>
              a.localeCompare(b),
            ),
            navigation,
            hash: createHash("sha256")
              .update(await readFile(screenshot))
              .digest("hex"),
          });
        } finally {
          await context.close();
        }
      }
      await writeFile(
        join(output, `comparison-${row.memberIndex}-${width}.json`),
        JSON.stringify(pair, null, 2),
      );
      assert.deepEqual(
        pair[1].state,
        pair[0].state,
        "Offline document differs; inspect protected evidence",
      );
      assert.deepEqual(
        pair[1].errors,
        pair[0].errors,
        "Offline script errors differ",
      );
      assert.equal(pair[1].navigation, pair[0].navigation);
      checks.push({
        memberIndex: row.memberIndex,
        layout: row.layout,
        width,
        match: true,
        screenshotsByteIdentical: pair[0].hash === pair[1].hash,
        sourceBrowserErrors: pair[0].errors.length,
        navigation: pair[0].navigation,
        externalOriginsBlocked: pair[0].blockedOrigins.length,
      });
    }
  await writeFile(
    join(output, "receipt.json"),
    JSON.stringify(
      {
        status: "PASS_BOUNDED",
        downloadReceipt: join(source, "receipt.json"),
        checks,
        scope:
          "Offline sample per actual cohort layout plus page navigation; external content intentionally blocked",
        productionTouched: false,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ status: "PASS_BOUNDED", output }));
} catch (error) {
  await writeFile(
    join(output, "failure.json"),
    JSON.stringify({ status: "FAIL", message: error.message }, null, 2),
  );
  console.error(
    "Offline export comparison failed; protected evidence " + output,
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
