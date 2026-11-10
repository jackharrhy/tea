import { expect, test, mock, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { Elysia } from "elysia";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { runMigrations } from "../../../server/db";
import { authRoutes } from "../../../server/auth/routes";
import type { AuthConfig } from "../../../server/auth/config";

const cfg: AuthConfig = {
  issuerUrl: "http://auth.test",
  burgerUrl: "http://burger.test",
  clientId: "burger",
  projectId: "burger-project",
  isProduction: false,
};

const buildApp = (db: Database) =>
  new Elysia().use(authRoutes({ db, config: cfg }));

beforeEach(() => {
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "http://auth.test/.well-known/openid-configuration") {
      return Response.json({
        issuer: "http://auth.test",
        authorization_endpoint: "http://auth.test/oauth/v2/authorize",
        token_endpoint: "http://auth.test/oauth/v2/token",
        userinfo_endpoint: "http://auth.test/oidc/v1/userinfo",
        revocation_endpoint: "http://auth.test/oauth/v2/revoke",
        jwks_uri: "http://auth.test/oauth/v2/keys",
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as any;
});

test("GET /auth/login sets oauth cookie and redirects to central auth", async () => {
  const db = new Database(":memory:");
  runMigrations(db);
  const app = buildApp(db);
  const res = await app.handle(new Request("http://burger.test/auth/login"));
  expect(res.status).toBe(302);
  const location = res.headers.get("location")!;
  expect(location.startsWith("http://auth.test/oauth/v2/authorize?")).toBe(
    true,
  );
  expect(location).toContain("client_id=burger");
  expect(location).toContain(
    "redirect_uri=http%3A%2F%2Fburger.test%2Fauth%2F4orm%2Fcallback",
  );
  expect(location).toContain("scope=openid+profile");
  expect(location).toContain("burger-project%3Aaud");
  expect(location).toContain("org%3Aprojects%3Aroles");
  expect(location).not.toContain("project%3Arole%3Aadmin");
  expect(location).toContain("code_challenge=");
  expect(location).toContain("code_challenge_method=S256");
  expect(location).toContain("nonce=");
  const setCookie = res.headers.get("set-cookie")!;
  expect(setCookie).toContain("burger_oauth=");
  expect(setCookie).toContain("HttpOnly");
});

test("callback with valid code+state upserts user and creates session", async () => {
  const db = new Database(":memory:");
  runMigrations(db);
  const app = buildApp(db);

  const startRes = await app.handle(
    new Request("http://burger.test/auth/login"),
  );
  const cookieHeader = startRes.headers.get("set-cookie")!;
  const oauthCookieMatch = cookieHeader.match(/burger_oauth=([^;]+)/)!;
  const oauthCookie = oauthCookieMatch[1];
  const state = JSON.parse(decodeURIComponent(oauthCookie!)).state;
  const nonce = JSON.parse(decodeURIComponent(oauthCookie!)).nonce;
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "route-test-key";
  const idToken = await new SignJWT({ nonce })
    .setProtectedHeader({ alg: "RS256", kid: "route-test-key" })
    .setIssuer("http://auth.test")
    .setAudience("burger")
    .setSubject("subject1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

  globalThis.fetch = mock(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://auth.test/.well-known/openid-configuration") {
        return Response.json({
          issuer: "http://auth.test",
          authorization_endpoint: "http://auth.test/oauth/v2/authorize",
          token_endpoint: "http://auth.test/oauth/v2/token",
          userinfo_endpoint: "http://auth.test/oidc/v1/userinfo",
          revocation_endpoint: "http://auth.test/oauth/v2/revoke",
          jwks_uri: "http://auth.test/oauth/v2/keys-route-test",
        });
      }
      if (url === "http://auth.test/oauth/v2/token") {
        return new Response(
          JSON.stringify({
            access_token: "tok",
            token_type: "Bearer",
            expires_in: 3600,
            id_token: idToken,
          }),
        );
      }
      if (url === "http://auth.test/oidc/v1/userinfo") {
        return new Response(
          JSON.stringify({
            sub: "subject1",
            preferred_username: "jack",
            name: "Jack",
            "urn:zitadel:iam:org:project:burger-project:roles": {
              member: { "396722364273983491": "Burger" },
              admin: { "396722364273983491": "Burger" },
            },
          }),
        );
      }
      if (url === "http://auth.test/oauth/v2/keys-route-test") {
        return Response.json({ keys: [jwk] });
      }
      if (url === "http://auth.test/oauth/v2/revoke") {
        expect(init?.method).toBe("POST");
        return new Response(null, { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
  ) as any;

  const callbackRes = await app.handle(
    new Request(
      `http://burger.test/auth/4orm/callback?code=abc&state=${encodeURIComponent(state)}`,
      {
        headers: { Cookie: `burger_oauth=${oauthCookie}` },
      },
    ),
  );

  expect(callbackRes.status).toBe(302);
  expect(callbackRes.headers.get("location")).toBe("/");

  const user = db
    .query("SELECT * FROM users WHERE auth_subject = 'subject1'")
    .get() as any;
  expect(user.fourm_id).toBeNull();
  expect(user.username).toBe("jack");
  expect(user.is_admin).toBe(1);

  const sessionCount = db
    .query("SELECT COUNT(*) as c FROM sessions")
    .get() as any;
  expect(sessionCount.c).toBe(1);
});

test("callback with state mismatch redirects with error", async () => {
  const db = new Database(":memory:");
  runMigrations(db);
  const app = buildApp(db);
  const startRes = await app.handle(
    new Request("http://burger.test/auth/login"),
  );
  const oauthCookie = startRes.headers
    .get("set-cookie")!
    .match(/burger_oauth=([^;]+)/)![1];

  const res = await app.handle(
    new Request("http://burger.test/auth/4orm/callback?code=abc&state=wrong", {
      headers: { Cookie: `burger_oauth=${oauthCookie}` },
    }),
  );
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/?error=state_mismatch");
  expect(res.headers.get("set-cookie")).toContain("burger_oauth=");
  expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
});

test("callback with valid state propagates provider error and clears cookie", async () => {
  const db = new Database(":memory:");
  runMigrations(db);
  const app = buildApp(db);
  const startRes = await app.handle(
    new Request("http://burger.test/auth/login"),
  );
  const oauthCookie = startRes.headers
    .get("set-cookie")!
    .match(/burger_oauth=([^;]+)/)![1];
  const state = JSON.parse(decodeURIComponent(oauthCookie!)).state;
  const res = await app.handle(
    new Request(
      `http://burger.test/auth/4orm/callback?error=access_denied&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: `burger_oauth=${oauthCookie}` } },
    ),
  );
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/?error=access_denied");
  expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
});

test("callback rejects provider error with mismatched state and clears cookie", async () => {
  const db = new Database(":memory:");
  runMigrations(db);
  const app = buildApp(db);
  const startRes = await app.handle(
    new Request("http://burger.test/auth/login"),
  );
  const oauthCookie = startRes.headers
    .get("set-cookie")!
    .match(/burger_oauth=([^;]+)/)![1];
  const res = await app.handle(
    new Request(
      "http://burger.test/auth/4orm/callback?error=access_denied&state=wrong",
      { headers: { Cookie: `burger_oauth=${oauthCookie}` } },
    ),
  );
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/?error=state_mismatch");
  expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
});

test("GET /auth/me with valid session returns user", async () => {
  const db = new Database(":memory:");
  runMigrations(db);
  db.run(
    "INSERT INTO users (id, fourm_id, username, display_name, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ["u1", "fid1", "jack", "Jack", 1, Date.now()],
  );
  db.run("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)", [
    "sess1",
    "u1",
    Date.now() + 1000_000,
  ]);
  const app = buildApp(db);

  const res = await app.handle(
    new Request("http://burger.test/auth/me", {
      headers: { Cookie: "burger_session=sess1" },
    }),
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({
    id: "u1",
    username: "jack",
    displayName: "Jack",
    isAdmin: true,
  });
});

test("GET /auth/me without session returns 401", async () => {
  const db = new Database(":memory:");
  runMigrations(db);
  const app = buildApp(db);
  const res = await app.handle(new Request("http://burger.test/auth/me"));
  expect(res.status).toBe(401);
});

test("POST /auth/logout deletes the session", async () => {
  const db = new Database(":memory:");
  runMigrations(db);
  db.run(
    "INSERT INTO users (id, fourm_id, username, is_admin, created_at) VALUES (?, ?, ?, ?, ?)",
    ["u1", "fid1", "jack", 0, Date.now()],
  );
  db.run("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)", [
    "sess1",
    "u1",
    Date.now() + 1000_000,
  ]);
  const app = buildApp(db);
  const res = await app.handle(
    new Request("http://burger.test/auth/logout", {
      method: "POST",
      headers: { Cookie: "burger_session=sess1" },
    }),
  );
  expect(res.status).toBe(204);
  const remaining = db.query("SELECT COUNT(*) as c FROM sessions").get() as any;
  expect(remaining.c).toBe(0);
});
