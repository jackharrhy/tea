import { describe, expect, test } from "bun:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createAuth } from "../../server/auth";

const issuer = "https://identity.test";
const origin = "https://hall.test";
const env = {
  AUTH_ISSUER: issuer,
  AUTH_CLIENT_ID: "hall",
  PUBLIC_ORIGIN: origin,
  OWNER_SUBJECT: "owner-subject",
};
const keys = await generateKeyPair("RS256");
const jwk = {
  ...(await exportJWK(keys.publicKey)),
  kid: "fixture",
  alg: "RS256",
  use: "sig",
};
function request(path: string, cookie?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  return new Request(origin + path, { ...init, headers });
}
function responseCookie(response: Response, name: string) {
  return response.headers
    .getSetCookie()
    .find((item) => item.startsWith(name + "="))!
    .split(";")[0]!;
}
async function fixture(
  claims: Record<string, unknown> = {},
  signingKey = keys.privateKey,
  options: { tokenResponse?: unknown } = {},
) {
  let nonce = "";
  let challenge = "";
  let tokenCalls = 0;
  const fetcher = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    if (url.endsWith("openid-configuration"))
      return Response.json({
        issuer,
        authorization_endpoint: issuer + "/authorize",
        token_endpoint: issuer + "/token",
        jwks_uri: issuer + "/keys",
      });
    if (url.endsWith("/keys")) return Response.json({ keys: [jwk] });
    if (url.endsWith("/token")) {
      tokenCalls++;
      if ("tokenResponse" in options)
        return Response.json(options.tokenResponse);
      const body = init!.body as URLSearchParams;
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(body.get("code_verifier")!),
      );
      expect(Buffer.from(digest).toString("base64url")).toBe(challenge);
      expect(body.get("redirect_uri")).toBe(origin + "/auth/callback");
      const jwt = await new SignJWT({ nonce, name: "Owner", ...claims })
        .setProtectedHeader({ alg: "RS256", kid: "fixture" })
        .setIssuer(typeof claims.iss === "string" ? claims.iss : issuer)
        .setSubject(
          typeof claims.sub === "string" ? claims.sub : "owner-subject",
        )
        .setAudience(typeof claims.aud === "string" ? claims.aud : "hall")
        .setIssuedAt()
        .setExpirationTime(typeof claims.exp === "number" ? claims.exp : "5m")
        .sign(signingKey);
      return Response.json({ id_token: jwt });
    }
    throw new Error("Unexpected provider request");
  }) as typeof fetch;
  const auth = createAuth(env, fetcher);
  const login = (await auth.handle(request("/auth/login")))!;
  const target = new URL(login.headers.get("location")!);
  nonce = target.searchParams.get("nonce")!;
  challenge = target.searchParams.get("code_challenge")!;
  expect(target.searchParams.get("code_challenge_method")).toBe("S256");
  const cookie = responseCookie(login, "__Host-8ball-login");
  const callback =
    "/auth/callback?code=fixture&state=" + target.searchParams.get("state");
  return { auth, cookie, callback, login, tokenCalls: () => tokenCalls };
}

