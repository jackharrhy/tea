import assert from "node:assert/strict";
import { startServer } from "../server.ts";
import { readConfig } from "../app/config.ts";
import { rpcRequest, rpcResult, toolValue } from "./protocol.ts";
const running = await startServer(
  readConfig({ SHELL_MODE: "demo", PORT: "0" }),
);
try {
  assert.equal((await fetch(`${running.origin}/healthz`)).status, 200);
  const listed = await rpcResult(
    await fetch(rpcRequest(running.origin, "tools/list")),
  );
  assert.equal(listed.tools.length, 3);
  const started = toolValue(
    await rpcResult(
      await fetch(
        rpcRequest(running.origin, "tools/call", {
          name: "execute",
          arguments: {
            command: "never evaluated",
            idempotencyKey: "smoke-fixture-1",
          },
        }),
      ),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  const finished = toolValue(
    await rpcResult(
      await fetch(
        rpcRequest(running.origin, "tools/call", {
          name: "read_job",
          arguments: { jobId: started.job.jobId },
        }),
      ),
    ),
  );
  assert.equal(finished.status, "succeeded");
  assert.equal(finished.exitCode, 0);
  assert.match(finished.stdout, /no command was executed/);
  assert.equal(
    (await fetch(rpcRequest(running.origin, "tools/list", {}, "wrong"))).status,
    401,
  );
  console.log(
    "PASS: loopback HTTP → Remix 3 router → @sdxc/mcp → mock execute/read job; unauthorized request rejected. No real commands, OAuth, Docker, or dot integration tested.",
  );
} finally {
  await running.close();
}
