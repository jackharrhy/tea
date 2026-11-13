/* oxlint-disable eslint/no-shadow */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  authorizationForRequest,
  authorizationCallback,
} from "../src/applications.mjs";
import { createAuthorizationActions } from "../src/authorization.mjs";
import { authorization as authorizationView } from "../src/views.mjs";

const application = {
  id: "artbin",
  name: "Artbin",
  projectId: "artbin-project",
  clientIds: ["artbin-client"],
  delegatedRoles: ["admin"],
};
const applications = [
  application,
  {
    id: "maps",
    name: "Maps",
    projectId: "maps-project",
    clientIds: ["maps-client"],
    delegatedRoles: ["admin"],
  },
  {
    id: "lore",
    name: "Lore",
    projectId: "lore-project",
    clientIds: ["lore-client"],
  },
];
const scope = [
  "openid",
  "profile",
  "urn:zitadel:iam:org:project:id:artbin-project:aud",
  "urn:zitadel:iam:org:projects:roles",
  "urn:zitadel:iam:org:project:role:admin",
];
const request = {
  clientId: "dynamic-client",
  redirectUri: "https://mcp-client.example/callback",
  scope,
};
function fixture() {
  let currentRequest = structuredClone(request);
  let assigned = [
    { userId: "jack", state: "USER_GRANT_STATE_ACTIVE", roleKeys: ["admin"] },
  ];
  const writes = [];
  const actions = createAuthorizationActions({
    applications,
    grants: async () => assigned,
    api: async (path, options) => {
      if (!options) return { authRequest: currentRequest };
      writes.push(options.body);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        callbackUrl:
          "https://mcp-client.example/callback?code=one-use&state=client-state",
      };
    },
  });
  return {
    actions,
    writes,
    session: {
      userId: "jack",
      sessionId: "provider-session",
      sessionToken: "provider-proof",
    },
    setRequest: (value) => {
      currentRequest = value;
    },
    setGrants: (value) => {
      assigned = value;
    },
  };
}

test("registered clients keep their direct flow; new clients require explicit one-app delegation", () => {
  assert.equal(
    authorizationForRequest(applications, {
      ...request,
      clientId: "artbin-client",
    }).consent,
    false,
  );
  const result = authorizationForRequest(applications, request);
  assert.equal(result.application.id, "artbin");
  assert.equal(result.clientOrigin, "https://mcp-client.example");
  assert.deepEqual(result.roles, ["admin"]);
  for (const changed of [
    { scope: ["openid", "profile"] },
    { scope: [...scope, "urn:zitadel:iam:org:project:id:maps-project:aud"] },
    { scope: [...scope, "urn:zitadel:iam:org:project:id:zitadel:aud"] },
    {
      scope: scope.filter(
        (value) => value !== "urn:zitadel:iam:org:projects:roles",
      ),
    },
    {
      scope: scope.map((value) =>
        value.replace("artbin-project", "lore-project"),
      ),
    },
    { scope: [...scope, "urn:zitadel:iam:user:metadata"] },
    { redirectUri: "http://public-client.example/callback" },
    { redirectUri: "https://user:secret@mcp-client.example/callback" },
    { redirectUri: "javascript:alert(1)" },
    { scope: "openid profile" },
  ])
    assert.throws(
      () => authorizationForRequest(applications, { ...request, ...changed }),
      { status: 403 },
    );
  assert.equal(
    authorizationForRequest(applications, {
      ...request,
      redirectUri: "http://127.0.0.1:41123/callback",
    }).consent,
    true,
  );
});

test("delegated approval needs a viewed request and a fresh matching active role", async () => {
  const f = fixture();
  await assert.rejects(f.actions.complete("request", f.session, "approve"), {
    status: 400,
  });
  assert.equal(f.writes.length, 0);
  const intent = await f.actions.view("request", f.session);
  assert.equal(intent.consent, true);
  assert.equal(f.writes.length, 0, "GET must never grant delegated access");
  f.setGrants([
    { userId: "jack", state: "USER_GRANT_STATE_ACTIVE", roleKeys: ["member"] },
  ]);
  await assert.rejects(f.actions.complete("request", f.session, "approve"), {
    status: 403,
  });
  f.setGrants([
    { userId: "jack", state: "USER_GRANT_STATE_INACTIVE", roleKeys: ["admin"] },
  ]);
  await assert.rejects(f.actions.complete("request", f.session, "approve"), {
    status: 403,
  });
  assert.equal(f.writes.length, 0);
});

