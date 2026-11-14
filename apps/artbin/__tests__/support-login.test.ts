import { generateKeyPairSync, sign } from "node:crypto";

import { afterEach, expect, test, vi } from "vitest";
import { projectAudienceScope } from "@harrhy/identity";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { once } from "node:events";
import { createRequestListener } from "remix/node-fetch-server";

import { router } from "../app/router.ts";
import { sessions, users } from "#db";
import { setDbForTesting } from "#db/connection.server";
import { getUserFromRequest } from "#lib/auth.server";
import {
  beginSupportLogin,
  completeSupportLogin,
  exitSupportLogin,
  supportRecoveryToken,
} from "#lib/support-login.server";

import { applyMigrations, createTestDatabase, type TestDatabase } from "./db";

const issuer = "https://auth.test";
const supportOrigin = "https://support.test";
const artbin = "https://artbin.test";
const project = "artbin-project";
const scopes =
  "openid profile urn:zitadel:iam:org:project:id:artbin-project:aud urn:zitadel:iam:org:projects:roles";
const grant = {
  "urn:zitadel:iam:org:project:artbin-project:roles": {
    member: { "test-org": "auth.test" },
  },
};
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = {
  ...keys.publicKey.export({ format: "jwk" }),
  kid: "support-key",
  alg: "RS256",
};
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

function signedTargetToken(actor = "actor", target = "target") {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "RS256", kid: "support-key" })}.${encode({
    iss: issuer,
    sub: target,
    aud: project,
    iat: now,
    exp: now + 300,
    act: { iss: issuer, sub: actor },
    ...grant,
  })}`;
  return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), keys.privateKey).toString("base64url")}`;
}

let currentDb: TestDatabase | undefined;
const originalFetch = globalThis.fetch;
const originalEnv = Object.fromEntries(
  [
    "AUTH_ISSUER",
    "AUTH_CLIENT_ID",
    "AUTH_PROJECT_ID",
    "AUTH_ORGANIZATION_ID",
    "AUTH_INTROSPECTION_CLIENT_ID",
    "AUTH_INTROSPECTION_SECRET",
    "AUTH_SUPPORT_CLIENT_ID",
    "AUTH_SUPPORT_ORIGIN",
    "AUTH_SUPPORT_TRANSPORT_SECRET",
    "ARTBIN_SUPPORT_LOGIN_ENABLED",
    "ARTBIN_URL",
    "ARTBIN_REQUIRE_AUTH",
  ].map((key) => [key, process.env[key]]),
);

