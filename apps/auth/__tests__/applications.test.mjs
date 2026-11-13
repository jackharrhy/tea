import test from "node:test";
import assert from "node:assert/strict";
import {
  applicationForClient,
  applicationRoleKeys,
  authorizationForRequest,
  searchAll,
} from "../src/applications.mjs";

const applications = [
  { id: "lore", projectId: "lore-project", clientIds: ["lore-client"] },
  { id: "fourm", projectId: "fourm-project", clientIds: ["fourm-client"] },
];
test("membership includes own-content permissions without changing admin or revoked grants", () => {
  const app = {
    apiRoles: ["pages-read", "pages-write", "media-read", "media-write"],
  };
  assert.deepEqual(applicationRoleKeys(app, "member"), [
    "member",
    ...app.apiRoles,
  ]);
  assert.deepEqual(applicationRoleKeys(app, "admin"), ["admin"]);
  assert.deepEqual(applicationRoleKeys(app, ""), []);
  assert.deepEqual(applicationRoleKeys({}, "member"), ["member"]);
});
test("staged native clients cannot resume authorization requests created before ingress protection", () => {
  const app = {
    id: "fourm",
    clientIds: ["browser", "native"],
    authRequestNotBefore: { native: "2026-11-08T12:00:00Z" },
  };
  for (const creationDate of [
    undefined,
    "invalid",
    "2026-11-08T11:59:59Z",
    "2026-11-08T12:00:00Z",
  ]) {
    assert.throws(
      () =>
        authorizationForRequest([app], { clientId: "native", creationDate }),
      { status: 400 },
    );
  }
  assert.equal(
    authorizationForRequest([app], {
      clientId: "native",
      creationDate: "2026-11-08T12:00:01Z",
    }).consent,
    false,
  );
  assert.equal(
    authorizationForRequest([app], { clientId: "browser" }).consent,
    false,
  );
});
test("client identity resolves to its own application and unknown clients fail closed", () => {
  assert.equal(
    applicationForClient(applications, "fourm-client").projectId,
    "fourm-project",
  );
  assert.equal(
    applicationForClient(applications, "lore-client").projectId,
    "lore-project",
  );
  assert.throws(
    () => applicationForClient(applications, "unregistered-client"),
    { status: 403 },
  );
  assert.throws(
    () =>
      applicationForClient(
        [{ clientIds: ["held"], authorizationHold: true }],
        "held",
      ),
    { status: 403 },
  );
});
test("directory reads include grants beyond the first page and keep query scoping", async () => {
  const queries = [{ projectIdQuery: { projectId: "fourm-project" } }];
  const calls = [];
  const result = await searchAll(
    async (path, options) => {
      calls.push(options.body.query.offset);
      assert.deepEqual(options.body.queries, queries);
      assert.equal(options.management, true);
      const offset = Number(options.body.query.offset);
      return {
        result: Array.from({ length: offset === 0 ? 100 : 61 }, (_, i) => ({
          id: offset + i,
        })),
      };
    },
    "/management/v1/users/grants/_search",
    queries,
  );
  assert.equal(result.length, 161);
  assert.deepEqual(calls, ["0", "100"]);
});
