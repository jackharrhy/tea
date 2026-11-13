import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  authorizationPolicy,
  isAuthorizationPath,
} from "../src/oidc-policy.mjs";

const apps = [
  { id: "fourm", pkceClientIds: ["fourm-native"] },
  { id: "artbin", projectId: "artbin", delegatedRoles: ["admin"] },
];
const valid = {
  client_id: "fourm-native",
  response_type: "code",
  scope: "openid",
  code_challenge: "a".repeat(43),
  code_challenge_method: "S256",
};
const uri = (values) => "/oauth/v2/authorize?" + new URLSearchParams(values);
const allowed = (url, body = new URLSearchParams(), method = "GET") =>
  authorizationPolicy(url, method, body, apps).allowed;

test("registered migrating public clients require PKCE without audience or role scopes", () => {
  const registry = JSON.parse(
    readFileSync(new URL("../config/applications.json", import.meta.url)),
  );
  for (const id of [
    "fourm",
    "artbin",
    "maps",
    "burger",
    "lists",
    "ref",
    "navidrome",
  ]) {
    const app = registry.find((item) => item.id === id);
    for (const client of app.clientIds) {
      assert.equal(
        authorizationPolicy(
          uri({
            client_id: client,
            response_type: "code",
            scope: "openid profile",
          }),
          "GET",
          new URLSearchParams(),
          registry,
        ).allowed,
        false,
        `${id} missing challenge`,
      );
      assert.equal(
        authorizationPolicy(
          uri({ ...valid, client_id: client, scope: "openid profile" }),
          "GET",
          new URLSearchParams(),
          registry,
        ).allowed,
        true,
        `${id} valid challenge`,
      );
    }
  }
});

test("protected public clients and MCP audiences require exactly one S256 challenge", () => {
  assert.ok(allowed(uri(valid)));
  for (const changed of [
    { code_challenge: "" },
    { code_challenge_method: "plain" },
    { code_challenge: "short" },
    { response_type: "id_token" },
  ])
    assert.equal(allowed(uri({ ...valid, ...changed })), false);
  assert.equal(allowed(uri(valid) + "&code_challenge="), false);
  assert.equal(allowed(uri(valid) + "&client_id=unrelated"), false);
  const delegated = {
    ...valid,
    client_id: "dynamic-client",
    scope: "openid urn:zitadel:iam:org:project:id:artbin:aud",
  };
  assert.ok(allowed(uri(delegated)));
  assert.equal(allowed(uri({ ...delegated, code_challenge: "" })), false);
  assert.ok(
    allowed(
      uri({
        client_id: "existing-unrelated-confidential",
        response_type: "code",
      }),
    ),
  );
});

test("form parameters, request objects and encoded paths cannot bypass scoped PKCE enforcement", () => {
  assert.ok(allowed("/oauth/v2/authorize", new URLSearchParams(valid), "POST"));
  assert.equal(
    allowed(uri(valid), new URLSearchParams({ code_challenge: "" }), "POST"),
    false,
  );
  assert.equal(
    allowed(uri({ ...valid, request_uri: "urn:opaque:request" })),
    false,
  );
  const request =
    "header." +
    Buffer.from(JSON.stringify({ client_id: "fourm-native" })).toString(
      "base64url",
    ) +
    ".signature";
  assert.equal(allowed(uri({ client_id: "unrelated", request })), false);
  for (const path of [
    "/oauth/v2/%61uthorize",
    "/oauth%2Fv2%2Fauthorize",
    "/oauth//v2/authorize",
    "/oauth/v2/authorize/",
  ]) {
    assert.ok(isAuthorizationPath(path));
    assert.equal(
      allowed(path + "?client_id=fourm-native&response_type=code"),
      false,
    );
  }
  assert.equal(allowed(undefined), false);
  assert.equal(allowed("/oauth/v2/%zz"), false);
  assert.ok(allowed("/oauth/v2/token"));
  assert.ok(allowed("/management/v1/projects"));
});