test("automatic approval and metadata changes cannot bypass delegated consent", async () => {
  const f = fixture();
  await f.actions.view("request", f.session);
  await assert.rejects(
    f.actions.complete("request", f.session, "approve", true),
    { status: 400 },
  );
  f.setRequest({
    ...request,
    redirectUri: "https://different-client.example/callback",
  });
  await assert.rejects(f.actions.complete("request", f.session, "approve"), {
    status: 400,
  });
  assert.equal(f.writes.length, 0);
});

test("concurrent approval finalizes once and repeats preserve the decision", async () => {
  const f = fixture();
  await f.actions.view("request", f.session);
  const callbacks = await Promise.all([
    f.actions.complete("request", f.session, "approve"),
    f.actions.complete("request", f.session, "approve"),
  ]);
  assert.equal(callbacks[0], callbacks[1]);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0], {
    session: { sessionId: "provider-session", sessionToken: "provider-proof" },
  });
  await assert.rejects(f.actions.complete("request", f.session, "deny"), {
    status: 409,
  });
});

test("denial sends an OAuth error and callbacks stay on the registered target", async () => {
  const f = fixture();
  await f.actions.view("request", f.session);
  await f.actions.complete("request", f.session, "deny");
  assert.deepEqual(f.writes[0], {
    error: { error: "ERROR_REASON_ACCESS_DENIED" },
  });
  for (const destination of [
    "https://different.example/callback?code=x",
    "https://mcp-client.example/other?code=x",
    "https://mcp-client.example/callback#token=x",
  ]) {
    assert.throws(
      () => authorizationCallback(request.redirectUri, destination),
      { status: 502 },
    );
  }
});

test("the consent view identifies the recipient, permission and optional data without active markup", () => {
  const intent = authorizationForRequest(applications, {
    ...request,
    scope: [...scope, "email", "offline_access"],
  });
  const html = authorizationView(
    {
      ...intent,
      application: { ...application, name: "<script>bad</script>" },
      request: { scope: [...scope, "email"] },
    },
    "request",
    { user: "jack", csrf: "proof" },
  );
  assert.match(html, /https:\/\/mcp-client\.example/);
  assert.match(html, /Administrator/);
  assert.match(html, /Email address/);
  assert.match(html, /Stay connected/);
  assert.match(html, /name="csrf" value="proof"/);
  assert.ok(!html.includes("<script>"));
  assert.match(html, /value="deny"/);
  assert.match(html, /value="approve"/);
});

test("Lists delegation requires explicit operation entitlements and never changes local access", async () => {
  const lists = {
    id: "lists",
    name: "Tea Lists",
    projectId: "lists-project",
    clientIds: ["lists-browser"],
    delegatedRoles: ["admin", "member"],
    delegatedPermissions: ["lists-read", "campaigns-send"],
  };
  const prefix = "urn:zitadel:iam:org:project:role:";
  const requested = {
    ...request,
    scope: [
      "openid",
      "urn:zitadel:iam:org:project:id:lists-project:aud",
      "urn:zitadel:iam:org:projects:roles",
      prefix + "member",
      prefix + "lists-read",
    ],
  };
  let grant = {
    userId: "member",
    state: "USER_GRANT_STATE_ACTIVE",
    roleKeys: ["member", "lists-read"],
  };
  let current = structuredClone(requested);
  let approvals = 0;
  const actions = createAuthorizationActions({
    applications: [lists],
    grants: async () => [grant],
    api: async (path, options) => {
      if (!options) return { authRequest: current };
      approvals++;
      return { callbackUrl: request.redirectUri + "?code=fixture" };
    },
  });
  const session = { userId: "member" };
  const viewed = await actions.view("read", session);
  assert.deepEqual(viewed.roles, ["member", "lists-read"]);
  assert.match(
    authorizationView(viewed, "read", { user: "member", csrf: "proof" }),
    /lists-read/,
  );
  await actions.complete("read", session, "approve");
  assert.equal(approvals, 1);
  current = {
    ...requested,
    scope: [...requested.scope, prefix + "campaigns-send"],
  };
  await assert.rejects(actions.view("send", session), { status: 403 });
  grant = { ...grant, roleKeys: ["admin", "lists-read", "campaigns-send"] };
  await assert.rejects(actions.view("send", session), { status: 403 });
  for (const scope of [
    requested.scope.slice(0, -1),
    [...requested.scope, prefix + "admin"],
    [...requested.scope, "campaigns:send"],
    [...requested.scope, prefix + "unlisted"],
    [...requested.scope, "urn:zitadel:iam:org:project:id:artbin-project:aud"],
  ]) {
    assert.throws(
      () =>
        authorizationForRequest([lists, application], { ...requested, scope }),
      { status: 403 },
    );
  }
  const held = { ...lists, authorizationHold: true };
  assert.throws(() => authorizationForRequest([held], requested), {
    status: 403,
  });
  assert.throws(
    () =>
      authorizationForRequest([held], {
        ...requested,
        clientId: "lists-browser",
      }),
    { status: 403 },
  );
  assert.equal(approvals, 1);
});

