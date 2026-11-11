import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

import { createAuthRouter } from "../app/auth-router.ts";
import { getSessionUser } from "../src/auth.ts";
import type { Config } from "../src/config.ts";
import { schema } from "../src/db/index.ts";
import { createTestDb } from "./helpers.ts";
import { seedList } from "./helpers.ts";
import { createCentralBearerAuth } from "../src/services/request-auth.ts";
import { createApplication } from "../src/http-app.ts";
import {
  PROJECT_ROLES_SCOPE,
  projectAudienceScope,
  roleScope,
} from "@harrhy/identity";

test("central sign-in accepts only a reviewed subject with its Lists role", async () => {
  const db = createTestDb();
  const user = db
    .insert(schema.users)
    .values({
      email: "operator@example.test",
      passwordHash: "disabled",
      authSubject: "reviewed-subject",
      role: "owner",
    })
    .returning()
    .get();
  const config: Config = {
    awsRegion: "us-east-1",
    sqsQueueUrl: "https://example.test/queue",
    s3Bucket: "test",
    dbPath: ":memory:",
    fromDomain: "example.test",
    baseUrl: "https://lists.example.test",
    sesConfigSet: "",
    s3MediaBucket: "",
    s3MediaBaseUrl: "",
    ownerEmail: "",
    ownerPassword: "",
    identity: {
      issuer: "https://auth.example.test",
      clientId: "lists-browser",
      projectId: "lists-project",
      organizationId: "our-org",
    },
  };
  const pair = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(pair.publicKey)),
    kid: "signing",
    alg: "RS256",
  };
  let nonce = "";
  let subject = "unknown-subject";
  let role = "admin";
  const fetcher = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("openid-configuration"))
      return Response.json({
        issuer: config.identity!.issuer,
        authorization_endpoint: "https://auth.example.test/authorize",
        token_endpoint: "https://auth.example.test/token",
        userinfo_endpoint: "https://auth.example.test/userinfo",
        jwks_uri: "https://auth.example.test/keys",
        introspection_endpoint: "https://auth.example.test/introspect",
      });
    if (path === "/keys") return Response.json({ keys: [jwk] });
    if (path === "/userinfo")
      return Response.json({
        sub: subject,
        jack_auth_username: "operator",
        jack_auth_principal_type: "user",
        name: "Operator",
        "urn:zitadel:iam:org:project:lists-project:roles": {
          [role]: { "our-org": "auth.example.test" },
        },
      });
    if (path === "/token") {
      const idToken = await new SignJWT({ nonce, azp: "lists-browser" })
        .setProtectedHeader({ alg: "RS256", kid: "signing" })
        .setIssuer("https://auth.example.test")
        .setSubject(subject)
        .setAudience("lists-browser")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(pair.privateKey);
      return Response.json({
        access_token: "test-token",
        id_token: idToken,
        token_type: "Bearer",
        expires_in: 300,
      });
    }
    throw new Error(`Unexpected path: ${path}`);
  }) as typeof fetch;
  const router = createAuthRouter(db, config, fetcher);
  async function signIn() {
    const login = await router.fetch(
      new Request("https://lists.example.test/auth/login"),
    );
    expect(login.status).toBe(303);
    nonce = new URL(login.headers.get("location")!).searchParams.get("nonce")!;
    const state = new URL(login.headers.get("location")!).searchParams.get(
      "state",
    )!;
    return router.fetch(
      new Request(
        `https://lists.example.test/auth/callback?code=test-code&state=${state}`,
        {
          headers: { Cookie: login.headers.get("set-cookie")!.split(";")[0]! },
        },
      ),
    );
  }
  const unknown = await signIn();
  expect(unknown.status).toBe(403);
  expect(db.select().from(schema.sessions).all()).toHaveLength(0);

  subject = "reviewed-subject";
  role = "member";
  const wrongRole = await signIn();
  expect(wrongRole.status).toBe(403);
  expect(db.select().from(schema.sessions).all()).toHaveLength(0);

  role = "admin";
  const accepted = await signIn();
  expect(accepted.status).toBe(303);
  expect(accepted.headers.get("location")).toBe("/admin/");
  const sessionCookie = accepted.headers
    .getSetCookie()
    .find((value) => value.startsWith("session="))!;
  const session = sessionCookie.split(";")[0]!.slice("session=".length);
  expect(getSessionUser(db, session)?.id).toBe(user.id);
  expect(
    db.select().from(schema.users).where(eq(schema.users.id, user.id)).get()
      ?.role,
  ).toBe("owner");
  db.insert(schema.users)
    .values({
      email: "service@example.test",
      passwordHash: "disabled",
      authSubject: "service-subject",
      authPrincipalType: "service",
      authClientId: "service-client",
      role: "member",
    })
    .run();
  subject = "service-subject";
  role = "member";
  expect((await signIn()).status).toBe(403);
  db.insert(schema.users)
    .values({
      email: "member@example.test",
      passwordHash: "disabled",
      authSubject: "human-member",
      role: "member",
    })
    .run();
  subject = "human-member";
  role = "other";
  expect((await signIn()).status).toBe(403);
  role = "member";
  expect((await signIn()).status).toBe(303);
});

