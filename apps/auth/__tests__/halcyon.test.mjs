import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authorizationForRequest } from "../src/applications.mjs";

test("retired Halcyon client is absent and cannot authorize through the shared Jellyfin member project", () => {
  const apps = JSON.parse(
    readFileSync(new URL("../config/applications.json", import.meta.url)),
  );
  const clientId = "399207418342408212";
  assert(
    !apps.some(
      (app) => app.id === "halcyon" || app.clientIds.includes(clientId),
    ),
  );
  for (const scope of [
    ["openid", "profile"],
    [
      "openid",
      "urn:zitadel:iam:org:project:id:399067666012176387:aud",
      "urn:zitadel:iam:org:projects:roles",
      "urn:zitadel:iam:org:project:role:member",
    ],
  ])
    assert.throws(
      () =>
        authorizationForRequest(apps, {
          clientId,
          scope,
          creationDate: new Date().toISOString(),
          redirectUri: "https://halcyon.rotund.org/oauth2/callback",
        }),
      { status: 403 },
    );
  const media = apps.find((app) => app.id === "media-admin");
  assert.deepEqual(Object.values(media.clientRoleRequirements), [["admin"]]);
});