test("Lists delegated requests cannot resume a weak transaction created before scoped ingress", () => {
  const minimum = "2026-11-10T19:00:00Z";
  const app = {
    id: "lists",
    projectId: "lists-project",
    clientIds: ["lists-browser"],
    delegatedRoles: ["admin"],
    delegatedPermissions: ["lists-read"],
    delegatedAuthRequestNotBefore: minimum,
  };
  const value = {
    ...request,
    scope: [
      "openid",
      "urn:zitadel:iam:org:project:id:lists-project:aud",
      "urn:zitadel:iam:org:projects:roles",
      "urn:zitadel:iam:org:project:role:admin",
      "urn:zitadel:iam:org:project:role:lists-read",
    ],
  };
  for (const creationDate of [
    undefined,
    "invalid",
    "2026-11-10T18:59:59Z",
    minimum,
  ]) {
    assert.throws(
      () => authorizationForRequest([app], { ...value, creationDate }),
      { status: 400 },
    );
  }
  assert.equal(
    authorizationForRequest([app], {
      ...value,
      creationDate: "2026-11-10T19:00:01Z",
    }).consent,
    true,
  );
  assert.equal(authorizationForRequest(applications, request).consent, true);
});

test("organization portal authenticates active local humans without creating service grants", async () => {
  const portal = {
    id: "rotund-portal",
    projectId: "portal",
    clientIds: ["portal-client"],
    organizationHumansOnly: true,
  };
  let user = {
    id: "person",
    state: "USER_STATE_ACTIVE",
    human: {},
    details: { resourceOwner: "org" },
  };
  const api = async (path) =>
    path.startsWith("/v2/oidc/")
      ? { authRequest: { clientId: "portal-client" } }
      : { user };
  const actions = createAuthorizationActions({
    api,
    applications: [portal],
    organizationId: "org",
    grants: async () => {
      throw new Error("Portal must not read or grant service eligibility");
    },
  });
  assert.equal(
    (await actions.view("request", { userId: "person" })).application.id,
    "rotund-portal",
  );
  for (const changed of [
    { ...user, state: "USER_STATE_INACTIVE" },
    { ...user, id: "other" },
    { ...user, details: { resourceOwner: "other-org" } },
    { ...user, human: undefined, machine: {} },
    { ...user, human: undefined },
  ]) {
    const original = user;
    user = changed;
    await assert.rejects(actions.view("request", { userId: "person" }), {
      status: 403,
    });
    user = original;
  }
  const normal = createAuthorizationActions({
    api: async () => ({ authRequest: { clientId: "normal" } }),
    applications: [{ clientIds: ["normal"] }],
    organizationId: "org",
    grants: async () => [],
  });
  await assert.rejects(normal.view("request", { userId: "person" }), {
    status: 403,
  });
});