afterEach(() => {
  vi.restoreAllMocks();
  currentDb?.close();
  currentDb = undefined;
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function setup() {
  currentDb = createTestDatabase();
  applyMigrations(currentDb.sqlite);
  setDbForTesting(currentDb.db);
  Object.assign(process.env, {
    AUTH_ISSUER: issuer,
    AUTH_CLIENT_ID: "artbin-browser",
    AUTH_PROJECT_ID: project,
    AUTH_ORGANIZATION_ID: "test-org",
    AUTH_INTROSPECTION_CLIENT_ID: "artbin-resource",
    AUTH_INTROSPECTION_SECRET: "resource-secret",
    AUTH_SUPPORT_CLIENT_ID: "artbin-support-client",
    AUTH_SUPPORT_ORIGIN: supportOrigin,
    AUTH_SUPPORT_TRANSPORT_SECRET: "support-transport-secret",
    ARTBIN_SUPPORT_LOGIN_ENABLED: "1",
    ARTBIN_URL: artbin,
    ARTBIN_REQUIRE_AUTH: "1",
  });
  return currentDb.db;
}

function mockProvider(input: {
  readonly targetToken: string;
  readonly nonce: string;
  readonly introspectionClientId?: string;
  readonly introspectionScopes?: string;
  readonly statusActive?: () => boolean;
  readonly statusExpiryOffsetMs?: number;
  readonly calls: string[];
}) {
  const expiresAt = new Date(Date.now() + 240_000).toISOString();
  globalThis.fetch = (async (request, options) => {
    const url = String(request);
    input.calls.push(url);
    if (url.endsWith("openid-configuration"))
      return Response.json({
        issuer,
        authorization_endpoint: issuer + "/oauth/v2/authorize",
        token_endpoint: issuer + "/oauth/v2/token",
        userinfo_endpoint: issuer + "/oidc/v1/userinfo",
        jwks_uri: issuer + "/oauth/v2/keys",
        introspection_endpoint: issuer + "/oauth/v2/introspect",
      });
    if (url.endsWith("/oauth/v2/keys")) return Response.json({ keys: [jwk] });
    if (url.endsWith("/support/redeem")) {
      expect(options?.redirect).toBe("manual");
      expect(options?.headers).toMatchObject({
        Authorization: expect.stringMatching(/^Basic /),
      });
      return Response.json({
        access_token: input.targetToken,
        token_type: "Bearer",
        support: {
          id: "support-session",
          actorSubject: "actor",
          targetSubject: "target",
          nonce: input.nonce,
          expiresAt,
          endSecret: "end-secret",
        },
      });
    }
    if (url.endsWith("/oauth/v2/introspect"))
      return Response.json({
        active: true,
        iss: issuer,
        sub: "target",
        act: { iss: issuer, sub: "actor" },
        client_id: input.introspectionClientId ?? "artbin-support-client",
        jack_auth_principal_type: "user",
        token_type: "Bearer",
        exp: Math.floor(Date.now() / 1000) + 300,
        aud: [project],
        scope: input.introspectionScopes ?? scopes,
        ...grant,
      });
    if (url.endsWith("/support/session"))
      return Response.json(
        input.statusActive?.() === false
          ? { active: false }
          : {
              active: true,
              supportId: "support-session",
              actorSubject: "actor",
              targetSubject: "target",
              expiresAt: new Date(
                Date.parse(expiresAt) + (input.statusExpiryOffsetMs ?? 0),
              ).toISOString(),
            },
      );
    if (url.endsWith("/support/end"))
      return Response.json({ active: false, revocation: "pending" });
    throw new Error(`Unexpected test URL ${url}`);
  }) as typeof fetch;
}

function lookup(targetSubject: string, authorization?: string) {
  return router.fetch(
    new Request(`${artbin}/auth/support/eligibility`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify({ targetSubject }),
    }),
  );
}

test("support eligibility requires the dedicated client credential and an existing local subject", async () => {
  const db = setup();
  await db.insert(users).values({
    id: "local-target",
    username: "target-user",
    authSubject: "target",
    isAdmin: false,
  });
  const credential = `Basic ${Buffer.from("artbin-support-client:support-transport-secret").toString("base64")}`;
  expect((await lookup("target")).status).toBe(401);
  expect((await lookup("target", "Basic invalid")).status).toBe(401);
  expect(
    (
      await lookup(
        "target",
        `Basic ${Buffer.from("artbin:support-transport-secret").toString("base64")}`,
      )
    ).status,
  ).toBe(401);
  const linked = await lookup("target", credential);
  expect(linked.status).toBe(200);
  expect(await linked.json()).toEqual({ version: 1, localProfileExists: true });
  const missing = await lookup("unlinked", credential);
  expect(missing.status).toBe(200);
  expect(await missing.json()).toEqual({
    version: 1,
    localProfileExists: false,
  });
});

test("support handoff uses an existing target and exit rejects in-flight verification", async () => {
  const db = setup();
  await db.insert(users).values({
    id: "local-target",
    username: "target-user",
    authSubject: "target",
    isAdmin: false,
  });
  const calls: string[] = [];
  const start = await beginSupportLogin(
    new Request(`${artbin}/auth/support/start?request=${"a".repeat(43)}`),
  );
  expect(start.status).toBe(303);
  const handoff = new URL(start.headers.get("Location")!);
  expect(handoff.origin).toBe(supportOrigin);
  expect(handoff.searchParams.get("code_challenge_method")).toBe("S256");
  const nonce = handoff.searchParams.get("nonce")!;
  const state = handoff.searchParams.get("state")!;
  const stateCookie = start.headers.get("Set-Cookie")!.split(";")[0];
  mockProvider({ targetToken: signedTargetToken(), nonce, calls });
  const callback = await completeSupportLogin(
    new Request(
      `${artbin}/auth/support/callback?code=${"b".repeat(43)}&state=${state}`,
      {
        headers: { Cookie: stateCookie },
      },
    ),
  );
  expect(callback.status).toBe(303);
  expect(calls).toContain(`${supportOrigin}/support/redeem`);
  const sessionCookie = callback.headers
    .getSetCookie()
    .find((entry) => entry.startsWith("artbin_support="))!
    .split(";")[0];
  const request = new Request(`${artbin}/folders`, {
    headers: { Cookie: sessionCookie },
  });
  const user = await getUserFromRequest(request);
  expect(user?.id).toBe("local-target");
  expect(user?.support?.actorSubject).toBe("actor");
  expect(user?.support?.targetUsername).toBe("target-user");
  expect(user?.isAdmin).toBe(false);
  expect(await getUserFromRequest(request)).toBe(user);
  expect(
    calls.filter((call) => call.endsWith("/support/session")),
  ).toHaveLength(1);
  // New document requests must revalidate, without treating stable expiry as ended.
  for (let navigation = 0; navigation < 3; navigation++) {
    const page = await router.fetch(
      new Request(`${artbin}/folders`, {
        headers: { Cookie: sessionCookie, Accept: "text/html" },
      }),
    );
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("target-user");
  }
  await expect(
    getUserFromRequest(
      new Request(`${artbin}/api/cli/whoami`, {
        headers: { Cookie: sessionCookie },
      }),
    ),
  ).rejects.toMatchObject({ status: 403 });
  const csrf = user!.support!.csrfToken;
  const providerFetch = globalThis.fetch;
  let releaseStatus!: () => void;
  let statusEntered!: () => void;
  const statusGate = new Promise<void>((resolve) => {
    releaseStatus = resolve;
  });
  const statusStarted = new Promise<void>((resolve) => {
    statusEntered = resolve;
  });
  globalThis.fetch = (async (input, options) => {
    if (String(input).endsWith("/support/session")) {
      statusEntered();
      await statusGate;
    }
    return providerFetch(input, options);
  }) as typeof fetch;
  const inFlight = getUserFromRequest(
    new Request(`${artbin}/folders`, { headers: { Cookie: sessionCookie } }),
  );
  await statusStarted;
  const exited = await exitSupportLogin(
    new Request(`${artbin}/auth/support/exit`, {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        Origin: artbin,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ csrf }),
    }),
  );
  expect(exited.status).toBe(303);
  releaseStatus();
  await expect(inFlight).rejects.toMatchObject({ status: 401 });
  expect(calls.filter((call) => call.endsWith("/support/end"))).toHaveLength(1);
  await expect(
    getUserFromRequest(
      new Request(`${artbin}/folders`, {
        headers: { Cookie: sessionCookie },
      }),
    ),
  ).rejects.toMatchObject({ status: 401 });
  expect(await db.query.users.findMany()).toMatchObject([
    { id: "local-target", authSubject: "target", isAdmin: false },
  ]);
});

