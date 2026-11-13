import test from "node:test";
import assert from "node:assert/strict";
import { createAccountActions } from "../src/accounts.mjs";

test("password changes never fall back to a privileged password reset", async () => {
  let calls = 0;
  const actions = createAccountActions(async (path, options) => {
    calls++;
    assert.equal(options.body.currentPassword, "existing-password");
    assert.equal(options.body.newPassword.password, "NewPassword123!");
  }, "org");
  await assert.rejects(actions.changePassword("user", "", "NewPassword123!"));
  await assert.rejects(
    actions.changePassword("user", undefined, "NewPassword123!"),
  );
  assert.equal(calls, 0);
  await actions.changePassword("user", "existing-password", "NewPassword123!");
  assert.equal(calls, 1);
});
test("management targets must be human users owned by this organization", async () => {
  const actions = createAccountActions(
    async () => ({ user: { human: {}, details: { resourceOwner: "other" } } }),
    "org",
  );
  await assert.rejects(actions.managedUser("outside"), { status: 403 });
});
test("password proof records a rotated provider session token", async () => {
  const actions = createAccountActions(
    async () => ({ sessionToken: "rotated" }),
    "org",
  );
  const session = { sessionId: "session", sessionToken: "original" };
  await actions.provePassword(session, "existing-password");
  assert.equal(session.sessionToken, "rotated");
});

test("email sign-in resolves only a unique active account with a verified address", async () => {
  let users = [];
  const actions = createAccountActions(async () => ({ result: users }), "org");
  assert.deepEqual(await actions.loginUser(" jack "), { loginName: "jack" });
  await assert.rejects(actions.loginUser("missing@example.com"), {
    status: 401,
  });
  users = [
    {
      id: "user",
      state: "USER_STATE_ACTIVE",
      human: { email: { isEmailVerified: false } },
    },
  ];
  await assert.rejects(actions.loginUser("test@example.com"), { status: 401 });
  users[0].human.email.isEmailVerified = true;
  assert.deepEqual(await actions.loginUser("test@example.com"), {
    userId: "user",
  });
  users.push({ ...users[0], id: "other" });
  await assert.rejects(actions.loginUser("test@example.com"), { status: 401 });
});
