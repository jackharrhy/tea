import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authorizationPolicy } from "../src/oidc-policy.mjs";
import { authorizationForRequest } from "../src/applications.mjs";
import { createAuthorizationActions } from "../src/authorization.mjs";

for (const [name, client] of [
  ["Cleanuparr", "399208066580480020"],
  ["slskd", "399584591968469012"],
]) {
  test(`${name} uses the existing Media Admin project, explicit admin and scope-independent S256 gate`, async () => {
    const apps = JSON.parse(readFileSync(new URL("../config/applications.json", import.meta.url)));
    const app = apps.find((a) => a.id === "media-admin");
    assert(app.clientIds.includes(client));
    const creationDate = new Date(
      Date.parse(app.authRequestNotBefore[client]) + 1000,
    ).toISOString();
    const request = {
      clientId: client,
      creationDate,
      scope: ["openid"],
      redirectUri: `https://${name.toLowerCase()}.rotund.org/oauth2/callback`,
    };
    assert.deepEqual(authorizationForRequest(apps, request).anyRoles, ["admin"]);
    assert.throws(
      () =>
        authorizationForRequest(apps, {
          ...request,
          creationDate: app.authRequestNotBefore[client],
        }),
      { status: 400 },
    );
    const params = new URLSearchParams({
      client_id: client,
      response_type: "code",
      scope: "openid",
    });
    const policy = () =>
      authorizationPolicy("/oauth/v2/authorize?" + params, "GET", new URLSearchParams(), apps);
    assert.equal(policy().allowed, false);
    params.set("code_challenge", "a".repeat(43));
    params.set("code_challenge_method", "plain");
    assert.equal(policy().allowed, false);
    params.set("code_challenge_method", "S256");
    assert.equal(policy().allowed, true);
    let grant;
    const actions = createAuthorizationActions({
      applications: apps,
      api: async () => ({ authRequest: request }),
      grants: async () => (grant ? [grant] : []),
    });
    for (const invalid of [
      undefined,
      {
        userId: "another-user",
        state: "USER_GRANT_STATE_ACTIVE",
        roleKeys: ["admin"],
      },
      { userId: "owner", state: "USER_GRANT_STATE_ACTIVE", roleKeys: [] },
      { userId: "owner", state: "USER_GRANT_STATE_ACTIVE", roleKeys: ["member"] },
      {
        userId: "owner",
        state: "USER_GRANT_STATE_INACTIVE",
        roleKeys: ["admin"],
      },
    ]) {
      grant = invalid;
      await assert.rejects(actions.view("request", { userId: "owner" }), {
        status: 403,
      });
    }
    grant = {
      userId: "owner",
      state: "USER_GRANT_STATE_ACTIVE",
      roleKeys: ["admin"],
    };
    assert.equal(
      (await actions.view("request", { userId: "owner" })).application.projectId,
      app.projectId,
    );
  });
}
