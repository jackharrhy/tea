import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { reviewSourceFingerprint } from "../scripts/review-source.mjs";
process.umask(0o077);
const root = "/home/jack/.local/state/form-harrhy-integration/candidate";
const output =
  root + "/webring-browser-" + new Date().toISOString().replace(/[:.]/g, "");
await mkdir(output, { mode: 0o700 });
const runtime = JSON.parse(
  await readFile("apps/fourm/.review/parity-local/runtime.json", "utf8"),
);
assert.equal(
  runtime.sourceFingerprint,
  await reviewSourceFingerprint(resolve("apps/fourm")),
);
const rows = spawnSync(
  "python3",
  [
    "-c",
    "import sqlite3,json,sys,pathlib; p=pathlib.Path(sys.argv[1]); d=sqlite3.connect(p.as_uri()+'?mode=ro',uri=True); d.row_factory=sqlite3.Row; print(json.dumps([dict(r) for r in d.execute(\"SELECT username,in_webring AS present FROM users ORDER BY id\")]))",
    root + "/parity-cohort-20261112/review.sqlite3",
  ],
  { encoding: "utf8" },
);
assert.equal(rows.status, 0);
const owners = JSON.parse(rows.stdout);
const browser = await chromium.launch();
let phase = "start";
try {
  const oracle = "http://127.0.0.1:18964",
    native = "http://127.0.0.1:18974";
  for (const owner of owners) {
    phase = "json";
    const path = "/u/" + encodeURIComponent(owner.username) + "/webring";
    const values = [];
    for (const origin of [oracle, native]) {
      const response = await fetch(origin + path, {
        headers: { Accept: "application/json" },
      });
      assert.equal(response.status, 200);
      values.push(await response.json());
    }
    assert.deepEqual(
      values[1],
      values[0],
      "Webring JSON differs; private cohort only",
    );
  }
  for (const origin of [oracle, native]) {
    assert.equal(
      (
        await fetch(origin + "/u/fourm-review-absent-8a531/webring", {
          headers: { Accept: "application/json" },
        })
      ).status,
      404,
    );
    const random = await fetch(origin + "/webring/random", {
      redirect: "manual",
    });
    assert.equal(random.status, 302);
    assert.ok(
      owners.some(
        (o) =>
          o.present && random.headers.get("Location") === "/u/" + o.username,
      ),
    );
  }
  const selected = [
    ...owners.filter((o) => o.present),
    owners.find((o) => !o.present),
  ].filter(Boolean);
  const checks = [];
  const screenshotEquality = [];
  for (const width of [1280, 390])
    for (const [index, owner] of selected.entries()) {
      const capture = {};
      for (const [name, origin] of [
        ["oracle", oracle],
        ["native", native],
      ]) {
        phase = `${name}-${width}-${index}`;
        const context = await browser.newContext({
          viewport: { width, height: 300 },
          serviceWorkers: "block",
        });
        await context.route("**/*", (r) =>
          new URL(r.request().url()).origin === origin
            ? r.continue()
            : r.abort(),
        );
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        assert.equal(
          (
            await page.goto(
              origin + "/u/" + encodeURIComponent(owner.username) + "/webring",
            )
          ).status(),
          200,
        );
        capture[name] = await page.evaluate(() => ({
          text: document.body.textContent.replace(/\s+/g, " ").trim(),
          links: Array.from(document.querySelectorAll("a"), (a) => ({
            href: a.getAttribute("href"),
            target: a.target,
            text: a.textContent,
          })),
          box: (() => {
            const e = document.querySelector(".webring");
            const r = e.getBoundingClientRect();
            const c = getComputedStyle(e);
            return {
              x: r.x,
              y: r.y,
              width: r.width,
              height: r.height,
              gap: c.gap,
              font: c.fontFamily,
            };
          })(),
        }));
        await page.screenshot({
          path: output + `/${name}-${index}-${width}.png`,
          fullPage: true,
        });
        assert.equal(errors.length, 0);
        await context.close();
      }
      await writeFile(
        output + `/comparison-${index}-${width}.json`,
        JSON.stringify(capture, null, 2),
      );
      assert.deepEqual(
        capture.native,
        capture.oracle,
        "Webring widget differs; inspect protected comparison",
      );
      const hashes = await Promise.all(
        ["oracle", "native"].map(async (name) =>
          createHash("sha256")
            .update(await readFile(output + `/${name}-${index}-${width}.png`))
            .digest("hex"),
        ),
      );
      assert.equal(hashes[0], hashes[1], "Webring screenshots differ");
      screenshotEquality.push({ index, width, byteIdentical: true });
      checks.push({ index, width, match: true });
    }
  await writeFile(
    output + "/receipt.json",
    JSON.stringify(
      {
        status: "PASS",
        jsonMembers: owners.length,
        present: owners.filter((o) => o.present).length,
        checks,
        screenshotEquality,
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
  console.error("Webring comparison failed; protected evidence: " + output);
  process.exitCode = 1;
} finally {
  await browser.close();
}
