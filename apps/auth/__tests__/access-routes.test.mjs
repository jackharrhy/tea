import test from "node:test";
import assert from "node:assert/strict";
import { createAccessRoutes } from "../src/access-routes.mjs";

test("concurrent suspension requests recheck the queued actor and preserve an active administrator", async () => {
  const users = ["alpha", "bravo"].map((id) => ({
    id,
    state: "USER_STATE_ACTIVE",
    human: {},
    details: { resourceOwner: "org" },
  }));
  const model = {
    memberships: users.map((user) => ({
      subject: user.id,
      group: "auth-administrators",
    })),
  };
  let writes = 0;
  const handler = createAccessRoutes({
    api: async () => ({ result: structuredClone(users) }),
    applications: [],
    services: [],
    integrations: [],
    organizationId: "org",
    access: {
      isAdministrator: (subject) =>
        model.memberships.some((item) => item.subject === subject),
      observeUnmanaged: () => {},
      read: () => model,
      domains: () => [],
      recordAccount: () => {},
    },
    native: { list: async () => [] },
    endUserSessions: async () => {},
    accountActions: {
      managedUser: async (id) =>
        structuredClone(users.find((user) => user.id === id)),
      setActive: async (id, active) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        writes++;
        users.find((user) => user.id === id).state = active
          ? "USER_STATE_ACTIVE"
          : "USER_STATE_INACTIVE";
      },
    },
  });
  const request = (actor, target) =>
    handler({
      request: { method: "POST" },
      url: new URL(`https://auth.example/manage/users/${target}/status`),
      form: new URLSearchParams({ active: "false" }),
      session: { userId: actor },
      context: { admin: true },
      redirect: () => {},
    });
  const result = await Promise.allSettled([
    request("alpha", "bravo"),
    request("bravo", "alpha"),
  ]);
  assert.equal(result[0].status, "fulfilled");
  assert.equal(result[1].reason.status, 403);
  assert.equal(
    users.find((user) => user.id === "alpha").state,
    "USER_STATE_ACTIVE",
  );
  assert.equal(writes, 1);
  await assert.rejects(request("alpha", "alpha"), { status: 409 });
  assert.equal(writes, 1);
});