test("even a one-millisecond status expiry mismatch ends support with a secret-free diagnostic", async () => {
  const db = setup();
  await db.insert(users).values({
    id: "expiry-target",
    username: "target-user",
    authSubject: "target",
    isAdmin: false,
  });
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const start = await beginSupportLogin(
    new Request(`${artbin}/auth/support/start?request=${"a".repeat(43)}`),
  );
  const handoff = new URL(start.headers.get("Location")!);
  mockProvider({
    targetToken: signedTargetToken(),
    nonce: handoff.searchParams.get("nonce")!,
    statusExpiryOffsetMs: 1,
    calls: [],
  });
  const callback = await completeSupportLogin(
    new Request(
      `${artbin}/auth/support/callback?code=${"b".repeat(43)}&state=${handoff.searchParams.get("state")}`,
      { headers: { Cookie: start.headers.get("Set-Cookie")!.split(";")[0] } },
    ),
  );
  expect(callback.status).toBe(303);
  const cookie = callback.headers
    .getSetCookie()
    .find((entry) => entry.startsWith("artbin_support="))!
    .split(";")[0];
  const response = await router
    .fetch(
      new Request(`${artbin}/folders`, {
        headers: { Cookie: cookie, Accept: "text/html" },
      }),
    )
    .catch((error: unknown) => {
      if (error instanceof Response) return error;
      throw error;
    });
  expect(response.status).toBe(303);
  expect(response.headers.get("Location")).toBe("/auth/support/recover");
  expect(warning.mock.calls).toEqual([
    ["artbin_support_status_rejected", "expiry"],
  ]);
});