test("portal prompt none returns login_required without interactive login, and reuses only valid organization human sessions", async () => {
  const app = {
    id: "portal",
    clientIds: ["portal-client"],
    organizationHumansOnly: true,
  };
  const request = {
    clientId: "portal-client",
    redirectUri: "https://rotund.example/auth/callback",
    prompt: ["PROMPT_NONE"],
  };
  let proof = {
    factors: { user: { id: "person" }, password: { verifiedAt: "now" } },
    expirationDate: "2099-01-01T00:00:00Z",
  };
  let user = {
    id: "person",
    state: "USER_STATE_ACTIVE",
    human: {},
    details: { resourceOwner: "org" },
  };
  let lastBody;
  const api = async (path, options) => {
    if (path.startsWith("/v2/oidc/")) {
      if (options?.method === "POST") {
        lastBody = options.body;
        return {
          callbackUrl:
            request.redirectUri +
            (lastBody.error ? "?error=login_required" : "?code=one-use"),
        };
      }
      return { authRequest: request };
    }
    if (path.startsWith("/v2/sessions/")) return { session: proof };
    return { user };
  };
  const actions = createAuthorizationActions({
    api,
    applications: [app],
    organizationId: "org",
    grants: async () => {
      throw new Error("No service grants on sign-in");
    },
  });
  assert.match(
    (await actions.begin("request", {})).callback,
    /error=login_required/,
  );
  assert.deepEqual(lastBody, {
    error: { error: "ERROR_REASON_LOGIN_REQUIRED" },
  });
  const session = {
    userId: "person",
    sessionId: "session",
    sessionToken: "server-proof",
  };
  assert.match(
    (await actions.begin("request", session)).callback,
    /code=one-use/,
  );
  assert.deepEqual(lastBody, {
    session: { sessionId: "session", sessionToken: "server-proof" },
  });
  const good = proof;
  for (const invalid of [
    { ...proof, expirationDate: "2000-01-01T00:00:00Z" },
    { ...proof, factors: { user: { id: "other" } } },
    undefined,
  ]) {
    proof = invalid;
    assert.match(
      (await actions.begin("request", session)).callback,
      /error=login_required/,
    );
  }
  proof = good;
  user = { ...user, state: "USER_STATE_INACTIVE" };
  assert.match(
    (await actions.begin("request", session)).callback,
    /error=login_required/,
  );
  request.prompt = [];
  lastBody = undefined;
  assert.equal((await actions.begin("request", {})).callback, undefined);
  assert.equal(lastBody, undefined);
  request.prompt = ["PROMPT_NONE"];
  const other = createAuthorizationActions({
    api,
    applications: [{ ...app, organizationHumansOnly: false }],
    grants: async () => [],
  });
  assert.match(
    (await other.begin("request", {})).callback,
    /error=login_required/,
  );
});

test("OIDC login and max-age requests require a fresh local authentication before approval", async () => {
  const now = Date.parse("2026-11-13T03:00:00Z");
  const application = {
    id: "editor",
    name: "Editor",
    projectId: "editor-project",
    clientIds: ["editor-browser"],
  };
  const request = {
    clientId: "editor-browser",
    redirectUri: "https://editor.example.test/callback",
    scope: ["openid"],
    creationDate: new Date(now - 10_000).toISOString(),
    prompt: ["PROMPT_LOGIN"],
  };
  const actions = createAuthorizationActions({
    api: async () => ({ authRequest: request }),
    applications: [application],
    grants: async () => [
      {
        userId: "person",
        state: "USER_GRANT_STATE_ACTIVE",
        roleKeys: ["member"],
      },
    ],
    now: () => now,
  });
  const session = { userId: "person", authenticatedAt: now - 20_000 };
  assert.equal((await actions.begin("request", session)).requireLogin, true);
  await assert.rejects(actions.view("request", session), { status: 401 });
  session.authenticatedAt = now - 1_000;
  assert.equal((await actions.begin("request", session)).requireLogin, false);
  assert.equal(
    (await actions.view("request", session)).application.id,
    "editor",
  );

  request.prompt = [];
  request.maxAge = "60s";
  session.authenticatedAt = now - 61_000;
  assert.equal((await actions.begin("request", session)).requireLogin, true);
  session.authenticatedAt = now - 59_000;
  assert.equal((await actions.begin("request", session)).requireLogin, false);
  request.maxAge = "0s";
  assert.equal((await actions.begin("request", session)).requireLogin, true);
  session.authenticatedAt = now - 1_000;
  assert.equal((await actions.begin("request", session)).requireLogin, false);
  request.maxAge = "invalid";
  await assert.rejects(actions.begin("request", session), { status: 400 });
});

