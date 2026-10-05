import test from "node:test";
import assert from "node:assert/strict";
import { createFourormIdentity } from "../app/auth/fourorm.ts";
import { readConfig } from "../app/config.ts";

const issuer = "https://identity.example";
const resource = "https://shell.example/mcp";
const now = 1_800_000_000_000;
const baseClaims = {
  active: true,
  principal_type: "user",
  sub: "verified-42",
  client_id: "approved-mcp-client",
  scope: "openid newport-shell:execute",
  token_type: "Bearer",
  exp: now / 1000 + 100,
  iat: now / 1000 - 100,
  aud: resource,
};
const baseProfile = { sub: "verified-42", username: "harrhy", is_admin: true };
function fixture(
  claims: Record<string, unknown> = {},
  profile: Record<string, unknown> = {},
  metadata: Record<string, unknown> = {},
  allowedUsernames: string[] = ["harrhy"],
  clock: () => number = () => now,
) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const adapter = createFourormIdentity({
    issuer,
    resource,
    requiredScope: "newport-shell:execute",
    allowedSubjects: ["verified-42"],
    allowedUsernames,
    introspectionClientId: "rs-client",
    introspectionClientSecret: "fixture-secret",
    now: clock,
    fetch: async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes(".well-known"))
        return Response.json({
          issuer,
          introspection_endpoint: `${issuer}/oauth/introspect`,
          userinfo_endpoint: `${issuer}/oauth/userinfo`,
          ...metadata,
        });
      if (url.endsWith("/introspect"))
        return Response.json({ ...baseClaims, ...claims });
      if (url.endsWith("/userinfo"))
        return Response.json({ ...baseProfile, ...profile });
      throw new Error("Unexpected endpoint");
    },
  });
  return { adapter, requests };
}
test("accepts a different explicitly enrolled admin", async () => {
  const { adapter } = fixture({}, { username: "alice" }, {}, ["alice"]);
  assert.equal(
    (await (await adapter).verify("opaque-token")).username,
    "alice",
  );
});
test("accepts a single exact audience in array form", async () => {
  const { adapter } = fixture({ aud: [resource] });
  assert.equal(
    (await (await adapter).verify("opaque-token")).subject,
    "verified-42",
  );
});
test("authorizes only linked authoritative identity; same token goes to both endpoints", async () => {
  const { adapter, requests } = fixture();
  const identity = await (await adapter).verify("opaque-fixture-token");
  assert.deepEqual(identity, {
    issuer,
    subject: "verified-42",
    username: "harrhy",
    admin: true,
    expiresAt: now + 100_000,
  });
  assert.equal(
    requests[2].init?.body?.toString(),
    "token=opaque-fixture-token&token_type_hint=access_token",
  );
  assert.equal(
    new Headers(requests[3].init?.headers).get("authorization"),
    "Bearer opaque-fixture-token",
  );
  assert.equal(
    new Headers(requests[2].init?.headers).get("authorization"),
    `Basic ${Buffer.from("rs-client:fixture-secret").toString("base64")}`,
  );
  assert.ok(requests.every((request) => request.init?.redirect === "error"));
});
for (const claims of [
  { active: false },
  { active: "true" },
  { principal_type: "service" },
  { sub: "other" },
  { sub: "" },
  { aud: "https://other.example/mcp" },
  { aud: undefined },
  { aud: [resource, "https://other.example"] },
  { scope: "newport-shell:execute" },
  { scope: "openid worldview:admin" },
  { scope: "" },
  { exp: now / 1000 },
  { exp: "1900000000" },
  { exp: undefined },
  { iat: now / 1000 + 100 },
  { iat: now / 1000 + 100, exp: now / 1000 + 100 },
  { exp: now / 1000 + 0.5 },
  { token_type: "Basic" },
  { client_id: "" },
  { iss: "https://attacker.example" },
])
  test(`rejects unsafe introspection ${JSON.stringify(claims)}`, async () => {
    const { adapter, requests } = fixture(claims);
    await assert.rejects((await adapter).verify("opaque-token"));
    assert.equal(
      requests.some((r) => r.url.endsWith("/userinfo")),
      false,
    );
  });
for (const profile of [
  { username: "Harrhy" },
  { username: " harrhy" },
  { username: "harrhy-other" },
  { username: undefined },
  { is_admin: false },
  { is_admin: "true" },
  { is_admin: 1 },
  { is_admin: undefined },
  { sub: "other" },
  { sub: undefined },
])
  test(`rejects unsafe userinfo ${JSON.stringify(profile)}`, async () => {
    await assert.rejects(
      (await fixture({}, profile).adapter).verify("opaque-token"),
    );
  });
test("rejects a token that expires while userinfo is fetched", async () => {
  let reads = 0;
  const clock = () => now + (reads++ === 0 ? 0 : 101_000);
  const { adapter } = fixture({}, {}, {}, ["harrhy"], clock);
  await assert.rejects((await adapter).verify("opaque-token"));
});
test("metadata issuer/credential endpoint must remain pinned", async () => {
  await assert.rejects(
    fixture({}, {}, { issuer: "https://other.example" }).adapter,
  );
  await assert.rejects(
    fixture(
      {},
      {},
      { introspection_endpoint: "https://other.example/introspect" },
    ).adapter,
  );
  await assert.rejects(
    fixture({}, {}, { userinfo_endpoint: "http://identity.example/userinfo" })
      .adapter,
  );
  await assert.rejects(
    fixture(
      {},
      {},
      { introspection_endpoint_auth_methods_supported: ["client_secret_post"] },
    ).adapter,
  );
});
test("missing verified subject refuses configuration", async () => {
  await assert.rejects(
    createFourormIdentity({
      issuer,
      resource,
      requiredScope: "newport-shell:execute",
      allowedSubjects: [],
      allowedUsernames: ["harrhy"],
      introspectionClientId: "x",
      introspectionClientSecret: "x",
    }),
  );
});
test("network errors, non-JSON, redirects, and oversized responses fail closed", async () => {
  for (const response of [
    null,
    new Response("bad"),
    Response.redirect("https://other.example", 302),
    Response.json({ padding: "x".repeat(40_000) }),
  ]) {
    await assert.rejects(
      createFourormIdentity({
        issuer,
        resource,
        requiredScope: "newport-shell:execute",
        allowedSubjects: ["verified-42"],
        allowedUsernames: ["harrhy"],
        introspectionClientId: "x",
        introspectionClientSecret: "x",
        fetch: async () => {
          if (!response) throw new Error("offline");
          return response;
        },
      }),
    );
  }
});
test("defaults locked; demo cannot bind public interface; real mode needs provisioning", () => {
  assert.equal(readConfig({}).mode, "locked");
  assert.throws(() => readConfig({ SHELL_MODE: "demo", HOST: "0.0.0.0" }));
  assert.throws(() =>
    readConfig({
      SHELL_MODE: "fourorm",
      PUBLIC_ORIGIN: "https://shell.example",
    }),
  );
});