describe("local OIDC sessions", () => {
  test("disabled sign-in leaves guests unauthenticated", async () => {
    const auth = createAuth({});
    expect(await auth.session(request("/"))).toBeNull();
    expect(await (await auth.handle(request("/api/account")))!.json()).toEqual({
      enabled: false,
      authenticated: false,
      name: null,
      owner: false,
      csrf: null,
    });
    expect((await auth.handle(request("/auth/login")))!.status).toBe(503);
    expect(await auth.handle(request("/other"))).toBeNull();
  });
  test("verified owner, private cookies, one-use callback and local CSRF logout", async () => {
    const f = await fixture();
    const response = (await f.auth.handle(request(f.callback, f.cookie)))!;
    expect(response.status).toBe(303);
    const cookie = responseCookie(response, "__Host-8ball-session");
    expect(response.headers.getSetCookie().join(" ")).toContain(
      "HttpOnly; Secure; SameSite=Lax",
    );
    const session = (await f.auth.session(request("/", cookie)))!;
    expect(session.subject).toBe("owner-subject");
    expect(session.owner).toBe(true);
    expect(Object.isFrozen(session)).toBe(true);
    expect((await f.auth.handle(request(f.callback, f.cookie)))!.status).toBe(
      400,
    );
    expect(f.tokenCalls()).toBe(1);
    for (const [originHeader, csrf] of [
      [origin, "wrong"],
      ["https://evil.test", session.csrf],
      [origin, session.csrf],
    ]) {
      const result = (await f.auth.handle(
        request("/auth/logout", cookie, {
          method: "POST",
          headers: { origin: originHeader!, "x-csrf-token": csrf! },
        }),
      ))!;
      expect(result.status).toBe(
        csrf === session.csrf && originHeader === origin ? 200 : 403,
      );
    }
    expect(await f.auth.session(request("/", cookie))).toBeNull();
    expect(f.tokenCalls()).toBe(1);
  });
  test("state is browser-bound and consumed before exchange", async () => {
    const f = await fixture();
    expect((await f.auth.handle(request(f.callback)))!.status).toBe(400);
    expect(
      (await f.auth.handle(
        request("/auth/callback?code=x&state=wrong", f.cookie),
      ))!.status,
    ).toBe(400);
    expect((await f.auth.handle(request(f.callback, f.cookie)))!.status).toBe(
      400,
    );
    expect(f.tokenCalls()).toBe(0);
  });
  for (const claims of [
    { nonce: "wrong" },
    { aud: "other" },
    { iss: "https://evil.test" },
    { exp: 1 },
    { azp: "other" },
  ]) {
    test("rejects invalid claims " + JSON.stringify(claims), async () => {
      const f = await fixture(claims);
      const response = (await f.auth.handle(request(f.callback, f.cookie)))!;
      expect(response.status).toBe(400);
      expect(response.headers.getSetCookie().join(" ")).not.toContain(
        "__Host-8ball-session=",
      );
    });
  }
  test("rejects a token signed by an unknown key", async () => {
    const other = await generateKeyPair("RS256");
    const f = await fixture({}, other.privateKey);
    expect((await f.auth.handle(request(f.callback, f.cookie)))!.status).toBe(
      400,
    );
  });
  test("matching display name never grants ownership", async () => {
    const f = await fixture({ sub: "someone-else", name: "Owner" });
    const response = (await f.auth.handle(request(f.callback, f.cookie)))!;
    const session = await f.auth.session(
      request("/", responseCookie(response, "__Host-8ball-session")),
    );
    expect(session?.owner).toBe(false);
  });
  test("expired local sessions and login transactions are rejected", async () => {
    const f = await fixture();
    const response = (await f.auth.handle(request(f.callback, f.cookie)))!;
    const cookie = responseCookie(response, "__Host-8ball-session");
    const pending = await fixture();
    const now = Date.now;
    try {
      const future = now() + 31 * 60_000;
      Date.now = () => future;
      expect(await f.auth.session(request("/", cookie))).toBeNull();
      expect(
        (await pending.auth.handle(request(pending.callback, pending.cookie)))!
          .status,
      ).toBe(400);
      expect(pending.tokenCalls()).toBe(0);
    } finally {
      Date.now = now;
    }
  });
  test("invalid configuration disables sign-in without provider requests", async () => {
    for (const config of [
      { ...env, AUTH_ISSUER: "http://identity.test" },
      { ...env, PUBLIC_ORIGIN: "http://hall.test" },
      { ...env, AUTH_CLIENT_ID: "" },
    ]) {
      const auth = createAuth(config, (() => {
        throw new Error("Must not fetch");
      }) as unknown as typeof fetch);
      expect((await auth.handle(request("/auth/login")))!.status).toBe(503);
      expect(await auth.session(request("/"))).toBeNull();
    }
  });
  test("discovery rejects substituted issuers and unsafe endpoints", async () => {
    const discovery = {
      issuer,
      authorization_endpoint: issuer + "/authorize",
      token_endpoint: issuer + "/token",
      jwks_uri: issuer + "/keys",
      extra_provider_metadata: true,
    };
    for (const patch of [
      { issuer: "https://evil.test" },
      { token_endpoint: "https://evil.test/token" },
      { authorization_endpoint: "http://identity.test/authorize" },
      { jwks_uri: "https://user:password@identity.test/keys" },
      { token_endpoint: issuer + "/token#fragment" },
      { jwks_uri: null },
    ]) {
      let calls = 0;
      const auth = createAuth(env, (async () => {
        calls++;
        return Response.json({ ...discovery, ...patch });
      }) as unknown as typeof fetch);
      expect((await auth.handle(request("/auth/login")))!.status).toBe(400);
      expect(calls).toBe(1);
    }
  });
  test("provider JSON remains byte bounded before schema parsing", async () => {
    let cancelled = false;
    const auth = createAuth(
      env,
      (async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(262_145));
            },
            cancel() {
              cancelled = true;
            },
          }),
        )) as unknown as typeof fetch,
    );
    expect((await auth.handle(request("/auth/login")))!.status).toBe(400);
    expect(cancelled).toBe(true);
  });
  test("invalid token response shapes never establish a session", async () => {
    for (const tokenResponse of [
      null,
      [],
      {},
      { id_token: 42 },
      { id_token: "" },
    ]) {
      const f = await fixture({}, keys.privateKey, { tokenResponse });
      const response = (await f.auth.handle(request(f.callback, f.cookie)))!;
      expect(response.status).toBe(400);
      expect(response.headers.getSetCookie().join(" ")).not.toContain(
        "__Host-8ball-session=",
      );
    }
  });
  test("guest cannot submit logout", async () => {
    expect(
      (await createAuth(env).handle(
        request("/auth/logout", undefined, {
          method: "POST",
          headers: { origin, "x-csrf-token": "guest" },
        }),
      ))!.status,
    ).toBe(403);
  });
});
