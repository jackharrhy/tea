import assert from "node:assert/strict";
import { test } from "node:test";
import { wrap } from "../src/index.ts";

test("wrap turns thrown and rejected errors into failures", async () => {
  const thrown = wrap(() => {
    throw new Error("sync");
  });
  assert.equal(thrown.status, "failure");
  if (thrown.status === "failure") assert.equal(thrown.error.message, "sync");

  const rejected = await wrap(async () => {
    throw new Error("async");
  });
  assert.equal(rejected.status, "failure");
  if (rejected.status === "failure")
    assert.equal(rejected.error.message, "async");
});
