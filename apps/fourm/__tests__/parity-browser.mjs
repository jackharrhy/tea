import { mediaWorkflows } from "./media-workflows.mjs";
import { reviewSourceFingerprint } from "../scripts/review-source.mjs";
import { setTimeout as delay } from "node:timers/promises";
import {
  settingsWorkflows,
  embeddedGuestbookWorkflow,
} from "./settings-workflows.mjs";
import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const root =
  process.env.FOURM_PARITY_ROOT ??
  "/home/jack/.local/state/form-harrhy-integration/candidate";
const oracle = "http://127.0.0.1:18964",
  native = "http://127.0.0.1:18974";
const auth = JSON.parse(
  await readFile(root + "/parity-cohort-20261112/review-auth.json", "utf8"),
);
const selection = JSON.parse(
  await readFile(root + "/parity-cohort-20261112/selection.json", "utf8"),
);
const output =
  root + "/parity-browser-" + new Date().toISOString().replace(/[:.]/g, "");
await mkdir(output, { mode: 0o700 });
const browser = await chromium.launch(),
  results = [];
let phase = "start";
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function context(origin, width) {
  const c = await browser.newContext({
    viewport: { width, height: 900 },
    serviceWorkers: "block",
  });
  await c.route("**/*", (r) =>
    [oracle, native, "http://127.0.0.1:18975"].includes(
      new URL(r.request().url()).origin,
    )
      ? r.continue()
      : r.abort(),
  );
  if (origin === oracle) {
    const cookie = spawnSync(
      "/home/jack/repos/personal/4orm/.venv/bin/python",
      [
        fileURLToPath(new URL("./oracle-session.py", import.meta.url)),
        root + "/python-oracle",
        String(auth.userId),
      ],
      { encoding: "utf8" },
    );
    assert.equal(cookie.status, 0, "Local oracle session helper failed");
    await c.addCookies([
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
    const p = await c.newPage();
    await p.goto(native + "/login");
    await p
      .getByRole("button", { name: "Continue as local user", exact: true })
      .click();
    await p.waitForURL(
      (url) => url.origin === native && url.pathname.startsWith("/u/"),
    );
    await p.close();
  }
  return c;
}
function observe() {
  return {
    topbar: document
      .querySelector(".topbar")
      ?.textContent?.replace(/\s+/g, " ")
      .trim(),
    headings: [...document.querySelectorAll("main h1,main h2,summary")].map(
      (el) => el.textContent.replace(/\s+/g, " ").trim(),
    ),
    forms: [...document.querySelectorAll("main form")].map((form) => ({
      action: form.getAttribute("action"),
      fields: [...form.querySelectorAll("input,textarea,select")].map(
        (field) => ({
          name: field.getAttribute("name"),
          value: field.value,
          checked: field instanceof HTMLInputElement && field.checked,
          options:
            field instanceof HTMLSelectElement
              ? [...field.options].map((option) => ({
                  value: option.value,
                  text: option.text,
                  disabled: option.disabled,
                }))
              : null,
        }),
      ),
    })),
    embeds: [...document.querySelectorAll('iframe[src*="guestbook"]')].map(
      (el) => el.getAttribute("src"),
    ),
    cards: [...document.querySelectorAll("iframe.card-frame")].map((el) => {
      const d = new DOMParser().parseFromString(
        el.getAttribute("srcdoc"),
        "text/html",
      );
      return {
        link: d.querySelector("h2 a")?.getAttribute("href"),
        headline: d.querySelector("h2")?.textContent,
        body: d.body.textContent.replace(/\s+/g, " ").trim(),
      };
    }),
    entries: [...document.querySelectorAll(".gb-entry")].map((el) => ({
      id: el.id,
      author: el.querySelector(".gb-meta a")?.textContent.trim(),
      date: el.querySelector("time")?.getAttribute("datetime"),
      message: el.querySelector(".gb-message")?.textContent,
    })),
    mediaGeometry: [...document.querySelectorAll(".media-item summary")].map(
      (el) => {
        const rect = el.getBoundingClientRect(),
          code = el.querySelector("code").getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          codeX: code.x,
        };
      },
    ),
    mediaSummaries: [...document.querySelectorAll(".media-item summary")].map(
      (el) => el.textContent.replace(/\s+/g, " ").trim(),
    ),
    mediaPreviews: [
      ...document.querySelectorAll(
        ".media-item img,.media-item audio,.media-item video",
      ),
    ].map((el) => ({
      tag: el.tagName,
      src: el.getAttribute("src"),
      alt: el.getAttribute("alt"),
    })),
    overflow: document.documentElement.scrollWidth > innerWidth,
  };
}

try {
  for (const origin of [oracle, native]) {
    phase = "readiness";
    const deadline = Date.now() + 30_000;
    while (true) {
      try {
        if ((await fetch(origin, { signal: AbortSignal.timeout(2000) })).ok)
          break;
      } catch {}
      if (Date.now() > deadline)
        throw new Error("A private parity listener is not ready");
      await delay(150);
    }
  }
  const runtime = JSON.parse(
    await readFile(
      fileURLToPath(
        new URL("../.review/parity-local/runtime.json", import.meta.url),
      ),
      "utf8",
    ),
  );
  const readiness = await (await fetch(native + "/ready")).json();
  assert.ok(
    runtime.sourceFingerprint,
    "A source fingerprint is required for parity evidence",
  );
  assert.equal(
    runtime.sourceFingerprint,
    await reviewSourceFingerprint(
      fileURLToPath(new URL("..", import.meta.url)),
    ),
    "The worktree changed since deployment",
  );
  assert.equal(
    readiness.sourceFingerprint,
    runtime.sourceFingerprint,
    "The live worker is not the runner's deployed source",
  );
  for (const width of [1280, 390]) {
    const capture = {};
    for (const [name, origin] of [
      ["oracle", oracle],
      ["native", native],
    ]) {
      phase = `${name}-${width}`;
      const c = await context(origin, width),
        p = await c.newPage(),
        pages = {};
      const browserLog = [];
      p.on("console", (message) =>
        browserLog.push({
          kind: "console",
          type: message.type(),
          phase,
          text: message.text(),
          location: message.location(),
        }),
      );
      p.on("pageerror", (error) =>
        browserLog.push({
          kind: "pageerror",
          phase,
          name: error.name,
          message: error.message,
        }),
      );
      p.on("requestfailed", (request) =>
        browserLog.push({
          kind: "requestfailed",
          phase,
          url: request.url(),
          failure: request.failure(),
        }),
      );
      for (const [kind, path] of [
        ["home", "/"],
        ["profile", "/u/" + selection.username],
        ["guestbook", "/u/" + selection.username + "/guestbook"],
        ["settings", "/settings"],
        ["media", "/settings/media"],
      ]) {
        phase = `${name}-${kind}-${width}`;
        const r = await p.goto(origin + path, { waitUntil: "networkidle" });
        assert.equal(r.status(), 200);
        if (kind === "settings")
          await p.locator(".cm-editor").first().waitFor();
        pages[kind] = await p.evaluate(observe);
        await p.screenshot({
          path: `${output}/${name}-${kind}-${width}.png`,
          fullPage: true,
        });
      }
      if (process.env.FOURM_PARITY_WRITES === "1") {
        phase = `${name}-settings-workflows-${width}`;
        const workflow = await settingsWorkflows(p, origin);
        workflow.embeddedGuestbook = await embeddedGuestbookWorkflow(
          p,
          origin,
          selection.username,
        );
        phase = `${name}-media-workflows-${width}`;
        workflow.media = await mediaWorkflows(p, origin);
        pages.workflow = workflow;
        await writeFile(
          output + `/${name}-settings-workflows-${width}.json`,
          JSON.stringify(workflow, null, 2),
          { mode: 0o600 },
        );
        await p.goto(origin, { waitUntil: "networkidle" });
        pages.home = await p.evaluate(observe);
        await p.screenshot({
          path: `${output}/${name}-home-after-workflows-${width}.png`,
          fullPage: true,
        });
      }
      const api = await c.request.get(origin + "/settings", {
        headers: { Accept: "application/json" },
      });
      assert.equal(api.status(), 200);
      pages.settingsJSON = await api.json();
      const homeApi = await c.request.get(origin + "/", {
        headers: { Accept: "application/json" },
      });
      assert.equal(homeApi.status(), 200);
      pages.homeJSON = await homeApi.json();
      capture[name] = pages;
      await c.close();
      await writeFile(
        output + `/${name}-browser-log-${width}.json`,
        JSON.stringify(browserLog, null, 2),
        { mode: 0o600 },
      );
      assert.equal(
        browserLog.filter((event) => event.kind === "pageerror").length,
        0,
        "Unexpected browser script exception; inspect the protected browser log",
      );
      assert.equal(
        browserLog.filter(
          (event) =>
            event.kind === "requestfailed" &&
            [oracle, native, "http://127.0.0.1:18975"].includes(
              new URL(event.url).origin,
            ) &&
            event.failure?.errorText !== "net::ERR_ABORTED",
        ).length,
        0,
        "Unexpected local request failure; inspect the protected browser log",
      );
    }
    await writeFile(
      output + `/observations-${width}.json`,
      JSON.stringify(capture, null, 2),
      { mode: 0o600 },
    );
    phase = `compare-${width}`;
    assert.deepEqual(
      capture.native.home.cards,
      capture.oracle.home.cards,
      "Home card order/content mismatch",
    );
    assert.deepEqual(
      capture.native.profile.embeds,
      capture.oracle.profile.embeds,
      "Profile embed placement mismatch",
    );
    assert.deepEqual(
      capture.native.guestbook.entries,
      capture.oracle.guestbook.entries,
      "Guestbook content/order mismatch",
    );
    assert.deepEqual(
      capture.native.media.mediaGeometry,
      capture.oracle.media.mediaGeometry,
      "Media row layout mismatch",
    );
    assert.deepEqual(
      capture.native.media.mediaSummaries,
      capture.oracle.media.mediaSummaries,
      "Media names/types/sizes mismatch",
    );
    assert.deepEqual(
      capture.native.media.mediaPreviews,
      capture.oracle.media.mediaPreviews,
      "Media previews mismatch",
    );
    assert.deepEqual(
      capture.native.media.forms,
      capture.oracle.media.forms,
      "Media forms and saved values mismatch",
    );
    assert.deepEqual(
      capture.native.media.headings,
      capture.oracle.media.headings,
      "Media composition mismatch",
    );
    assert.deepEqual(
      capture.native.settings.headings,
      capture.oracle.settings.headings,
      "Settings composition mismatch",
    );
    if (process.env.FOURM_PARITY_WRITES === "1")
      assert.deepEqual(capture.native.workflow, capture.oracle.workflow);
    assert.deepEqual(
      capture.native.settings.forms,
      capture.oracle.settings.forms,
      "Settings saved values and controls mismatch",
    );
    assert.deepEqual(
      capture.native.settingsJSON,
      capture.oracle.settingsJSON,
      "Settings JSON contract mismatch",
    );
    assert.deepEqual(
      capture.native.homeJSON.cards.map((card) => ({
        ...card,
        rendered_content: card.rendered_content.trim(),
      })),
      capture.oracle.homeJSON.cards.map((card) => ({
        ...card,
        rendered_content: card.rendered_content.trim(),
      })),
      "Homepage JSON contract mismatch",
    );
    results.push({
      width,
      cards: true,
      profileEmbeds: true,
      guestbook: true,
      settingsComposition: true,
      oracleFormDigest: digest(capture.oracle.settings.forms),
      nativeFormDigest: digest(capture.native.settings.forms),
    });
  }
  await writeFile(
    output + "/receipt.json",
    JSON.stringify(
      {
        status: "PASS",
        results,
        authentication:
          "Explicit isolated local review identities; not production SSO",
        productionChanged: false,
        sourceFingerprint: runtime.sourceFingerprint,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(JSON.stringify({ status: "PASS", output, results }));
} catch (error) {
  await writeFile(
    output + "/failure.json",
    JSON.stringify(
      { phase, name: error.name, message: error.message, results },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(JSON.stringify({ status: "FAIL", phase, output }));
  process.exitCode = 1;
} finally {
  await browser.close();
}