test("wrong support client is rejected after one redemption and cannot enter the app", async () => {
  const db = setup();
  await db.insert(users).values({
    id: "local-target-2",
    username: "target-user-2",
    authSubject: "target",
    isAdmin: false,
  });
  const calls: string[] = [];
  const start = await beginSupportLogin(
    new Request(`${artbin}/auth/support/start?request=${"c".repeat(43)}`),
  );
  const handoff = new URL(start.headers.get("Location")!);
  mockProvider({
    targetToken: signedTargetToken(),
    nonce: handoff.searchParams.get("nonce")!,
    introspectionClientId: "wrong-client",
    calls,
  });
  const callbackUrl = `${artbin}/auth/support/callback?code=${"d".repeat(43)}&state=${handoff.searchParams.get("state")}`;
  const headers = { Cookie: start.headers.get("Set-Cookie")!.split(";")[0] };
  const warnings: string[] = [];
  vi.spyOn(console, "warn").mockImplementation((message) => {
    warnings.push(String(message));
  });
  const rejected = await completeSupportLogin(
    new Request(callbackUrl, { headers }),
  );
  expect(rejected.status).toBe(303);
  expect(rejected.headers.get("Location")).toBe(
    "/auth/support/problem?reason=general",
  );
  expect(rejected.headers.get("Referrer-Policy")).toBe("no-referrer");
  const replay = await completeSupportLogin(
    new Request(callbackUrl, { headers }),
  );
  expect(replay.status).toBe(303);
  expect(replay.headers.get("Location")).toBe(
    "/auth/support/problem?reason=general",
  );
  expect(replay.headers.get("Set-Cookie")).toContain("artbin_support_state=;");
  expect(calls.filter((call) => call.endsWith("/support/redeem"))).toHaveLength(
    1,
  );
  expect(calls.filter((call) => call.endsWith("/support/end"))).toHaveLength(1);
  expect(warnings).toEqual([
    JSON.stringify({
      event: "artbin_support_callback_failed",
      stage: "identity",
      cleanupOutcome: "end-accepted",
    }),
    JSON.stringify({
      event: "artbin_support_callback_failed",
      stage: "transaction",
      cleanupOutcome: "not-issued",
    }),
  ]);
});

test("early support callback failures clear the query and transaction cookie", async () => {
  setup();
  const start = await beginSupportLogin(
    new Request(`${artbin}/auth/support/start?request=${"i".repeat(43)}`),
  );
  const handoff = new URL(start.headers.get("Location")!);
  const state = handoff.searchParams.get("state")!;
  const cookieHeader = start.headers.get("Set-Cookie")!.split(";")[0];
  const callback = (query: string, cookie = cookieHeader) =>
    completeSupportLogin(
      new Request(`${artbin}/auth/support/callback?${query}`, {
        headers: { Cookie: cookie },
      }),
    );
  const code = "j".repeat(43);
  for (const response of [
    await callback(`code=${code}&state=${state}`, ""),
    await callback(`code=${code}&state=${state}wrong`),
    await callback(`state=${state}`),
    await callback(`code=${code}&state=${state}`),
  ]) {
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(
      "/auth/support/problem?reason=general",
    );
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Set-Cookie")).toContain(
      "artbin_support_state=;",
    );
  }
  process.env.ARTBIN_SUPPORT_LOGIN_ENABLED = "0";
  expect((await callback(`code=${code}&state=${state}`)).status).toBe(303);
});

