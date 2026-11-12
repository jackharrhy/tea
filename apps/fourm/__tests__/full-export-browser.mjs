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
  root + "/full-export-" + new Date().toISOString().replace(/[:.]/g, "");
await mkdir(output, { mode: 0o700 });
const expected = await reviewSourceFingerprint(resolve("apps/fourm"));
let ready = false;
for (let i = 0; i < 120; i++) {
  try {
    const r = await fetch("http://127.0.0.1:18974/ready");
    if (r.ok && (await r.json()).sourceFingerprint === expected) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
assert.ok(ready, "Exact native source not ready");
const auth = JSON.parse(
  await readFile(root + "/parity-cohort-20261112/review-auth.json", "utf8"),
);
const browser = await chromium.launch();
const contexts = [];
let phase = "login";
try {
  const archives = [];
  let cancelledDownload = false;
  for (const [name, origin] of [
    ["oracle", "http://127.0.0.1:18964"],
    ["native", "http://127.0.0.1:18974"],
  ]) {
    phase = name + "-login";
    await writeFile(output + "/progress.json", JSON.stringify({ phase }));
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
      (await context.request.get(origin + "/admin/export")).status(),
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
      phase = "native-cancellation";
      const cookies = await context.cookies(origin);
      const response = await fetch(origin + "/admin/export", {
        headers: {
          Cookie: cookies.map((c) => c.name + "=" + c.value).join("; "),
        },
        signal: AbortSignal.timeout(30000),
      });
      assert.equal(response.status, 200);
      const reader = response.body.getReader();
      const chunk = await reader.read();
      assert.ok(chunk.value.length > 0);
      await reader.cancel();
      assert.equal(
        (await fetch(origin + "/ready", { signal: AbortSignal.timeout(15000) }))
          .status,
        200,
      );
      cancelledDownload = true;
    }
    phase = name + "-download";
    await writeFile(output + "/progress.json", JSON.stringify({ phase }));
    const response = await context.request.get(origin + "/admin/export", {
      timeout: 240000,
    });
    assert.equal(response.status(), 200);
    assert.match(response.headers()["content-type"], /^application\/zip/);
    assert.equal(
      response.headers()["content-disposition"],
      'attachment; filename="4orm-export.zip"',
    );
    const bytes = await response.body();
    await writeFile(output + "/" + name + ".zip", bytes);
    archives.push(unzipSync(bytes));
  }
  phase = "entry-comparison";
  assert.deepEqual(
    Object.keys(archives[1]).toSorted(),
    Object.keys(archives[0]).toSorted(),
    "Full ZIP entries differ",
  );
  const inspectorContext = await browser.newContext({
    serviceWorkers: "block",
  });
  contexts.push(inspectorContext);
  await inspectorContext.route("**/*", (r) => r.abort());
  const inspector = await inspectorContext.newPage();
  let html = 0,
    media = 0;
  const checks = [];
  for (const path of Object.keys(archives[0])) {
    if (path.endsWith(".html")) {
      const documents = archives.map((a) => new TextDecoder().decode(a[path]));
      const values = await inspector.evaluate(
        (texts) =>
          texts.map((text) => {
            const document = new DOMParser().parseFromString(text, "text/html");
            const visit = (node) => {
              if (node.nodeType === 3) {
                const value = node.textContent.replace(/\s+/g, " ").trim();
                return value || null;
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
          output + "/difference-" + html + ".json",
          JSON.stringify({ path, values }, null, 2),
        );
        throw Error("Full export HTML differs; protected index " + html);
      }
      html++;
    } else {
      const hashes = archives.map((a) =>
        createHash("sha256").update(a[path]).digest("hex"),
      );
      assert.equal(
        hashes[0],
        hashes[1],
        "Export binary differs; inspect protected archives",
      );
      if (path.includes("/uploads/")) media++;
    }
    checks.push({ entryIndex: checks.length, match: true });
  }
  assert.equal((await fetch("http://127.0.0.1:18974/ready")).status, 200);
  await writeFile(
    output + "/receipt.json",
    JSON.stringify(
      {
        status: "PASS",
        entries: checks.length,
        html,
        media,
        cancelledDownload,
        sourceFingerprint: expected,
        productionTouched: false,
        scope:
          "Actual full-site ZIP downloads; exact entries and asset bytes, normalized HTML; cancellation followed by successful complete native export",
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
  console.error("Full export comparison failed; protected evidence " + output);
  process.exitCode = 1;
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
