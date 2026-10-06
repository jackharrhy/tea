import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobManager } from "../job-manager.ts";
test("lost cleanup acknowledgement exposes uncertainty without freeing capacity", () => {
  const jobs = new JobManager({
    maxConcurrent: 1,
    runner: {
      enabled: true,
      run(_job, cb) {
        cb.onUncertain?.();
        return { cancel() {} };
      },
    },
  });
  const { job } = jobs.execute("owner", {
    command: "fixture",
    idempotencyKey: "uncertain",
  });
  assert.equal(job.status, "unknown");
  assert.match(job.error!, /cleanup/);
  assert.throws(
    () =>
      jobs.execute("owner", { command: "fixture", idempotencyKey: "second" }),
    /occupied/,
  );
  jobs.close();
});
test("restart preserves unknown outcome tombstone and never replays matching key", () => {
  const dir = mkdtempSync(join(tmpdir(), "shell-journal-"));
  const journalFile = join(dir, "jobs.jsonl");
  let starts = 0;
  const runner = {
    enabled: true,
    run() {
      starts++;
      return { cancel() {} };
    },
  };
  try {
    const first = new JobManager({ runner, journalFile });
    const { job } = first.execute("owner", {
      command: "private-command",
      idempotencyKey: "persist-1",
    });
    first.close();
    const second = new JobManager({ runner, journalFile });
    const recovered = second.readJob("owner", job.jobId);
    assert.equal(recovered.status, "unknown");
    assert.match(recovered.error!, /not replay/);
    assert.equal(
      second.execute("owner", {
        command: "private-command",
        idempotencyKey: "persist-1",
      }).reused,
      true,
    );
    assert.equal(starts, 1);
    assert.doesNotMatch(readFileSync(journalFile, "utf8"), /private-command/);
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