test("central bearer auth preserves local list access and rejects wrong audience or role", async () => {
  const db = createTestDb();
  const member = db
    .insert(schema.users)
    .values({
      email: "member@example.test",
      passwordHash: "disabled",
      authSubject: "member-subject",
      role: "member",
    })
    .returning()
    .get();
  const allowed = seedList(db, { slug: "allowed" });
  seedList(db, { slug: "other" });
  db.insert(schema.userLists)
    .values({ userId: member.id, listId: allowed.id })
    .run();
  const config: Config = {
    awsRegion: "us-east-1",
    sqsQueueUrl: "https://example.test/queue",
    s3Bucket: "test",
    dbPath: ":memory:",
    fromDomain: "example.test",
    baseUrl: "https://lists.example.test",
    sesConfigSet: "",
    s3MediaBucket: "",
    s3MediaBaseUrl: "",
    ownerEmail: "",
    ownerPassword: "",
    identity: {
      issuer: "https://auth.example.test",
      clientId: "lists-browser",
      projectId: "lists-project",
      organizationId: "our-org",
    },
    introspectionCredentials: {
      clientId: "resource",
      clientSecret: "test-only",
    },
  };
  let aud = ["lists-project"];
  let role = "member";
  let includeListGrant = true;
  let includeMembershipScope = true;
  let includeExtraGrant = false;
  let subject = "member-subject";
  let clientId = "delegated";
  let principalType: "user" | "service" = "user";
  const fetcher = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("openid-configuration"))
      return Response.json({
        issuer: config.identity!.issuer,
        authorization_endpoint: "https://auth.example.test/authorize",
        token_endpoint: "https://auth.example.test/token",
        userinfo_endpoint: "https://auth.example.test/userinfo",
        jwks_uri: "https://auth.example.test/keys",
        introspection_endpoint: "https://auth.example.test/introspect",
      });
    if (path === "/introspect")
      return Response.json({
        active: true,
        iss: config.identity!.issuer,
        sub: subject,
        client_id: clientId,
        token_type: "Bearer",
        exp: Math.floor(Date.now() / 1000) + 300,
        aud,
        scope: [
          projectAudienceScope("lists-project"),
          PROJECT_ROLES_SCOPE,
          ...(includeMembershipScope ? [roleScope(role)] : []),
          roleScope("lists-read"),
          ...(includeExtraGrant ? [roleScope("templates-write")] : []),
        ].join(" "),
        jack_auth_principal_type: principalType,
        "urn:zitadel:iam:org:project:lists-project:roles": {
          [role]: { "our-org": "auth.example.test" },
          ...(includeListGrant
            ? { "lists-read": { "our-org": "auth.example.test" } }
            : {}),
          ...(includeExtraGrant
            ? { "templates-write": { "our-org": "auth.example.test" } }
            : {}),
        },
      });
    throw new Error(`Unexpected path: ${path}`);
  }) as typeof fetch;
  const authenticate = createCentralBearerAuth(db, config, fetcher);
  const request = new Request("https://lists.example.test/mcp", {
    headers: { Authorization: "Bearer test-token" },
  });
  const principal = await authenticate(request);
  expect(principal.userId).toBe(member.id);
  expect(principal.listIds).toEqual(new Set([allowed.id]));
  expect(principal.scopes).toEqual(new Set(["lists:read"]));
  includeListGrant = false;
  expect((await authenticate(request)).scopes.size).toBe(0);
  includeListGrant = true;
  aud = ["another-project"];
  expect(authenticate(request)).rejects.toMatchObject({ status: 401 });
  aud = ["lists-project"];
  role = "other";
  expect(authenticate(request)).rejects.toMatchObject({ status: 403 });
  role = "member";
  const service = db
    .insert(schema.users)
    .values({
      email: "service@example.test",
      passwordHash: "disabled",
      authSubject: "service-subject",
      authPrincipalType: "service",
      authClientId: "exact-service-client",
      role: "member",
    })
    .returning()
    .get();
  db.insert(schema.userLists)
    .values({ userId: service.id, listId: allowed.id })
    .run();
  subject = "service-subject";
  clientId = "exact-service-client";
  principalType = "service";
  const apiRequest = new Request("https://lists.example.test/api/lists", {
    headers: { Authorization: "Bearer test-token" },
  });
  expect((await authenticate(apiRequest)).listIds).toEqual(
    new Set([allowed.id]),
  );
  includeExtraGrant = true;
  expect((await authenticate(apiRequest)).scopes).toEqual(
    new Set(["lists:read"]),
  );
  includeExtraGrant = false;
  includeMembershipScope = false;
  expect(authenticate(apiRequest)).rejects.toMatchObject({ status: 403 });
  includeMembershipScope = true;
  role = "admin";
  expect(authenticate(apiRequest)).rejects.toMatchObject({ status: 403 });
  role = "member";
  expect(authenticate(request)).rejects.toMatchObject({ status: 403 });
  clientId = "other-service-client";
  expect(authenticate(apiRequest)).rejects.toMatchObject({ status: 403 });
  clientId = "exact-service-client";
  principalType = "user";
  expect(authenticate(apiRequest)).rejects.toMatchObject({ status: 403 });
});

