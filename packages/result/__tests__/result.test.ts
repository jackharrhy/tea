import assert from "node:assert/strict";
import { test } from "node:test";
import { failure, isFailure, isSuccess, success, wrap } from "../src/index.ts";

test("result guards distinguish success and failure", () => {
  assert.equal(isSuccess(success(42)), true);
  assert.equal(isFailure(failure(new Error("failed"))), true);
});

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
