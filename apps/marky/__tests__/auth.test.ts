import * as assert from "remix/assert";
import { afterEach, beforeEach, describe, it } from "remix/test";

import { createCookie } from "remix/cookie";
import { createMemorySessionStorage } from "remix/session-storage/memory";

import { loadConfig } from "../app/config.ts";
import { resetRolesCacheForTests } from "../app/data/discord.ts";
import { createRouter } from "../app/router.tsx";

// Build a router AND register it as the active render router so any
// `render(...)` calls (e.g. NotInGuildPage) use this same router instead of
// looking for a process-wide one that doesn't exist in tests.
function buildTestRouter(deps: Parameters<typeof createRouter>[0]) {
  const router = createRouter(deps);
  return router;
}

const VALID_DISCORD_ENV = {
  MARKY_AUTH: "discord",
  DISCORD_CLIENT_ID: "cid",
  DISCORD_CLIENT_SECRET: "csecret",
  DISCORD_GUILD_ID: "gid",
  MARKY_BASE_URL: "http://localhost",
  SESSION_SECRET: "test-secret",
};

// The auth flow is multi-step (sign-in plants a state cookie, callback reads
// it back). Strip everything but `name=value` from a Set-Cookie header so the
// router parses it back as a real Cookie header.
function setCookieHeaderToCookie(setCookie: string): string {
  return setCookie.split(";")[0];
}