test("unsupported account selection returns a native error without choosing the current user", async () => {
  const request = {
    clientId: "artbin-client",
    redirectUri: "https://artbin.example.test/callback",
    scope: ["openid"],
    prompt: ["PROMPT_SELECT_ACCOUNT"],
  };
  const writes = [];
  const actions = createAuthorizationActions({
    applications: [application],
    grants: async () => [
      { userId: "jack", state: "USER_GRANT_STATE_ACTIVE", roleKeys: ["admin"] },
    ],
    api: async (_path, options) => {
      if (!options) return { authRequest: request };
      writes.push(options.body);
      return {
        callbackUrl:
          "https://artbin.example.test/callback?error=account_selection_required&state=client-state",
      };
    },
  });
  const session = {
    userId: "jack",
    sessionId: "provider-session",
    sessionToken: "provider-proof",
    authenticatedAt: Date.now(),
  };
  for (const current of [session, {}]) {
    const { callback } = await actions.begin("request", current);
    assert.match(callback, /error=account_selection_required/);
    assert.doesNotMatch(callback, /code=/);
  }
  assert.deepEqual(
    writes,
    Array.from({ length: 2 }, () => ({
      error: { error: "ERROR_REASON_ACCOUNT_SELECTION_REQUIRED" },
    })),
  );
  await assert.rejects(actions.view("request", session), { status: 403 });
  await assert.rejects(actions.complete("request", session, "approve", true), {
    status: 403,
  });
  assert.equal(writes.length, 2);
});

test("silent requests never approve a delegated consent decision", async () => {
  const app = {
    id: "archive",
    name: "Archive",
    projectId: "archive-project",
    clientIds: ["archive-browser"],
    delegatedRoles: ["admin"],
  };
  const request = {
    clientId: "disposable-client",
    redirectUri: "https://archive.example.test/callback",
    creationDate: new Date().toISOString(),
    prompt: ["PROMPT_NONE"],
    scope: [
      "openid",
      "urn:zitadel:iam:org:project:id:archive-project:aud",
      "urn:zitadel:iam:org:projects:roles",
      "urn:zitadel:iam:org:project:role:admin",
    ],
  };
  let body;
  const actions = createAuthorizationActions({
    applications: [app],
    grants: async () => [
      {
        userId: "person",
        state: "USER_GRANT_STATE_ACTIVE",
        roleKeys: ["admin"],
      },
    ],
    api: async (path, options) => {
      if (path.startsWith("/v2/sessions/"))
        return {
          session: {
            factors: {
              user: { id: "person" },
              password: { verifiedAt: new Date().toISOString() },
            },
            expirationDate: "2099-01-01T00:00:00Z",
          },
        };
      if (options) {
        body = options.body;
        return {
          callbackUrl:
            "https://archive.example.test/callback?error=login_required",
        };
      }
      return { authRequest: request };
    },
  });
  const result = await actions.begin("request", {
    userId: "person",
    sessionId: "session",
    sessionToken: "proof",
  });
  assert.match(result.callback, /login_required/);
  assert.deepEqual(body, { error: { error: "ERROR_REASON_LOGIN_REQUIRED" } });
});

test("shared CMS project enforces client-specific admission independently of requested scopes", async () => {
  const cms = {
    id: "cms",
    projectId: "cms-project",
    clientIds: ["operator", "andrew", "luke"],
    clientRoleRequirements: {
      operator: ["admin"],
      andrew: ["member", "admin"],
      luke: ["member", "admin"],
    },
  };
  let clientId = "operator";
  let grant = {
    userId: "person",
    state: "USER_GRANT_STATE_ACTIVE",
    roleKeys: ["member"],
  };
  const actions = createAuthorizationActions({
    applications: [cms],
    api: async () => ({ authRequest: { clientId, scope: ["openid"] } }),
    grants: async () => [grant],
  });
  await assert.rejects(actions.view("request", { userId: "person" }), {
    status: 403,
  });
  clientId = "andrew";
  assert.equal(
    (await actions.view("request", { userId: "person" })).application.id,
    "cms",
  );
  clientId = "luke";
  assert.equal(
    (await actions.view("request", { userId: "person" })).application.id,
    "cms",
  );
  clientId = "operator";
  grant = { ...grant, roleKeys: ["admin"] };
  assert.equal(
    (await actions.view("request", { userId: "person" })).application.id,
    "cms",
  );
  clientId = "andrew";
  assert.equal(
    (await actions.view("request", { userId: "person" })).application.id,
    "cms",
  );
  grant = { ...grant, state: "USER_GRANT_STATE_INACTIVE" };
  await assert.rejects(actions.view("request", { userId: "person" }), {
    status: 403,
  });
  grant = { ...grant, state: "USER_GRANT_STATE_ACTIVE", roleKeys: [] };
  await assert.rejects(actions.view("request", { userId: "person" }), {
    status: 403,
  });
});

