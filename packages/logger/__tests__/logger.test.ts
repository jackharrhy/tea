import assert from "node:assert/strict";
import { test } from "node:test";
import { createLogger, currentLog } from "../src/index.ts";

test("run binds the current log and emits one event", async () => {
  const records: Record<string, unknown>[] = [];
  const logger = createLogger({
    service: "fixture",
    sink(record) {
      records.push(record);
    },
  });
  assert.equal(currentLog(), undefined);
  await logger.open("request").run(async (log) => {
    assert.equal(currentLog(), log);
    currentLog()?.set({ mcp: { method: "tools/list" } });
  });
  assert.equal(currentLog(), undefined);
  assert.equal(records.length, 1);
  assert.equal(records[0]["mcp.method"], "tools/list");
});
