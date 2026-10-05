import assert from "node:assert/strict";
import { test } from "node:test";
import { createLogger, currentLog } from "../src/index.ts";

test("request binds the current log and emits one event", async () => {
  const records: Record<string, unknown>[] = [];
  const logger = createLogger({
    service: "fixture",
    sink(record) {
      records.push(record);
    },
  });
  assert.equal(currentLog(), undefined);
  await logger.request(new Request("https://example.test/mcp"), async () => {
    const log = currentLog();
    assert.ok(log);
    log.set({ mcp: { method: "tools/list" } });
    return new Response(null, { status: 202 });
  });
  assert.equal(currentLog(), undefined);
  assert.equal(records.length, 1);
  assert.equal(records[0]["mcp.method"], "tools/list");
  assert.equal(records[0]["http.method"], "GET");
  assert.equal(records[0]["http.status"], 202);
});

test("failure records omit exception details", async () => {
  const records: Record<string, unknown>[] = [];
  const logger = createLogger({
    service: "fixture",
    sink(record) {
      records.push(record);
    },
  });
  const error = new Error("secret-token");
  await assert.rejects(
    logger.open("request").run(() => {
      throw error;
    }),
    error,
  );
  assert.equal(records[0].outcome, "error");
  assert.equal(records[0]["error.type"], "Error");
  assert.equal(JSON.stringify(records[0]).includes("secret-token"), false);
});