for (const applicationId of ["marky", "letters-to-steve", "ref"])
  test(`released ${applicationId} client requires fresh requests and an active member/admin grant regardless of scopes`, async () => {
    const marky = JSON.parse(
      readFileSync(new URL("../config/applications.json", import.meta.url)),
    ).find((app) => app.id === applicationId);
    const clientId = marky.clientIds[0],
      cutoff = marky.authRequestNotBefore[clientId];
    let request = {
      clientId,
      scope: ["openid"],
      creationDate: new Date(Date.parse(cutoff) + 1000).toISOString(),
    };
    let grant;
    const actions = createAuthorizationActions({
      applications: [marky],
      api: async () => ({ authRequest: request }),
      grants: async () => (grant ? [grant] : []),
    });
    const session = { userId: "person" };
    await assert.rejects(actions.view("request", session), { status: 403 });
    for (const invalid of [
      {
        userId: "person",
        state: "USER_GRANT_STATE_INACTIVE",
        roleKeys: ["member"],
      },
      {
        userId: "person",
        state: "USER_GRANT_STATE_ACTIVE",
        roleKeys: ["archive-read"],
      },
      { userId: "person", state: "USER_GRANT_STATE_ACTIVE", roleKeys: [] },
    ]) {
      grant = invalid;
      await assert.rejects(actions.view("request", session), { status: 403 });
    }
    for (const role of ["member", "admin"]) {
      grant = {
        userId: "person",
        state: "USER_GRANT_STATE_ACTIVE",
        roleKeys: [role],
      };
      assert.equal(
        (await actions.view("request", session)).application.id,
        applicationId,
      );
    }
    for (const date of [
      undefined,
      "invalid",
      cutoff,
      new Date(Date.parse(cutoff) - 1).toISOString(),
    ]) {
      request = { ...request, creationDate: date };
      await assert.rejects(actions.view("request", session), { status: 400 });
    }
  });

test("released Radio requests must be fresh before entering explicit member enrollment", () => {
  const radio = JSON.parse(
    readFileSync(new URL("../config/applications.json", import.meta.url)),
  ).find((app) => app.id === "radio");
  const clientId = radio.clientIds[0],
    cutoff = radio.authRequestNotBefore[clientId];
  const request = {
    clientId,
    scope: ["openid"],
    creationDate: new Date(Date.parse(cutoff) + 1000).toISOString(),
  };
  assert.equal(
    authorizationForRequest([radio], request).application.id,
    "radio",
  );
  for (const creationDate of [
    undefined,
    "invalid",
    cutoff,
    new Date(Date.parse(cutoff) - 1).toISOString(),
  ]) {
    assert.throws(
      () => authorizationForRequest([radio], { ...request, creationDate }),
      { status: 400 },
    );
  }
});

