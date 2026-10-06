import test from "node:test";
import assert from "node:assert/strict";
import { JobManager } from "../job-manager.ts";
import type { RunnerJob } from "../types.ts";
test("cwd crosses permitted directories and binds idempotency", () => {
  let captured: RunnerJob | undefined;
  const jobs = new JobManager({
    runner: {
      enabled: true,
      run(job, cb) {
        captured = job;
        cb.onExit({ exitCode: 0 });
        return { cancel() {} };
      },
    },
  });
  jobs.execute("owner", {
    command: "pwd",
    cwd: "/var/tmp",
    idempotencyKey: "cwd-1",
  });
  assert.equal(captured?.cwd, "/var/tmp");
  assert.throws(
    () =>
      jobs.execute("owner", {
        command: "pwd",
        cwd: "/home",
        idempotencyKey: "cwd-1",
      }),
    /already used/,
  );
  assert.throws(
    () =>
      jobs.execute("owner", {
        command: "pwd",
        cwd: "relative",
        idempotencyKey: "cwd-2",
      }),
    /absolute/,
  );
});
