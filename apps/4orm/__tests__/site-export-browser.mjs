import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { unzipSync } from "fflate";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reviewSourceFingerprint } from "../scripts/review-source.mjs";
process.umask(0o077);
const root = "/home/jack/.local/state/form-harrhy-integration/candidate";
const output =
  root + "/site-export-" + new Date().toISOString().replace(/[:.]/g, "");
await mkdir(output, { mode: 0o700 });
const expected = await reviewSourceFingerprint(resolve("apps/4orm"));
for (let i = 0; i < 100; i++) {
  try {
    const r = await fetch("http://127.0.0.1:18974/ready");
    if (r.ok && (await r.json()).sourceFingerprint === expected) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
  if (i === 99) throw Error("Exact source runtime not ready");
}
const auth = JSON.parse(
  await readFile(root + "/parity-cohort-20261112/review-auth.json", "utf8"),
);
const query = spawnSync(
  "python3",
  [
    "-c",
    "import sqlite3,json,sys,pathlib; d=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+'?mode=ro',uri=True);d.row_factory=sqlite3.Row;print(json.dumps([dict(r) for r in d.execute('SELECT username,layout FROM users ORDER BY id')]))",
    root + "/parity-cohort-20261112/review.sqlite3",
  ],
  { encoding: "utf8" },
);
assert.equal(query.status, 0);
const users = JSON.parse(query.stdout);
const browser = await chromium.launch();
const contexts = [];
const results = [];
let phase = "login";
try {
  const entries = [];
  for (const [name, origin] of [
    ["oracle", "http://127.0.0.1:18964"],
    ["native", "http://127.0.0.1:18974"],
  ]) {
    const context = await browser.newContext({ serviceWorkers: "block" });
    contexts.push(context);
    await context.route("**/*", (r) =>
      [origin, "http://127.0.0.1:18975"].includes(
        new URL(r.request().url()).origin,
      )
        ? r.continue()
        : r.abort(),
    );
    assert.equal(
      (
        await context.request.get(
          origin + "/u/" + encodeURIComponent(users[0].username) + "/export",
        )
      ).status(),
      403,
    );
    const page = await context.newPage();
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
    } else {
      await page.goto(origin + "/login");
      await page
        .getByRole("button", { name: "Continue as local user", exact: true })
        .click();
      await page.waitForURL(
        (u) => u.origin === origin && u.pathname.startsWith("/u/"),
      );
    }
    entries.push({ name, origin, context, page });
  }
  const compare = await browser.newContext({ serviceWorkers: "block" });
  contexts.push(compare);
  await compare.route("**/*", (r) => r.abort());
  const inspector = await compare.newPage();
  for (const [index, user] of users.entries()) {
    phase = "member-" + index;
    const pair = [];
    for (const { name, origin, context } of entries) {
      const response = await context.request.get(
        origin + "/u/" + encodeURIComponent(user.username) + "/export",
        { timeout: 60000 },
      );
      assert.equal(response.status(), 200);
      assert.match(response.headers()["content-type"], /^application\/zip/);
      assert.equal(
        response.headers()["content-disposition"],
        `attachment; filename="${user.username}-export.zip"`,
      );
      const bytes = await response.body();
      await writeFile(output + `/${name}-${index}.zip`, bytes);
      pair.push(unzipSync(bytes));
    }
    assert.deepEqual(
      Object.keys(pair[1]).toSorted(),
      Object.keys(pair[0]).toSorted(),
      "ZIP entries differ; private member index " + index,
    );
    let media = 0,
      html = 0;
    for (const path of Object.keys(pair[0])) {
      if (path.endsWith(".html")) {
        const documents = pair.map((p) => new TextDecoder().decode(p[path]));
        const values = await inspector.evaluate(
          (texts) =>
            texts.map((text) => {
              const document = new DOMParser().parseFromString(
                text,
                "text/html",
              );
              const visit = (node) => {
                if (node.nodeType === 3) {
                  const normalized = node.textContent
                    .replace(/\s+/g, " ")
                    .trim();
                  return normalized || null;
                }
                if (node.nodeType !== 1) return null;
                const tag = node.tagName.toLowerCase();
                return {
                  tag,
                  attributes: Array.from(node.attributes, (a) => [
                    a.name,
                    a.value,
                  ]).toSorted((a, b) => a[0].localeCompare(b[0])),
                  children: ["script", "style", "pre"].includes(tag)
                    ? [node.textContent]
                    : Array.from(node.childNodes, visit).filter(
                        (v) => v !== null,
                      ),
                };
              };
              return visit(document.documentElement);
            }),
          documents,
        );
        if (JSON.stringify(values[0]) !== JSON.stringify(values[1])) {
          await writeFile(
            output + `/difference-${index}-${html}.json`,
            JSON.stringify({ path, values }, null, 2),
          );
          throw Error("Export HTML differs; private member index " + index);
        }
        html++;
      } else {
        assert.equal(
          createHash("sha256").update(pair[0][path]).digest("hex"),
          createHash("sha256").update(pair[1][path]).digest("hex"),
          "Export asset differs; private member index " + index,
        );
        if (path.includes("/uploads/")) media++;
      }
    }
    results.push({
      memberIndex: index,
      layout: user.layout,
      entries: Object.keys(pair[0]).length,
      html,
      media,
      match: true,
    });
  }
  await writeFile(
    output + "/receipt.json",
    JSON.stringify(
      {
        status: "PASS",
        members: users.length,
        results,
        productionTouched: false,
        scope:
          "Actual ZIP downloads; exact entry and asset checks; normalized parsed HTML; interactive offline-browser reopen pending",
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
  console.error("Export comparison failed; protected evidence " + output);
  process.exitCode = 1;
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