test("Ref archive delegation needs fresh explicit consent and the requested admin operation grants", async () => {
  const app = JSON.parse(
    readFileSync(new URL("../config/applications.json", import.meta.url)),
  ).find((app) => app.id === "ref");
  const prefix = "urn:zitadel:iam:org:project:role:";
  const scope = [
    "openid",
    `urn:zitadel:iam:org:project:id:${app.projectId}:aud`,
    "urn:zitadel:iam:org:projects:roles",
    prefix + "admin",
    prefix + "archive-read",
  ];
  let request = {
    clientId: "disposable-ref-cli",
    redirectUri: "http://127.0.0.1:4445/callback",
    scope,
    creationDate: new Date(
      Date.parse(app.delegatedAuthRequestNotBefore) + 1000,
    ).toISOString(),
  };
  let grant = {
    userId: "person",
    state: "USER_GRANT_STATE_ACTIVE",
    roleKeys: ["member", "archive-read"],
  };
  let approvals = 0;
  const actions = createAuthorizationActions({
    applications: [app],
    grants: async () => [grant],
    api: async (_path, options) => {
      if (!options) return { authRequest: request };
      approvals++;
      return { callbackUrl: request.redirectUri + "?code=fixture" };
    },
  });
  const session = { userId: "person" };
  await assert.rejects(actions.view("read", session), { status: 403 });
  grant = { ...grant, roleKeys: ["admin"] };
  await assert.rejects(actions.view("read", session), { status: 403 });
  grant = { ...grant, roleKeys: ["admin", "archive-read", "archive-restore"] };
  await assert.rejects(actions.complete("read", session, "approve"), {
    status: 400,
  });
  const intent = await actions.view("read", session);
  assert.deepEqual(intent.roles, ["admin", "archive-read"]);
  assert.equal(intent.consent, true);
  assert.equal(approvals, 0);
  await assert.rejects(actions.complete("read", session, "approve", true), {
    status: 400,
  });
  await actions.complete("read", session, "approve");
  assert.equal(approvals, 1);
  await actions.view("changed", session);
  request = { ...request, scope: [...scope, prefix + "archive-restore"] };
  await assert.rejects(actions.complete("changed", session, "approve"), {
    status: 400,
  });
  assert.deepEqual((await actions.view("restore", session)).roles, [
    "admin",
    "archive-read",
    "archive-restore",
  ]);
  grant = { ...grant, roleKeys: ["admin", "archive-read"] };
  await assert.rejects(actions.complete("restore", session, "approve"), {
    status: 403,
  });
  for (const invalidScope of [
    scope.filter((s) => s !== prefix + "archive-read"),
    scope.map((s) => s.replace(prefix + "admin", prefix + "member")),
    [...scope, prefix + "member"],
    [...scope, prefix + "unlisted"],
  ]) {
    assert.throws(
      () => authorizationForRequest([app], { ...request, scope: invalidScope }),
      { status: 403 },
    );
  }
  for (const creationDate of [
    undefined,
    "invalid",
    app.delegatedAuthRequestNotBefore,
    new Date(Date.parse(app.delegatedAuthRequestNotBefore) - 1).toISOString(),
  ]) {
    assert.throws(
      () => authorizationForRequest([app], { ...request, creationDate }),
      { status: 400 },
    );
  }
  assert.equal(approvals, 1);
});

test("Navidrome requires a fresh request and the active app-specific admin grant without role scopes", async () => {
  const app = JSON.parse(
    readFileSync(new URL("../config/applications.json", import.meta.url)),
  ).find((app) => app.id === "navidrome");
  const clientId = app.clientIds[0],
    cutoff = app.authRequestNotBefore[clientId];
  let request = {
    clientId,
    scope: ["openid", "email", "profile"],
    creationDate: new Date(Date.parse(cutoff) + 1000).toISOString(),
  };
  let grant;
  const actions = createAuthorizationActions({
    applications: [app],
    api: async () => ({ authRequest: request }),
    grants: async () => (grant ? [grant] : []),
  });
  const session = { userId: "reviewed-owner" };
  await assert.rejects(actions.view("request", session), { status: 403 });
  for (const invalid of [
    {
      userId: "reviewed-owner",
      state: "USER_GRANT_STATE_INACTIVE",
      roleKeys: ["admin"],
    },
    {
      userId: "reviewed-owner",
      state: "USER_GRANT_STATE_ACTIVE",
      roleKeys: ["member"],
    },
    {
      userId: "other-person",
      state: "USER_GRANT_STATE_ACTIVE",
      roleKeys: ["admin"],
    },
  ]) {
    grant = invalid;
    await assert.rejects(actions.view("request", session), { status: 403 });
  }
  grant = {
    userId: "reviewed-owner",
    state: "USER_GRANT_STATE_ACTIVE",
    roleKeys: ["admin"],
  };
  assert.equal(
    (await actions.view("request", session)).application.id,
    "navidrome",
  );
  for (const creationDate of [
    undefined,
    "invalid",
    cutoff,
    new Date(Date.parse(cutoff) - 1).toISOString(),
  ]) {
    request = { ...request, creationDate };
    await assert.rejects(actions.view("request", session), { status: 400 });
  }
});

test("an explicit service block overrides an otherwise valid native delegated grant", async () => {
  let calls = 0;
  const actions = createAuthorizationActions({
    applications,
    isBlocked: () => true,
    grants: async () => [
      { userId: "jack", state: "USER_GRANT_STATE_ACTIVE", roleKeys: ["admin"] },
    ],
    api: async (_, options) => {
      if (options) calls++;
      return { authRequest: request };
    },
  });
  await assert.rejects(actions.view("request", { userId: "jack" }), {
    status: 403,
  });
  assert.equal(calls, 0);
});
