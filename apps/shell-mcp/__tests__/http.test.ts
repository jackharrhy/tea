import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../app/router.ts";
import { readConfig } from "../app/config.ts";
import { demoIdentity, lockedIdentity } from "../app/auth/fixtures.ts";
import type { IdentityProvider } from "../app/auth/types.ts";
import { createJobManager, createMockRunner } from "../app/execution/index.ts";
import { rpcRequest, rpcResult, toolValue } from "../scripts/protocol.ts";
const origin = "http://127.0.0.1:3000";
function fixture(provider: IdentityProvider = demoIdentity) {
  const jobs = createJobManager({ runner: createMockRunner({ delayMs: 100 }) });
  const app = createApp(readConfig({ SHELL_MODE: "demo" }), provider, jobs);
  return { app, jobs };
}
test("real Remix router + published MCP tools/list contract", async () => {
  const { app, jobs } = fixture();
  try {
    const result = await rpcResult(
      await app.fetch(rpcRequest(origin, "tools/list")),
    );
    assert.deepEqual(
      result.tools.map((t: any) => t.name),
      ["execute", "read_job", "cancel"],
    );
    assert.equal(result.cacheScope, "private");
    assert.equal(result.tools[0].annotations.destructiveHint, true);
    assert.equal(result.tools[1].annotations.readOnlyHint, true);
  } finally {
    jobs.close();
  }
});
test("execute/read/cancel through HTTP never evaluates a shell command", async () => {
  const { app, jobs } = fixture();
  try {
    const execute = await rpcResult(
      await app.fetch(
        rpcRequest(origin, "tools/call", {
          name: "execute",
          arguments: {
            command: "printf should-never-execute",
            idempotencyKey: "http-fixture-1",
          },
        }),
      ),
    );
    const created = toolValue(execute);
    assert.equal(created.job.status, "running");
    const duplicate = toolValue(
      await rpcResult(
        await app.fetch(
          rpcRequest(origin, "tools/call", {
            name: "execute",
            arguments: {
              command: "printf should-never-execute",
              idempotencyKey: "http-fixture-1",
            },
          }),
        ),
      ),
    );
    assert.equal(duplicate.reused, true);
    assert.equal(duplicate.job.jobId, created.job.jobId);
    const cancelled = toolValue(
      await rpcResult(
        await app.fetch(
          rpcRequest(origin, "tools/call", {
            name: "cancel",
            arguments: { jobId: created.job.jobId },
          }),
        ),
      ),
    );
    assert.equal(cancelled.status, "cancelled");
    const read = toolValue(
      await rpcResult(
        await app.fetch(
          rpcRequest(origin, "tools/call", {
            name: "read_job",
            arguments: { jobId: created.job.jobId },
          }),
        ),
      ),
    );
    assert.equal(read.status, "cancelled");
    assert.equal(read.stdout, "");
  } finally {
    jobs.close();
  }
});
test("all MCP methods including discovery/list/non-POST require authentication", async () => {
  const { app, jobs } = fixture();
  try {
    for (const method of ["server/discover", "tools/list", "tools/call"]) {
      const response = await app.fetch(rpcRequest(origin, method, {}, "bad"));
      assert.equal(response.status, 401);
      assert.match(
        response.headers.get("www-authenticate")!,
        /oauth-protected-resource\/mcp/,
      );
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    assert.equal((await app.fetch(new Request(`${origin}/mcp`))).status, 401);
    assert.equal(
      (
        await app.fetch(
          new Request(`${origin}/mcp`, {
            headers: { authorization: "Bearer demo-only-token" },
          }),
        )
      ).status,
      405,
    );
  } finally {
    jobs.close();
  }
});
test("rejects origin, body limits, unsupported revision, malformed metadata, header/body mismatch", async () => {
  const { app, jobs } = fixture();
  try {
    let request = rpcRequest(origin, "tools/list");
    request.headers.set("origin", "https://untrusted.example");
    assert.equal((await app.fetch(request)).status, 403);
    request = rpcRequest(origin, "tools/list");
    request.headers.set("Mcp-Method", "tools/call");
    assert.equal((await app.fetch(request)).status, 400);
    const version = rpcRequest(origin, "tools/list");
    const data = (await version.json()) as any;
    data.params._meta["io.modelcontextprotocol/protocolVersion"] = "2025-03-26";
    version.headers.set("MCP-Protocol-Version", "2025-03-26");
    assert.equal(
      (
        await app.fetch(
          new Request(version, { method: "POST", body: JSON.stringify(data) }),
        )
      ).status,
      400,
    );
    request = rpcRequest(origin, "tools/list");
    assert.equal(
      (
        await app.fetch(
          new Request(request, { method: "POST", body: "x".repeat(16_385) }),
        )
      ).status,
      413,
    );
    request = rpcRequest(origin, "tools/list");
    assert.equal(
      (
        await app.fetch(
          new Request(request, {
            method: "POST",
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "tools/list",
              params: {},
            }),
          }),
        )
      ).status,
      400,
    );
  } finally {
    jobs.close();
  }
});
test("limits streamed MCP bodies without a content-length header", async () => {
  const { app, jobs } = fixture();
  try {
    const template = rpcRequest(origin, "tools/list");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(16_000));
        controller.enqueue(new Uint8Array(385));
        controller.close();
      },
    });
    const requestOptions = {
      method: "POST",
      headers: template.headers,
      body,
      duplex: "half" as const,
    };
    const response = await app.fetch(
      new Request(`${origin}/mcp`, requestOptions),
    );
    assert.equal(response.status, 413);
  } finally {
    jobs.close();
  }
});
test("tool input validation rejects bad timeout and denies owner injection", async () => {
  const { app, jobs } = fixture();
  try {
    const response = await app.fetch(
      rpcRequest(origin, "tools/call", {
        name: "execute",
        arguments: {
          command: "x",
          idempotencyKey: "http-fixture-2",
          timeoutMs: -1,
        },
      }),
    );
    assert.ok(((await response.json()) as any).error);
    const unknown = toolValue(
      await rpcResult(
        await app.fetch(
          rpcRequest(origin, "tools/call", {
            name: "execute",
            arguments: {
              command: "x",
              idempotencyKey: "http-fixture-3",
              ownerId: "attacker",
            },
          }),
        ),
      ),
    );
    assert.throws(() => jobs.readJob("attacker", unknown.job.jobId));
  } finally {
    jobs.close();
  }
});
test("default service refuses execution and does not advertise configured OAuth", async () => {
  const jobs = createJobManager();
  const app = createApp(readConfig({}), lockedIdentity, jobs);
  assert.equal((await app.fetch(rpcRequest(origin, "tools/list"))).status, 503);
  assert.equal(
    (
      await app.fetch(
        new Request(`${origin}/.well-known/oauth-protected-resource/mcp`),
      )
    ).status,
    503,
  );
  assert.throws(
    () =>
      jobs.execute("owner", { command: "x", idempotencyKey: "fixture-locked" }),
    /disabled/i,
  );
  jobs.close();
});

