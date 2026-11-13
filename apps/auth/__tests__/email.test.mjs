import test from "node:test";
import assert from "node:assert/strict";
import { createEmailActions } from "../src/email.mjs";

test("recovery only sends for one active account with a verified address", async () => {
  let users = [],
    sends = [];
  const actions = createEmailActions(async (path, options) => {
    if (path.endsWith("_search")) return { result: users };
    sends.push({ path, body: options.body });
    return {};
  }, "https://auth.example");
  await actions.requestReset("missing");
  users = [
    {
      id: "user",
      state: "USER_STATE_ACTIVE",
      human: { email: { email: "test@example.com", isEmailVerified: false } },
    },
  ];
  await actions.requestReset("test");
  users[0].human.email.isEmailVerified = true;
  users[0].state = "USER_STATE_INACTIVE";
  await actions.requestReset("test");
  assert.equal(sends.length, 0);
  users[0].state = "USER_STATE_ACTIVE";
  await actions.requestReset("test");
  assert.equal(sends.length, 1);
  assert.equal(sends[0].path, "/v2/users/user/password_reset");
  assert.equal(
    sends[0].body.sendLink.urlTemplate,
    "https://auth.example/reset-password?userID={{.UserID}}&code={{.Code}}",
  );
});

test("password reset always supplies proof and rejects empty codes", async () => {
  let calls = 0;
  const actions = createEmailActions(async (path, options) => {
    calls++;
    assert.equal(options.body.verificationCode, "one-use-code");
    assert.equal(options.body.newPassword.changeRequired, false);
  }, "https://auth.example");
  await assert.rejects(actions.resetPassword("user", "", "LongPassword123!"));
  await assert.rejects(actions.resetPassword("user", "one-use-code", "short"));
  assert.equal(calls, 0);
  await actions.resetPassword("user", "one-use-code", "LongPassword123!");
  assert.equal(calls, 1);
});

test("email enrollment sends a verification link and cannot mark an address verified", async () => {
  let body;
  const actions = createEmailActions(async (path, options) => {
    body = options.body;
  }, "https://auth.example");
  await assert.rejects(actions.setEmail("user", "x@pending.invalid"));
  await actions.setEmail("user", "test@example.com");
  assert.equal(body.isVerified, undefined);
  assert.equal(
    body.sendCode.urlTemplate,
    "https://auth.example/verify-email?userID={{.UserID}}&code={{.Code}}",
  );
});

test("reset requirements reflect the provider policy while keeping the local length floor", async () => {
  let policy = { minLength: "8", hasUppercase: true, hasSymbol: true };
  const actions = createEmailActions(async (path, options) => {
    assert.equal(path, "/management/v1/policies/password/complexity");
    assert.equal(options.management, true);
    return { policy };
  }, "https://auth.example");
  assert.deepEqual(await actions.passwordPolicy(), {
    minLength: 12,
    hasUppercase: true,
    hasLowercase: false,
    hasNumber: false,
    hasSymbol: true,
  });
  policy.minLength = "20";
  assert.equal((await actions.passwordPolicy()).minLength, 20);
  policy.minLength = "invalid";
  await assert.rejects(actions.passwordPolicy());
});
