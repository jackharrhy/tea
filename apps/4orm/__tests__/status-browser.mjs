import { parityTarget, privateEqual } from "./parity-target.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
process.umask(0o077);
const { root, database, oracle, native } = await parityTarget();
const output =
  root + "/status-browser-" + new Date().toISOString().replace(/[:.]/g, "");
await mkdir(output, { mode: 0o700 });
const rows = spawnSync(
  "python3",
  [
    "-c",
    "import sqlite3,json,sys,pathlib; p=pathlib.Path(sys.argv[1]); d=sqlite3.connect(p.as_uri()+'?mode=ro',uri=True); d.row_factory=sqlite3.Row; print(json.dumps([dict(r) for r in d.execute(\"SELECT username,(status_text!='' OR status_emoji!='') AS present FROM users ORDER BY id\")]))",
    database,
  ],
  { encoding: "utf8" },
);
assert.equal(rows.status, 0);
const owners = JSON.parse(rows.stdout);
const browser = await chromium.launch();
let phase = "start";
try {
  for (const owner of owners) {
    phase = "json";
    const path = "/u/" + encodeURIComponent(owner.username) + "/status";
    const values = [];
    for (const origin of [oracle, native]) {
      const response = await fetch(origin + path, {
        headers: { Accept: "application/json" },
      });
      assert.equal(response.status, 200);
      values.push(await response.json());
    }
    privateEqual(
      values[1],
      values[0],
      "Status JSON differs; private cohort only",
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
              origin + "/u/" + encodeURIComponent(owner.username) + "/status",
            )
          ).status(),
          200,
        );
        capture[name] = await page.evaluate(() => ({
          text: document.body.textContent.replace(/\s+/g, " ").trim(),
          emoji: document.querySelector(".status-emoji")?.textContent ?? null,
          status: document.querySelector(".status-text")?.textContent ?? null,
          time: document.querySelector(".status-time")?.textContent ?? null,
          style: document.querySelector(".status")
            ? {
                font: getComputedStyle(document.querySelector(".status"))
                  .fontFamily,
                gap: getComputedStyle(document.querySelector(".status")).gap,
              }
            : null,
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
      privateEqual(
        capture.native,
        capture.oracle,
        "Status widget differs; inspect protected comparison",
      );
      const hashes = await Promise.all(
        ["oracle", "native"].map(async (name) =>
          createHash("sha256")
            .update(await readFile(output + `/${name}-${index}-${width}.png`))
            .digest("hex"),
        ),
      );
      assert.equal(hashes[0], hashes[1], "Status screenshots differ");
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
        targets: { oracle, native },
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
  console.error("Status comparison failed; protected evidence: " + output);
  process.exitCode = 1;
} finally {
  await browser.close();
}
