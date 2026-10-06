import assert from "node:assert/strict";
import { test } from "node:test";
import { createInvalidArgumentsError, createToolError } from "../src/index.ts";
import { isInvalidArgumentsError, isToolError } from "../src/errors.ts";

test("only errors created by MCP qualify for public responses", () => {
  const spoofed = new Error("private detail");
  spoofed.name = "ToolError";
  assert.equal(isToolError(spoofed), false);
  assert.equal(isToolError(createToolError("Try another page.")), true);

  const invalid = createInvalidArgumentsError(["page must be positive"]);
  assert.equal(isInvalidArgumentsError(invalid), true);
  assert.deepEqual(invalid.issues, ["page must be positive"]);
});
