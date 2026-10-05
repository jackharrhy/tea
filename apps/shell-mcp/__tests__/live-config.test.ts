import test from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../app/config.ts";
import { JobManager } from "@tea/shell-core/execution/job-manager.ts";
import { startServer } from "../server.ts";
test("real runner requires fourorm and durable journal configuration", () => {
  assert.throws(
    () => readConfig({ SHELL_MODE: "demo", SHELL_RUNNER: "systemd" }),
    /fourorm/,
  );
  assert.throws(() => readConfig({ SHELL_RUNNER: "anything" }), /runner/);
});
test("shutdown waits for asynchronous cleanup acknowledgement", async () => {
  let end: () => void;
  const jobs = new JobManager({
    runner: {
      enabled: true,
      run(_job, cb) {
        end = () => cb.onExit({ exitCode: null });
        return {
          cancel() {
            setTimeout(end, 20);
          },
        };
      },
    },
  });
  jobs.execute("owner", { command: "fixture", idempotencyKey: "shutdown" });
  await jobs.closeAndWait(1000);
  assert.throws(
    () =>
      jobs.execute("owner", {
        command: "fixture",
        idempotencyKey: "after-close",
      }),
    /disabled/,
  );
});

test("keeps an explicit public origin when bound to an ephemeral local port", async () => {
  const running = await startServer(
    readConfig({
      SHELL_MODE: "locked",
      HOST: "127.0.0.1",
      PORT: "0",
      PUBLIC_ORIGIN: "http://shell.localhost",
    }),
  );
  try {
    const response = await running.app.fetch(
      new Request("http://shell.localhost/mcp", { method: "POST", body: "{}" }),
    );
    assert.equal(response.status, 503);
  } finally {
    await running.close();
  }
});