// Build the same `Cookie` instance the production server constructs in
// discord mode, so signed cookies round-trip correctly through tests.
function makeSessionCookie(secret: string) {
  return createCookie("marky.session", {
    secrets: [secret],
    httpOnly: true,
    sameSite: "Lax",
    secure: false,
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
}

describe("auth controller", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    resetRolesCacheForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("GET /auth/sign-in redirects to Discord with the right params and stores state", async () => {
    const sessionStorage = createMemorySessionStorage();
    const sessionCookie = makeSessionCookie("test-secret");
    const router = buildTestRouter({
      config: loadConfig(VALID_DISCORD_ENV),
      sessionStorage,
      sessionCookie,
    });

    const response = await router.fetch(
      new Request("http://localhost/auth/sign-in"),
    );
    assert.equal(response.status, 302);
    const location = response.headers.get("location") ?? "";
    assert.match(location, /^https:\/\/discord\.com\/api\/oauth2\/authorize\?/);
    assert.match(location, /client_id=cid/);
    assert.match(location, /scope=identify\+guilds\.members\.read/);
    assert.match(
      location,
      /redirect_uri=http%3A%2F%2Flocalhost%2Fauth%2Fcallback/,
    );
    assert.match(location, /state=[0-9a-f]{64}/);
    // The session cookie should be set so callback can verify state.
    const setCookie = response.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /marky\.session=/);
  });

  it("GET /auth/callback with mismatched state returns 400", async () => {
    const sessionStorage = createMemorySessionStorage();
    const sessionCookie = makeSessionCookie("test-secret");
    const router = buildTestRouter({
      config: loadConfig(VALID_DISCORD_ENV),
      sessionStorage,
      sessionCookie,
    });

    const response = await router.fetch(
      new Request("http://localhost/auth/callback?code=abc&state=wrong"),
    );
    assert.equal(response.status, 400);
  });

  it("GET /auth/callback with not-in-guild renders the gate page (403)", async () => {
    // Stub fetch: token exchange ok, member returns 404.
    globalThis.fetch = (async (input) => {
      const url =
        typeof input === "string" ? input : (input as URL | Request).toString();
      if (url.endsWith("/oauth2/token")) {
        return new Response(
          JSON.stringify({
            access_token: "t",
            token_type: "Bearer",
            expires_in: 100,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/users/@me/guilds/")) {
        return new Response("", { status: 404 });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const sessionStorage = createMemorySessionStorage();
    const sessionCookie = makeSessionCookie("test-secret");
    const router = buildTestRouter({
      config: loadConfig(VALID_DISCORD_ENV),
      sessionStorage,
      sessionCookie,
    });

    // 1. sign-in to plant the state cookie
    const start = await router.fetch(
      new Request("http://localhost/auth/sign-in"),
    );
    const cookieHeader = setCookieHeaderToCookie(
      start.headers.get("set-cookie")!,
    );
    const stateMatch = start.headers
      .get("location")!
      .match(/state=([0-9a-f]{64})/)!;
    const state = stateMatch[1];

    // 2. callback with valid state, member returns 404
    const response = await router.fetch(
      new Request(`http://localhost/auth/callback?code=abc&state=${state}`, {
        headers: { cookie: cookieHeader },
      }),
    );
    assert.equal(response.status, 403);
    const body = await response.text();
    assert.match(body, /not in the right Discord server/i);
  });

  it("GET /auth/callback happy path creates a session and redirects to /", async () => {
    globalThis.fetch = (async (input) => {
      const url =
        typeof input === "string" ? input : (input as URL | Request).toString();
      if (url.endsWith("/oauth2/token")) {
        return new Response(
          JSON.stringify({
            access_token: "t",
            token_type: "Bearer",
            expires_in: 100,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/users/@me/guilds/")) {
        return new Response(
          JSON.stringify({
            nick: "Jacky",
            roles: [],
            user: { id: "1234", username: "jack", global_name: null },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const sessionStorage = createMemorySessionStorage();
    const sessionCookie = makeSessionCookie("test-secret");
    const router = buildTestRouter({
      config: loadConfig(VALID_DISCORD_ENV),
      sessionStorage,
      sessionCookie,
    });

    const start = await router.fetch(
      new Request("http://localhost/auth/sign-in"),
    );
    const cookieHeader = setCookieHeaderToCookie(
      start.headers.get("set-cookie")!,
    );
    const state = start.headers
      .get("location")!
      .match(/state=([0-9a-f]{64})/)![1];

    const response = await router.fetch(
      new Request(`http://localhost/auth/callback?code=abc&state=${state}`, {
        headers: { cookie: cookieHeader },
      }),
    );
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/");
    // A new session cookie should be set after regenerateId.
    const newCookie = response.headers.get("set-cookie") ?? "";
    assert.match(newCookie, /marky\.session=/);
  });

  it("rejects a replayed OAuth state after a successful callback", async () => {
    // Once /auth/callback consumes a state, the second attempt to use it
    // must fail. Otherwise an attacker who captured a victim's redirect URL
    // could replay it to get a fresh session.
    globalThis.fetch = (async (input) => {
      const url =
        typeof input === "string" ? input : (input as URL | Request).toString();
      if (url.endsWith("/oauth2/token")) {
        return new Response(
          JSON.stringify({
            access_token: "t",
            token_type: "Bearer",
            expires_in: 100,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/users/@me/guilds/")) {
        return new Response(
          JSON.stringify({
            nick: "Replay",
            roles: [],
            user: { id: "1234", username: "replay", global_name: null },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const sessionStorage = createMemorySessionStorage();
    const sessionCookie = makeSessionCookie("test-secret");
    const router = buildTestRouter({
      config: loadConfig(VALID_DISCORD_ENV),
      sessionStorage,
      sessionCookie,
    });

    const start = await router.fetch(
      new Request("http://localhost/auth/sign-in"),
    );
    const cookieHeader = setCookieHeaderToCookie(
      start.headers.get("set-cookie")!,
    );
    const state = start.headers
      .get("location")!
      .match(/state=([0-9a-f]{64})/)![1];

    // First callback: succeeds.
    const first = await router.fetch(
      new Request(`http://localhost/auth/callback?code=abc&state=${state}`, {
        headers: { cookie: cookieHeader },
      }),
    );
    assert.equal(first.status, 302);

    // Second callback with the SAME state on the SAME pre-callback cookie:
    // the state has been unset, so this must 400.
    const replay = await router.fetch(
      new Request(`http://localhost/auth/callback?code=abc&state=${state}`, {
        headers: { cookie: cookieHeader },
      }),
    );
    assert.equal(replay.status, 400);
  });

  it("GET / in discord mode renders exactly one sign-out form", async () => {
    const sessionStorage = createMemorySessionStorage();
    const config = loadConfig(VALID_DISCORD_ENV);
    if (config.auth.mode !== "discord") throw new Error("test setup wrong");
    const sessionCookie = makeSessionCookie(config.auth.sessionSecret);
    const router = buildTestRouter({ config, sessionStorage, sessionCookie });

    const signIn = await router.fetch(
      new Request("http://localhost/auth/sign-in"),
    );
    const cookieHeader = setCookieHeaderToCookie(
      signIn.headers.get("set-cookie")!,
    );
    const sessionId = JSON.parse((await sessionCookie.parse(cookieHeader))!)
      .value as string;
    const seed = await sessionStorage.read(sessionId);
    seed.set("identity", { discordId: "1", name: "tester", color: "#abcdef" });
    await sessionStorage.save(seed);

    const response = await router.fetch(
      new Request("http://localhost/", { headers: { cookie: cookieHeader } }),
    );
    assert.equal(response.status, 200);
    const html = await response.text();

    const signOutForms = html.match(/action="\/auth\/sign-out"/g) ?? [];
    assert.equal(
      signOutForms.length,
      1,
      `expected exactly one sign-out form, got ${signOutForms.length}: ${html.slice(0, 500)}`,
    );

    // Also assert there's only one Sign out button label, so a future bug
    // that renders a duplicate button (without a duplicate form) still fails.
    const signOutButtons = html.match(/>Sign out</g) ?? [];
    assert.equal(signOutButtons.length, 1);

    // The user badge has to be SSR'd too, otherwise hydration changes the
    // header tree shape and the reconciler ends up with a duplicate sign-out
    // form. The actual symptom we hit in prod was two buttons in the bar.
    assert.match(
      html,
      /tester/,
      "discord identity should be SSR-rendered in the header",
    );

    // Hydration markers must balance. If they don't, the SSR tree shape
    // differs from what hydration expects and the reconciler can leave
    // orphaned nodes (exactly the bug that produced the duplicate sign-out
    // button). This matches how Remix's own framework regression tests
    // detect that class of bug.
    const hydrationStarts = html.match(/<!--\s*rmx:h:/g)?.length ?? 0;
    const hydrationEnds = html.match(/<!--\s*\/rmx:h\s*-->/g)?.length ?? 0;
    assert.equal(
      hydrationStarts,
      hydrationEnds,
      `hydration markers must balance; got ${hydrationStarts} starts and ${hydrationEnds} ends`,
    );
  });

  it("POST /auth/sign-out unsets identity and redirects to /", async () => {
    const sessionStorage = createMemorySessionStorage();
    const config = loadConfig(VALID_DISCORD_ENV);
    if (config.auth.mode !== "discord") throw new Error("test setup wrong");
    const sessionCookie = makeSessionCookie(config.auth.sessionSecret);
    const router = buildTestRouter({ config, sessionStorage, sessionCookie });

    // Seed a session with an identity directly. We have to construct an
    // equivalent signed cookie ourselves because storage.save returns a raw
    // session ID, not a cookie header.
    const signIn = await router.fetch(
      new Request("http://localhost/auth/sign-in"),
    );
    const cookieHeader = setCookieHeaderToCookie(
      signIn.headers.get("set-cookie")!,
    );
    const sessionId = JSON.parse((await sessionCookie.parse(cookieHeader))!)
      .value as string;
    const seed = await sessionStorage.read(sessionId);
    seed.set("identity", { discordId: "1", name: "a", color: "#000000" });
    await sessionStorage.save(seed);

    const response = await router.fetch(
      new Request("http://localhost/auth/sign-out", {
        method: "POST",
        headers: { cookie: cookieHeader },
      }),
    );
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/");
  });
});