test("signed target role cannot replace browser scopes missing from native introspection", async () => {
  const db = setup();
  await db.insert(users).values({
    id: "local-target-scope",
    username: "target-scope",
    authSubject: "target",
    isAdmin: false,
  });
  const calls: string[] = [];
  const start = await beginSupportLogin(
    new Request(`${artbin}/auth/support/start?request=${"e".repeat(43)}`),
  );
  const handoff = new URL(start.headers.get("Location")!);
  mockProvider({
    targetToken: signedTargetToken(),
    nonce: handoff.searchParams.get("nonce")!,
    introspectionScopes: `openid profile ${projectAudienceScope(project)}`,
    calls,
  });
  const callback = await completeSupportLogin(
    new Request(
      `${artbin}/auth/support/callback?code=${"f".repeat(43)}&state=${handoff.searchParams.get("state")}`,
      { headers: { Cookie: start.headers.get("Set-Cookie")!.split(";")[0] } },
    ),
  );
  expect(callback.status).toBe(303);
  expect(callback.headers.get("Location")).toBe(
    "/auth/support/problem?reason=general",
  );
  expect(calls.filter((call) => call.endsWith("/support/end"))).toHaveLength(1);
});

test("unlinked support target ends the redeemed token and shows a clean actionable error", async () => {
  setup();
  const calls: string[] = [];
  const start = await beginSupportLogin(
    new Request(`${artbin}/auth/support/start?request=${"g".repeat(43)}`),
  );
  const handoff = new URL(start.headers.get("Location")!);
  mockProvider({
    targetToken: signedTargetToken(),
    nonce: handoff.searchParams.get("nonce")!,
    calls,
  });
  const callback = await completeSupportLogin(
    new Request(
      `${artbin}/auth/support/callback?code=${"h".repeat(43)}&state=${handoff.searchParams.get("state")}`,
      { headers: { Cookie: start.headers.get("Set-Cookie")!.split(";")[0] } },
    ),
  );
  expect(callback.status).toBe(303);
  expect(callback.headers.get("Location")).toBe(
    "/auth/support/problem?reason=account",
  );
  expect(callback.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(callback.headers.getSetCookie()).not.toContainEqual(
    expect.stringMatching(/^artbin_support=/),
  );
  expect(calls.filter((call) => call.endsWith("/support/end"))).toHaveLength(1);
  const problem = await router.fetch(
    new Request(`${artbin}/auth/support/problem?reason=account`),
  );
  expect(problem.status).toBe(403);
  expect(problem.headers.get("Referrer-Policy")).toBe("no-referrer");
  const page = await problem.text();
  expect(page).toContain("does not have an Artbin account");
  expect(page).toContain("Return to people");
  expect(page).not.toMatch(/Jack\s*Auth/i);
});

test.runIf(process.env.ARTBIN_SUPPORT_BROWSER_TEST === "1")(
  "browser recovery form sends valid Origin and CSRF and clears a stale support cookie",
  async () => {
    setup();
    let exitStatus: number | undefined;
    let exitOrigin: string | null = null;
    const server = createServer(
      createRequestListener(async (request) => {
        const pathname = new URL(request.url).pathname;
        if (pathname === "/auth/login")
          return new Response("<h1>Normal sign-in</h1>", {
            headers: { "Content-Type": "text/html" },
          });
        const response = await router.fetch(request).catch((error: unknown) => {
          if (error instanceof Response) return error;
          throw error;
        });
        if (pathname === "/auth/support/exit") {
          exitStatus = response.status;
          exitOrigin = request.headers.get("Origin");
        }
        return response;
      }),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing fixture address");
    const browserOrigin = `http://127.0.0.1:${address.port}`;
    process.env.ARTBIN_URL = browserOrigin;
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ javaScriptEnabled: false });
      await context.addCookies([
        {
          name: "artbin_support",
          value: "synthetic-stale-session",
          url: browserOrigin,
          secure: true,
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
      const page = await context.newPage();
      await page.goto(`${browserOrigin}/auth/support/recover`, {
        waitUntil: "domcontentloaded",
        timeout: 5000,
      });
      await page
        .getByRole("button", { name: "Clear support session" })
        .click({ timeout: 5000 });
      await page.waitForURL(`${browserOrigin}/auth/login`, { timeout: 5000 });
      expect(exitStatus).toBe(303);
      expect(exitOrigin).toBe(browserOrigin);
      expect(
        (await context.cookies()).some(
          (cookie) => cookie.name === "artbin_support",
        ),
      ).toBe(false);
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
  30000,
);

test("stale support cookie blocks actor fallback until explicit CSRF-protected exit", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const db = setup();
  await db.insert(users).values({
    id: "local-actor",
    username: "actor-user",
    authSubject: "actor",
    isAdmin: true,
  });
  await db.insert(sessions).values({
    id: "ordinary-session",
    userId: "local-actor",
    expiresAt: new Date(Date.now() + 300_000),
  });
  const supportCookie = `artbin_support=${"z".repeat(43)}`;
  const actorCookie = "artbin_session=ordinary-session";
  const staleHeaders = { Cookie: `${supportCookie}; ${actorCookie}` };
  delete process.env.ARTBIN_SUPPORT_LOGIN_ENABLED;

  await expect(
    getUserFromRequest(
      new Request(`${artbin}/folders`, { headers: staleHeaders }),
    ),
  ).rejects.toMatchObject({ status: 401 });
  const staleDocument = await getUserFromRequest(
    new Request(`${artbin}/folders`, {
      headers: { ...staleHeaders, Accept: "text/html" },
    }),
  ).catch((error: unknown) => error as Response);
  expect(staleDocument).toBeInstanceOf(Response);
  expect((staleDocument as Response).status).toBe(303);
  expect((staleDocument as Response).headers.get("Location")).toBe(
    "/auth/support/recover",
  );
  const csrf = supportRecoveryToken(
    new Request(`${artbin}/auth/support/recover`, { headers: staleHeaders }),
  );
  expect(csrf).toMatch(/^[a-f0-9]{64}$/);
  const recovery = await router.fetch(
    new Request(`${artbin}/auth/support/recover`, { headers: staleHeaders }),
  );
  expect(recovery.status).toBe(200);
  expect(recovery.headers.get("Referrer-Policy")).toBe("same-origin");
  const recoveryPage = await recovery.text();
  expect(recoveryPage).toContain("Clear support session");
  expect(recoveryPage).toContain(`value="${csrf}"`);
  const exit = (token: string) =>
    router.fetch(
      new Request(`${artbin}/auth/support/exit`, {
        method: "POST",
        headers: {
          ...staleHeaders,
          Origin: artbin,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ csrf: token }),
      }),
    );
  expect((await exit("wrong")).status).toBe(403);
  expect(
    (
      await exitSupportLogin(
        new Request(`${artbin}/auth/support/exit`, {
          method: "POST",
          headers: {
            ...staleHeaders,
            Origin: "https://elsewhere.test",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ csrf: csrf! }),
        }),
      )
    ).status,
  ).toBe(403);
  expect(warning.mock.calls).toEqual([
    ["artbin_support_exit_rejected", "csrf"],
    ["artbin_support_exit_rejected", "origin"],
  ]);
  const cleared = await exit(csrf!);
  expect(cleared.status).toBe(303);
  expect(cleared.headers.get("Location")).toBe("/");
  expect(cleared.headers.get("Set-Cookie")).toContain("artbin_support=;");
  const withoutOwnSession = await router.fetch(
    new Request(`${artbin}/auth/support/exit`, {
      method: "POST",
      headers: {
        Cookie: supportCookie,
        Origin: artbin,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ csrf: csrf! }),
    }),
  );
  expect(withoutOwnSession.status).toBe(303);
  expect(withoutOwnSession.headers.get("Location")).toBe("/auth/login");
  expect(withoutOwnSession.headers.get("Set-Cookie")).toContain(
    "artbin_support=;",
  );
  expect(
    (
      await getUserFromRequest(
        new Request(`${artbin}/folders`, { headers: { Cookie: actorCookie } }),
      )
    )?.id,
  ).toBe("local-actor");
});
