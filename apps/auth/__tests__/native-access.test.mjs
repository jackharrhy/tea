import assert from "node:assert/strict";
import test from "node:test";
import { createNativeAccess } from "../src/native-access.mjs";

test("native v2 role assignment mapping preserves full role keys and organization scope", async () => {
  const calls = [];
  const api = async (path, options) => {
    calls.push({ path, options });
    return {
      authorizations: [
        {
          id: "grant",
          organization: { id: "org" },
          project: { id: "project" },
          user: { id: "person" },
          state: "STATE_INACTIVE",
          roles: [{ key: "custom-role" }, { key: "member" }],
        },
      ],
    };
  };
  const native = createNativeAccess(api, "org");
  assert.deepEqual(await native.list("person"), [
    {
      id: "grant",
      userId: "person",
      projectId: "project",
      state: "USER_GRANT_STATE_INACTIVE",
      roleKeys: ["custom-role", "member"],
    },
  ]);
  assert.deepEqual(calls[0].options.body.filters, [
    { organizationId: { id: "org" } },
    { inUserIds: { ids: ["person"] } },
  ]);
  await native.write(
    { id: "grant" },
    { userId: "person", projectId: "project", roleKeys: ["custom-role"] },
  );
  assert.equal(
    calls[1].path,
    "/zitadel.authorization.v2.AuthorizationService/UpdateAuthorization",
  );
  assert.deepEqual(calls[1].options.body, {
    id: "grant",
    roleKeys: ["custom-role"],
  });
});

test("ending a central session uses native login authority and verifies exact owner before deletion", async () => {
  const calls = [];
  const native = createNativeAccess(async (path, options) => {
    calls.push({ path, options });
    return { session: { factors: { user: { id: "other-person" } } } };
  }, "org");
  await assert.rejects(native.endSession("person", "session-id"), {
    status: 404,
  });
  assert.equal(calls.length, 1);
  const own = createNativeAccess(async (path, options) => {
    calls.push({ path, options });
    return { session: { factors: { user: { id: "person" } } } };
  }, "org");
  await own.endSession("person", "own-session");
  assert.equal(calls.at(-1).options.method, "DELETE");
  assert.equal(calls.at(-1).options.management, undefined);
});
