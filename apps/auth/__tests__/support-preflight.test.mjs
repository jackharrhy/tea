import "remix/node-tsx";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { createSupportRoutes } from "../src/support-routes.mjs";
const { renderPerson } = await import("../src/person-page.tsx");

test("missing or unavailable local profile blocks form and POST before native issuance; native eligibility precedes lookup", async () => {
  const dir = mkdtempSync(tmpdir() + "/support-preflight-");
  const original = globalThis.fetch;
  let linked = false,
    active = true,
    lookups = 0;
  const target = {
    id: "target",
    userName: "target",
    state: "USER_STATE_ACTIVE",
    human: { profile: { displayName: "Target" } },
  };
  writeFileSync(
    dir + "/config.json",
    JSON.stringify({
      enabled: true,
      actorSubject: "actor",
      issuer: "https://issuer.test",
      clientId: "support-client",
      clientSecret: "secret",
      encryptionKey: randomBytes(32).toString("base64url"),
      consumers: {
        artbin: {
          origin: "https://artbin.test",
          callback: "https://artbin.test/auth/support/callback",
          projectId: "project",
          organizationId: "org",
          resourceClientId: "resource",
          resourceSecret: "secret",
          transportSecret: "a".repeat(43),
        },
      },
    }),
    { mode: 0o600 },
  );
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://artbin.test/auth/support/eligibility");
    lookups++;
    return linked === null
      ? new Response("", { status: 503 })
      : Response.json({ version: 1, localProfileExists: linked });
  };
  const routes = createSupportRoutes({
    configFile: dir + "/config.json",
    filename: dir + "/access.sqlite",
    origin: "https://auth.test",
    access: { isAdministrator: (id) => id === "actor", blocked: () => false },
    accountActions: {
      managedUser: async (id) => ({
        ...target,
        id,
        state: active ? "USER_STATE_ACTIVE" : "USER_STATE_LOCKED",
      }),
    },
    native: {
      list: async () => [
        {
          projectId: "project",
          state: "USER_GRANT_STATE_ACTIVE",
          roleKeys: ["member"],
        },
      ],
    },
  });
  const context = { user: "actor", admin: true, csrf: "csrf" };
  const apiUrl = "https://auth.test/support/session";
  const getResponse = await routes.api.fetch(new Request(apiUrl));
  assert.equal(getResponse.status, 400);
  assert.equal(getResponse.headers.get("set-cookie"), null);
  const oversized = await routes.api.fetch(
    new Request(apiUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "x".repeat(16385),
    }),
  );
  assert.equal(oversized.status, 413);
  const unauthorized = await routes.api.fetch(
    new Request(apiUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  );
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get("cache-control"), "no-store");
  const browser = async (method) => {
    let html;
    await routes.browser({
      request: { method },
      url: new URL("https://auth.test/manage/people/target/support"),
      context,
      form: new Map([
        ["consumer", "artbin"],
        ["reason", "Read-only acceptance"],
      ]),
      setPolicy() {},
      async sendRemix(render) {
        html = await render("test-nonce");
      },
      redirect() {
        assert.fail("Ineligible target must not get a handoff");
      },
    });
    return html;
  };
  try {
    const missing = await browser("GET");
    assert.match(missing, /Needs first Artbin sign-in/);
    assert.doesNotMatch(missing.match(/<main[\s\S]*?<\/main>/)[0], /<form/);
    await assert.rejects(browser("POST"), { status: 403 });
    linked = null;
    assert.match(await browser("GET"), /could not be checked/);
    await assert.rejects(browser("POST"), { status: 403 });
    active = false;
    const count = lookups;
    assert.equal(await routes.preflight("actor", "target"), "ineligible");
    assert.equal(await routes.preflight("other-admin", "target"), "ineligible");
    assert.equal(lookups, count);
  } finally {
    routes.close();
    globalThis.fetch = original;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("View as appears only in eligible Artbin service context, never as a standalone person action", async () => {
  const user = {
    id: "target",
    userName: "target",
    state: "USER_STATE_ACTIVE",
    human: { profile: { displayName: "Target" } },
  };
  const model = {
    memberships: [],
    groups: [],
    blocks: [],
    direct: [],
    revision: 0,
  };
  const apps = [{ id: "artbin", projectId: "project" }];
  const services = [{ applicationId: "artbin", name: "Artbin" }];
  const grants = [
    {
      userId: "target",
      projectId: "project",
      state: "USER_GRANT_STATE_ACTIVE",
      roleKeys: ["member"],
    },
  ];
  const render = (state) =>
    renderPerson(
      user,
      model,
      apps,
      services,
      grants,
      {
        user: "actor",
        admin: true,
        csrf: "csrf",
        supportEnabled: true,
        supportTarget: state,
      },
      undefined,
      "test-nonce",
    );
  assert.match(
    await render("ready"),
    /<strong>Artbin<\/strong><span class="table-subline"><a[^>]+>View as this person/,
  );
  for (const state of ["missing", "unavailable", "ineligible"])
    assert.doesNotMatch(await render(state), /View as this person|\/support"/);
  assert.match(await render("missing"), /Needs first Artbin sign-in/);
  assert.doesNotMatch(await render("ready"), /Support login in Artbin/);
});
