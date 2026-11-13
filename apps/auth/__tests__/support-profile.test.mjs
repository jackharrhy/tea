import test from "node:test";
import assert from "node:assert/strict";
import { supportProfile } from "../src/support-profile.mjs";

const consumer = {
  origin: "https://artbin.test",
  transportSecret: "private-transport",
};
const input = {
  consumer,
  clientId: "support-client",
  target: "existing-subject",
};
test("profile preflight uses only the fixed consumer endpoint and separate transport credential", async () => {
  const result = await supportProfile({
    ...input,
    fetcher: async (url, options) => {
      assert.equal(url.href, "https://artbin.test/auth/support/eligibility");
      assert.equal(options.redirect, "error");
      assert.equal(
        options.headers.authorization,
        "Basic " +
          Buffer.from("support-client:private-transport").toString("base64"),
      );
      assert.deepEqual(JSON.parse(options.body), {
        targetSubject: "existing-subject",
      });
      return Response.json({ version: 1, localProfileExists: true });
    },
  });
  assert.equal(result, "ready");
});
test("missing local profile differs from an unavailable or invalid consumer check", async () => {
  const check = (response) =>
    supportProfile({ ...input, fetcher: async () => response });
  assert.equal(
    await check(Response.json({ version: 1, localProfileExists: false })),
    "missing",
  );
  for (const response of [
    new Response("", { status: 401 }),
    Response.json({ version: 1, localProfileExists: "true" }),
    Response.json({ version: 2, localProfileExists: true }),
    new Response("x".repeat(2048)),
  ]) {
    assert.equal(await check(response), "unavailable");
  }
  assert.equal(
    await supportProfile({
      ...input,
      fetcher: async () => {
        throw new Error("network");
      },
    }),
    "unavailable",
  );
});
