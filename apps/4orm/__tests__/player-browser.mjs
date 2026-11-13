import { parityTarget, privateEqual } from "./parity-target.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
process.umask(0o077);
const { root, database, oracle, native } = await parityTarget();
const output =
  root + "/player-browser-" + new Date().toISOString().replace(/[:.]/g, "");
await mkdir(output, { mode: 0o700 });
const rows = spawnSync(
  "python3",
  [
    "-c",
    "import sqlite3,json,sys,pathlib; p=pathlib.Path(sys.argv[1]); d=sqlite3.connect(p.as_uri()+'?mode=ro',uri=True); d.row_factory=sqlite3.Row; print(json.dumps([dict(r) for r in d.execute(\"SELECT username,(SELECT count(*) FROM playlist_items p WHERE p.user_id=users.id)>0 AS present FROM users ORDER BY id\")]))",
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
    const path = "/u/" + encodeURIComponent(owner.username) + "/player";
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
      "Player JSON differs; private cohort only",
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
              origin + "/u/" + encodeURIComponent(owner.username) + "/player",
            )
          ).status(),
          200,
        );
        capture[name] = await page.evaluate(() => ({
          title: document.querySelector("#now-playing")?.textContent ?? null,
          empty: document.querySelector(".empty")?.textContent ?? null,
          tracks: Array.from(
            document.querySelectorAll("#track-list li"),
            (e) => ({
              text: e.textContent.trim(),
              src: e.dataset.src,
              index: e.dataset.idx,
            }),
          ),
          controls: Array.from(
            document.querySelectorAll(".controls button"),
            (e) => e.textContent,
          ),
          font: getComputedStyle(document.body).fontFamily,
          background: getComputedStyle(document.body).backgroundColor,
        }));
        await page.screenshot({
          path: output + `/${name}-${index}-${width}.png`,
          fullPage: true,
        });
        if (capture[name].tracks.length) {
          await page.locator("#track-list li").first().click();
          await page.waitForFunction(
            () => {
              const audio = document.querySelector("#audio");
              return (
                audio.readyState >= 2 && !audio.paused && audio.currentTime > 0
              );
            },
            { timeout: 15000 },
          );
          await page.evaluate(() => document.querySelector("#audio").pause());
          await page.reload();
          await page.evaluate(() => {
            const audio = document.querySelector("#audio");
            window.reviewPlays = 0;
            window.reviewPauses = 0;
            audio.play = () => {
              window.reviewPlays++;
              return Promise.resolve();
            };
            audio.pause = () => {
              window.reviewPauses++;
            };
          });
          await page.locator("#play-btn").click();
          assert.equal(
            await page
              .locator("#track-list li.active")
              .getAttribute("data-idx"),
            "0",
          );
          assert.equal(await page.locator("#play-btn").textContent(), "⏸");
          await page.locator(".controls button").last().click();
          assert.equal(
            await page
              .locator("#track-list li.active")
              .getAttribute("data-idx"),
            String(1 % capture[name].tracks.length),
          );
          await page.locator(".controls button").first().click();
          assert.equal(
            await page
              .locator("#track-list li.active")
              .getAttribute("data-idx"),
            "0",
          );
          await page.locator("#track-list li").last().click();
          await page.evaluate(() =>
            document.querySelector("#audio").dispatchEvent(new Event("ended")),
          );
          assert.equal(
            await page
              .locator("#track-list li.active")
              .getAttribute("data-idx"),
            "0",
          );
          assert.equal(await page.evaluate(() => window.reviewPlays), 5);
        }
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
        "Player widget differs; inspect protected comparison",
      );
      const hashes = await Promise.all(
        ["oracle", "native"].map(async (name) =>
          createHash("sha256")
            .update(await readFile(output + `/${name}-${index}-${width}.png`))
            .digest("hex"),
        ),
      );
      assert.equal(hashes[0], hashes[1], "Player screenshots differ");
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
        controlsTestedWithMediaPlayStub: true,
        actualAudioDecodingVerified: true,
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
  console.error("Player comparison failed; protected evidence: " + output);
  process.exitCode = 1;
} finally {
  await browser.close();
}
