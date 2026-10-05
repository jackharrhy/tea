import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "@tea/shell-core/router.ts";
import { readConfig } from "../app/config.ts";
import { demoIdentity } from "../app/auth/fixtures.ts";
import { JobManager, MockRunner } from "@tea/shell-core/execution/index.ts";
test("2025 Streamable HTTP initialize, tools/list and notifications are authenticated", async () => {
  const jobs = new JobManager({ runner: new MockRunner() });
  const app = createApp(readConfig({ SHELL_MODE: "demo" }), demoIdentity, jobs);
  const call = (
    method: string,
    params: object = {},
    token = "demo-only-token",
    id: number | undefined = 1,
  ) =>
    app.fetch(
      new Request("http://127.0.0.1:3000/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          "MCP-Protocol-Version": "2025-06-18",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: method.startsWith("notifications/") ? undefined : id,
          method,
          params,
        }),
      }),
    );
  const response = await call("initialize", {
    protocolVersion: "2025-06-18",
    clientInfo: { name: "fixture", version: "1" },
    capabilities: {},
  });
  assert.equal(response.status, 200);
  assert.equal(
    ((await response.json()) as any).result.protocolVersion,
    "2025-06-18",
  );
  const list = await call("tools/list");
  assert.equal(list.status, 200);
  assert.equal(((await list.json()) as any).result.tools.length, 3);
  assert.equal(
    (await call("notifications/initialized", {}, "demo-only-token", undefined))
      .status,
    202,
  );
  assert.equal((await call("initialize", {}, "bad")).status, 401);
  assert.equal((await call("tools/list", {}, "bad")).status, 401);
  jobs.close();
});
