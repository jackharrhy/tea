import assert from "node:assert/strict";
import test from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  createIdentityClient,
  createLoginTransaction,
  validLoginTransaction,
  projectAudienceScope,
  PROJECT_ROLES_SCOPE,
  roleScope,
  requireTokenRole,
} from "../src/index.ts";

const config = {
  issuer: "https://auth.example",
  clientId: "browser",
  projectId: "artbin-project",
  organizationId: "our-org",
};
const pair = await generateKeyPair("RS256");
const jwk = {
  ...(await exportJWK(pair.publicKey)),
  kid: "signing-key",
  alg: "RS256",
};
const transaction = createLoginTransaction();
const discovery = {
  issuer: config.issuer,
  authorization_endpoint: config.issuer + "/authorize",
  token_endpoint: config.issuer + "/token",
  userinfo_endpoint: config.issuer + "/userinfo",
  jwks_uri: config.issuer + "/keys",
  introspection_endpoint: config.issuer + "/introspect",
};
const granted = {
  "urn:zitadel:iam:org:project:artbin-project:roles": {
    admin: { "our-org": "auth.example" },
  },
};
const profile = {
  sub: "central-id",
  jack_auth_username: "jack",
  jack_auth_principal_type: "user",
  name: "Jack",
  ...granted,
};
async function signed(
  changes: Record<string, unknown> = {},
  key = pair.privateKey,
) {
  return new SignJWT({
    nonce: transaction.nonce,
    azp: config.clientId,
    ...changes,
  })
    .setProtectedHeader({ alg: "RS256", kid: "signing-key" })
    .setIssuer(typeof changes.iss === "string" ? changes.iss : config.issuer)
    .setSubject("central-id")
    .setAudience(
      typeof changes.aud === "string" ? changes.aud : config.clientId,
    )
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}
function fixture(
  idToken: string,
  userinfo: unknown = profile,
  metadata: unknown = discovery,
) {
  const calls: { url: string; options?: RequestInit }[] = [];
  const fetcher = (async (input, options) => {
    const url = String(input);
    calls.push({ url, options });
    if (url.endsWith("openid-configuration")) return Response.json(metadata);
    if (url.endsWith("/token"))
      return Response.json({
        access_token: "a".repeat(2500),
        id_token: idToken,
        token_type: "Bearer",
        expires_in: 1800,
      });
    if (url.endsWith("/keys")) return Response.json({ keys: [jwk] });
    if (url.endsWith("/userinfo")) return Response.json(userinfo);
    throw new Error("Unexpected endpoint");
  }) as typeof fetch;
  return { client: createIdentityClient(config, fetcher), calls };
}
test("code flow sends PKCE and nonce, verifies a signed identity and uses scoped app roles", async () => {
  const { client, calls } = fixture(await signed());
  const url = new URL(
    await client.authorizationUrl(
      transaction,
      "https://artbin.example/callback",
    ),
  );
  assert.equal(url.searchParams.get("nonce"), transaction.nonce);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(
    url.searchParams
      .get("scope")!
      .includes(projectAudienceScope(config.projectId)),
  );
  assert.ok(url.searchParams.get("scope")!.includes(PROJECT_ROLES_SCOPE));
  const person = await client.exchange(
    "code",
    transaction,
    "https://artbin.example/callback",
  );
  assert.equal(person.subject, "central-id");
  assert.equal(person.username, "jack");
  assert.deepEqual([...person.roles], ["admin"]);
  const token = calls.find((call) => call.url.endsWith("/token"))!;
  assert.equal(
    new URLSearchParams(token.options!.body as URLSearchParams).get(
      "code_verifier",
    ),
    transaction.verifier,
  );
  assert.ok(calls.every((call) => call.options?.redirect === "error"));
});
test("wrong nonce, issuer, audience, authorized party and signing key cannot create a session", async () => {
  const other = await generateKeyPair("RS256");
  for (const token of [
    await signed({ nonce: "wrong" }),
    await signed({ iss: "https://elsewhere.example" }),
    await signed({ aud: "different" }),
    await signed({ azp: "different" }),
    await signed({}, other.privateKey),
  ]) {
    const { client, calls } = fixture(token);
    await assert.rejects(
      client.exchange("code", transaction, "https://artbin.example/callback"),
      { status: 401 },
    );
    assert.ok(!calls.some((call) => call.url.endsWith("/userinfo")));
  }
});
test("userinfo cannot swap identities or borrow roles from another organization or project", async () => {
  for (const changed of [
    { ...profile, sub: "other" },
    { ...profile, jack_auth_principal_type: "service" },
    {
      ...profile,
      "urn:zitadel:iam:org:project:artbin-project:roles": {
        admin: { "other-org": "elsewhere" },
      },
    },
    {
      ...profile,
      "urn:zitadel:iam:org:project:artbin-project:roles": {},
      "urn:zitadel:iam:org:project:other:roles": {
        admin: { "our-org": "auth.example" },
      },
    },
  ]) {
    const { client } = fixture(await signed(), changed);
    await assert.rejects(
      client.exchange("code", transaction, "https://artbin.example/callback"),
    );
  }
});
test("discovery cannot redirect credentials to an endpoint outside the configured issuer", async () => {
  const { client, calls } = fixture(await signed(), profile, {
    ...discovery,
    token_endpoint: "https://attacker.example/token",
  });
  await assert.rejects(
    client.exchange("code", transaction, "https://artbin.example/callback"),
    { status: 503 },
  );
  assert.equal(calls.length, 1);
});
test("login transactions expire and must match browser state", () => {
  assert.ok(validLoginTransaction(transaction, transaction.state));
  assert.equal(validLoginTransaction(transaction, "different"), false);
  assert.equal(
    validLoginTransaction({ ...transaction, createdAt: 1 }, transaction.state),
    false,
  );
  assert.equal(
    validLoginTransaction(
      { ...transaction, verifier: "short" },
      transaction.state,
    ),
    false,
  );
});
test("API tokens need active proof, exact issuer, project audience, scoped roles and expiry", async () => {
  const now = Math.floor(Date.now() / 1000);
  let payload: Record<string, unknown> = {
    active: true,
    iss: config.issuer,
    sub: "machine-id",
    client_id: "machine-client",
    token_type: "Bearer",
    exp: now + 300,
    aud: [config.projectId],
    scope: `${projectAudienceScope(config.projectId)} ${PROJECT_ROLES_SCOPE} ${roleScope("assets-read")}`,
    jack_auth_principal_type: "service",
    "urn:zitadel:iam:org:project:artbin-project:roles": {
      "assets-read": { "our-org": "auth.example" },
    },
  };
  const fetcher = (async (input, options) => {
    assert.equal(options?.redirect, "error");
    return Response.json(
      String(input).endsWith("openid-configuration") ? discovery : payload,
    );
  }) as typeof fetch;
  const client = createIdentityClient(config, fetcher);
  const credentials = { clientId: "api", clientSecret: "secret" };
  const value = await client.introspect("token", credentials);
  assert.equal(value.principalType, "service");
  assert.ok(value.roles.has("assets-read"));
  const original = payload;
  for (const invalid of [
    { active: false },
    { iss: "https://other.example" },
    { aud: ["maps-project"] },
    { exp: now - 1 },
    { jack_auth_principal_type: undefined },
  ]) {
    payload = { ...original, ...invalid };
    await assert.rejects(client.introspect("token", credentials), {
      status: 401,
    });
  }
});

test("resource permission requires both its granted role and explicitly requested scope", () => {
  const principal = {
    subject: "user",
    clientId: "mcp-client",
    principalType: "user" as const,
    expiresAt: Math.floor(Date.now() / 1000) + 300,
    audiences: new Set([config.projectId]),
    roles: new Set(["admin"]),
    scopes: new Set([
      projectAudienceScope(config.projectId),
      PROJECT_ROLES_SCOPE,
    ]),
  };
  assert.throws(() => requireTokenRole(principal, config.projectId, "admin"), {
    status: 403,
  });
  principal.scopes.add(roleScope("admin"));
  requireTokenRole(principal, config.projectId, "admin");
  assert.throws(() => requireTokenRole(principal, "other-project", "admin"), {
    status: 401,
  });
  principal.roles.clear();
  assert.throws(() => requireTokenRole(principal, config.projectId, "admin"), {
    status: 403,
  });
});
