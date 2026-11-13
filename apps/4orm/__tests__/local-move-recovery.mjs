import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const root = "/home/jack/.local/state/form-harrhy-integration/candidate",
  origin = "http://127.0.0.1:18974";
const auth = JSON.parse(
  await readFile(root + "/parity-cohort-20261112/review-auth.json", "utf8"),
);
const selection = JSON.parse(
  await readFile(root + "/parity-cohort-20261112/selection.json", "utf8"),
);
const inventory = JSON.parse(
  await readFile(root + "/parity-cohort-20261112/inventory.json", "utf8"),
);
const output = root + "/media-move-live-recovery-" + Date.now() + ".json";
const browser = await chromium.launch();
let phase = "readiness";
try {
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      if ((await fetch(origin + "/ready")).ok) break;
    } catch {}
    if (Date.now() > deadline) throw Error("Private listener unavailable");
    await new Promise((r) => setTimeout(r, 150));
  }
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", (r) =>
    [origin, "http://127.0.0.1:18975"].includes(
      new URL(r.request().url()).origin,
    )
      ? r.continue()
      : r.abort(),
  );
  const page = await context.newPage();
  await page.goto(origin + "/login");
  await page
    .getByRole("button", { name: "Continue as local user", exact: true })
    .click();
  await page.waitForURL(
    (url) => url.origin === origin && url.pathname.startsWith("/u/"),
  );
  const probe = spawnSync(
    "python3",
    [
      "-c",
      `from pathlib import Path
import sqlite3,json
p=max(Path('apps/4orm/.review/parity-local/replica').rglob('db.sqlite'),key=lambda p:int(p.parent.name[1:]))
c=sqlite3.connect(p.resolve().as_uri()+'?mode=ro',uri=True)
print(json.dumps([dict(zip(['id','user_id','kind','target','state'],r)) for r in c.execute('select id,user_id,kind,target,state from media_moves')]))`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(probe.status, 0);
  const jobs = JSON.parse(probe.stdout);
  assert.ok(jobs.length <= 1);
  async function rename(username) {
    const r = await context.request.post(origin + "/settings/username", {
      form: { username },
      headers: { Accept: "application/json", Origin: origin },
      timeout: 60000,
    });
    const body = await r.json();
    if (r.status() !== 200 || body.ok !== true) {
      await writeFile(
        output,
        JSON.stringify(
          { status: "FAIL", phase, responseStatus: r.status(), body },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      throw Error("Private recovery request failed; inspect protected receipt");
    }
  }
  if (jobs.length) {
    assert.equal(jobs[0].user_id, auth.userId);
    assert.equal(jobs[0].kind, "username");
    phase = "resume-recorded-move";
    await rename(jobs[0].target);
  }
  const current = await (
    await context.request.get(origin + "/settings", {
      headers: { Accept: "application/json" },
    })
  ).json();
  if (current.username !== selection.username) {
    phase = "restore-original-private-username";
    await rename(selection.username);
  }
  phase = "verify-original-media-bytes";
  let bytes = 0;
  for (const asset of inventory.assets) {
    const r = await fetch(
      origin +
        "/uploads/" +
        asset.path.split("/").map(encodeURIComponent).join("/"),
    );
    assert.equal(r.status, 200);
    const hash = createHash("sha256");
    let length = 0;
    for await (const chunk of r.body) {
      hash.update(chunk);
      length += chunk.length;
    }
    assert.equal(length, asset.bytes);
    assert.equal(hash.digest("hex"), asset.sha256);
    bytes += length;
  }
  const final = await (
    await context.request.get(origin + "/settings", {
      headers: { Accept: "application/json" },
    })
  ).json();
  assert.equal(final.username, selection.username);
  await writeFile(
    output,
    JSON.stringify(
      {
        status: "PASS",
        scope: "Exact owned private candidate only",
        explicitResumeRequested: jobs.length === 1,
        originalUsernameRestoreRequested:
          current.username !== selection.username,
        backgroundCompletedBeforeRequest:
          jobs.length === 0 && current.username !== selection.username,
        usernameRestored: true,
        memberId: auth.userId,
        assets: inventory.assets.length,
        bytes,
        originalAssetHashesPreserved: true,
        productionTouched: false,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({ status: "PASS", assets: inventory.assets.length, output }),
  );
} catch (error) {
  console.log(
    JSON.stringify({ status: "FAIL", phase, message: error.message }),
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