test("router-matched MCP aliases keep authentication and body limits", async () => {
  const { app, jobs } = fixture();
  try {
    for (const path of ["/%6dcp", "/m%63p"]) {
      const listed = await app.fetch(
        new Request(`${origin}${path}`, rpcRequest(origin, "tools/list")),
      );
      assert.equal(listed.status, 200, path);
      for (const method of ["tools/list", "server/discover"]) {
        const original = rpcRequest(origin, method, {}, "bad");
        const response = await app.fetch(
          new Request(`${origin}${path}`, original),
        );
        assert.equal(response.status, 401, path);
      }
      assert.equal(
        (await app.fetch(new Request(`${origin}${path}`))).status,
        401,
      );
      assert.equal(
        (
          await app.fetch(
            new Request(`${origin}${path}`, {
              headers: { authorization: "Bearer demo-only-token" },
            }),
          )
        ).status,
        405,
        path,
      );
      const authorized = rpcRequest(origin, "tools/list");
      const oversized = new Request(`${origin}${path}`, {
        method: "POST",
        headers: authorized.headers,
        body: "x".repeat(100_000),
      });
      assert.equal((await app.fetch(oversized)).status, 413, path);
    }
    for (const path of ["/mcp/", "/%2fmcp", "//mcp", "/mcp%2f", "/MCP"]) {
      const response = await app.fetch(
        new Request(
          `${origin}${path}`,
          rpcRequest(origin, "tools/list", {}, "bad"),
        ),
      );
      assert.equal(response.status, 404, path);
    }
  } finally {
    jobs.close();
  }
});
