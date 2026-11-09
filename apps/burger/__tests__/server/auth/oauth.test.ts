import { expect, test, mock } from "bun:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  exchangeCode,
  fetchUserinfo,
  parseUserinfo,
  discoverProvider,
  verifyIdToken,
  revokeAccessToken,
} from "../../../server/auth/oauth";

test("generateCodeVerifier returns base64url string", () => {
  const v = generateCodeVerifier();
  expect(typeof v).toBe("string");
  expect(v.length).toBeGreaterThanOrEqual(43);
  expect(/^[A-Za-z0-9_-]+$/.test(v)).toBe(true);
});

test("generateCodeChallenge produces deterministic sha256 base64url", () => {
  // Known: SHA256("hello") base64url = "LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ"
  const challenge = generateCodeChallenge("hello");
  expect(challenge).toBe("LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ");
});

test("exchangeCode posts to token endpoint with PKCE verifier", async () => {
  const fetchMock = mock(async (url: string, init: RequestInit) => {
    expect(url).toBe("http://example.test/oauth/token");
    const body = init.body as string;
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("code=abc");
    expect(body).toContain("code_verifier=verifier123");
    return new Response(
      JSON.stringify({
        access_token: "tok",
        token_type: "Bearer",
        expires_in: 3600,
        id_token: "id-token",
      }),
    );
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  const result = await exchangeCode({
    code: "abc",
    codeVerifier: "verifier123",
    redirectUri: "http://burger/auth/4orm/callback",
    tokenUrl: "http://example.test/oauth/token",
    clientId: "burger",
  });

  expect(result.access_token).toBe("tok");
});

test("fetchUserinfo passes bearer token", async () => {
  const fetchMock = mock(async (url: string, init: RequestInit) => {
    expect(url).toBe("http://example.test/oauth/userinfo");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok",
    );
    return new Response(
      JSON.stringify({
        sub: "user1",
        preferred_username: "jack",
        name: "Jack",
      }),
    );
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  const info = await fetchUserinfo({
    accessToken: "tok",
    userinfoUrl: "http://example.test/oauth/userinfo",
  });

  expect(info.sub).toBe("user1");
  expect(info.preferred_username).toBe("jack");
});

test("parseUserinfo derives profile and admin from Burger project roles", () => {
  const identity = parseUserinfo(
    {
      sub: "subject1",
      preferred_username: "jack",
      name: "Jack",
      "urn:zitadel:iam:org:project:burger-project:roles": {
        member: { "org-id": "Burger" },
        admin: { "org-id": "Burger" },
      },
    },
    "burger-project",
    "org-id",
  );
  expect(identity).toEqual({
    subject: "subject1",
    username: "jack",
    displayName: "Jack",
    isAdmin: true,
  });
});

test("parseUserinfo rejects an identity without Burger membership", () => {
  expect(() =>
    parseUserinfo(
      {
        sub: "subject1",
        preferred_username: "jack",
      },
      "burger-project",
      "org-id",
    ),
  ).toThrow("missing Burger membership");
});

test("parseUserinfo accepts a central-only Burger member", () => {
  expect(
    parseUserinfo(
      {
        sub: "subject1",
        preferred_username: "jack",
        "urn:zitadel:iam:org:project:burger-project:roles": {
          member: { "org-id": "Burger" },
        },
      },
      "burger-project",
      "org-id",
    ),
  ).toEqual({
    subject: "subject1",
    username: "jack",
    displayName: null,
    isAdmin: false,
  });
});

test("parseUserinfo rejects array roles and roles from another organization", () => {
  for (const roles of [
    ["member", "admin"],
    { member: { other: "Other" }, admin: { other: "Other" } },
  ]) {
    expect(() =>
      parseUserinfo(
        {
          sub: "subject1",
          preferred_username: "jack",
          "urn:zitadel:iam:org:project:burger-project:roles": roles,
        },
        "burger-project",
        "org-id",
      ),
    ).toThrow("missing Burger membership");
  }
});

test("parseUserinfo binds UserInfo to the verified ID token subject", () => {
  expect(() =>
    parseUserinfo(
      {
        sub: "userinfo-subject",
        preferred_username: "jack",
        "urn:zitadel:iam:org:project:burger-project:roles": {
          member: { "org-id": "Burger" },
        },
      },
      "burger-project",
      "org-id",
      "id-token-subject",
    ),
  ).toThrow("does not match");
});

test("discoverProvider accepts only same-issuer endpoints", async () => {
  globalThis.fetch = mock(async () =>
    Response.json({
      issuer: "https://auth.test",
      authorization_endpoint: "https://auth.test/oauth/v2/authorize",
      token_endpoint: "https://auth.test/oauth/v2/token",
      userinfo_endpoint: "https://auth.test/oidc/v1/userinfo",
      revocation_endpoint: "https://auth.test/oauth/v2/revoke",
      jwks_uri: "https://auth.test/oauth/v2/keys",
    }),
  ) as unknown as typeof fetch;
  expect((await discoverProvider("https://auth.test")).issuer).toBe(
    "https://auth.test",
  );

  globalThis.fetch = mock(async () =>
    Response.json({
      issuer: "https://auth.test",
      authorization_endpoint: "https://attacker.test/authorize",
      token_endpoint: "https://auth.test/token",
      userinfo_endpoint: "https://auth.test/userinfo",
      revocation_endpoint: "https://auth.test/revoke",
      jwks_uri: "https://auth.test/keys",
    }),
  ) as unknown as typeof fetch;
  expect(discoverProvider("https://auth.test")).rejects.toThrow(
    "outside the configured issuer",
  );
});

test("verifyIdToken verifies signature, issuer, audience, nonce, and subject", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  globalThis.fetch = mock(async () =>
    Response.json({ keys: [jwk] }),
  ) as unknown as typeof fetch;
  const token = await new SignJWT({ nonce: "nonce" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer("https://auth.test")
    .setAudience("burger")
    .setSubject("subject1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

  expect(
    await verifyIdToken({
      idToken: token,
      issuer: "https://auth.test",
      clientId: "burger",
      nonce: "nonce",
      jwksUri: "https://auth.test/keys-verify-test",
    }),
  ).toBe("subject1");
  expect(
    verifyIdToken({
      idToken: token,
      issuer: "https://auth.test",
      clientId: "burger",
      nonce: "wrong-nonce",
      jwksUri: "https://auth.test/keys-verify-test-wrong-nonce",
    }),
  ).rejects.toThrow("binding failed");
});

test("revokeAccessToken sends the public client ID", async () => {
  globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
    const body = new URLSearchParams(init.body as string);
    expect(body.get("token")).toBe("token");
    expect(body.get("client_id")).toBe("burger");
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  await revokeAccessToken({
    accessToken: "token",
    revocationUrl: "https://auth.test/revoke",
    clientId: "burger",
  });
});

test("exchangeCode throws on non-2xx", async () => {
  const fetchMock = mock(async () => new Response("bad", { status: 400 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  expect(
    exchangeCode({
      code: "abc",
      codeVerifier: "v",
      redirectUri: "x",
      tokenUrl: "http://example.test/oauth/token",
      clientId: "burger",
    }),
  ).rejects.toThrow();
});
