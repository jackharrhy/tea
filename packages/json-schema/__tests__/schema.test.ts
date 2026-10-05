import assert from "node:assert/strict";
import { test } from "node:test";
import * as s from "../src/index.ts";
import * as checks from "../src/checks.ts";

test("one schema validates input and describes it for MCP", () => {
  const schema = s.object({ name: s.string().pipe(checks.maxLength(4)) });
  assert.equal(s.parseSafe(schema, { name: "longer" }).success, false);
  assert.equal(s.parseSafe(schema, { name: "tea" }).success, true);

  const described = s.toJSONSchema(schema);
  assert.equal(described.status, "success");
  if (described.status === "success") {
    assert.equal(described.data.type, "object");
    assert.deepEqual(described.data.properties?.name, {
      type: "string",
      maxLength: 4,
    });
  }
});