test("central mode removes the standalone OAuth issuer and password login", async () => {
  const db = createTestDb();
  const config: Config = {
    awsRegion: "us-east-1",
    sqsQueueUrl: "https://example.test/queue",
    s3Bucket: "test",
    dbPath: ":memory:",
    fromDomain: "example.test",
    baseUrl: "https://lists.example.test",
    sesConfigSet: "",
    s3MediaBucket: "",
    s3MediaBaseUrl: "",
    ownerEmail: "",
    ownerPassword: "",
    identity: {
      issuer: "https://auth.example.test",
      clientId: "lists-browser",
      projectId: "lists-project",
      organizationId: "our-org",
    },
    introspectionCredentials: {
      clientId: "resource",
      clientSecret: "test-only",
    },
  };
  const app = createApplication(db, config);
  const metadata = await app.request("/.well-known/oauth-protected-resource");
  expect(metadata.status).toBe(200);
  expect((await metadata.json()).authorization_servers).toEqual([
    "https://auth.example.test",
  ]);
  expect(
    (await app.request("/.well-known/oauth-authorization-server")).status,
  ).toBe(404);
  expect(
    (await app.request("/oauth/register", { method: "POST" })).status,
  ).toBe(404);
  expect((await app.request("/admin/login")).headers.get("location")).toBe(
    "/auth/login",
  );
  expect((await app.request("/admin/login", { method: "POST" })).status).toBe(
    404,
  );
});
