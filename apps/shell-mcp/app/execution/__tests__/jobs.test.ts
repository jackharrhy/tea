import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { JobError, JobManager, MockRunner } from "../index.ts";
import type {
  ExecuteInput,
  Runner,
  RunnerCallbacks,
  RunnerHandle,
  RunnerJob,
  StopReason,
} from "../index.ts";

class ControlledRunner implements Runner {
  readonly enabled = true;
  runs: {
    job: RunnerJob;
    callbacks: RunnerCallbacks;
    cancellations: StopReason[];
  }[] = [];
  run(job: RunnerJob, callbacks: RunnerCallbacks): RunnerHandle {
    const run = { job, callbacks, cancellations: [] as StopReason[] };
    this.runs.push(run);
    return {
      cancel: (reason) => {
        run.cancellations.push(reason);
      },
    };
  }
}

const request = (
  idempotencyKey = "request-1",
  command = "irrelevant mock input",
): ExecuteInput => ({ command, idempotencyKey });
const hasCode = (code: string) => (error: unknown) =>
  error instanceof JobError && error.code === code;

function setup(options: ConstructorParameters<typeof JobManager>[0] = {}) {
  const runner = new ControlledRunner();
  return { runner, manager: new JobManager({ runner, ...options }) };
}

test("production/default construction refuses execution", () => {
  const manager = new JobManager();
  assert.throws(
    () => manager.execute("owner", request()),
    hasCode("RUNNER_DISABLED"),
  );
});

test("mock runner never interprets command and retains success and output", async () => {
  const manager = new JobManager({ runner: new MockRunner({ delayMs: 1 }) });
  const first = manager.execute(
    "owner",
    request("mock-only", "exit 79; this-is-never-evaluated"),
  );
  assert.equal(first.reused, false);
  await delay(15);
  const job = manager.readJob("owner", first.job.jobId);
  assert.equal(job.status, "succeeded");
  assert.equal(job.exitCode, 0);
  assert.equal(job.stdout, "Mock runner: no command was executed.\n");
  assert.ok(job.finishedAt);
  assert.ok(job.expiresAt);
  assert.equal("ownerId" in job, false);
  assert.equal("command" in job, false);
});

test("IDs are random UUIDs and all reads/cancellations are owner-bound", () => {
  const { manager, runner } = setup();
  const first = manager.execute("alice", request());
  const second = manager.execute("bob", request());
  assert.notEqual(first.job.jobId, second.job.jobId);
  assert.match(first.job.jobId, /^[0-9a-f-]{36}$/);
  assert.throws(
    () => manager.readJob("bob", first.job.jobId),
    hasCode("NOT_FOUND"),
  );
  assert.throws(
    () => manager.cancel("bob", first.job.jobId),
    hasCode("NOT_FOUND"),
  );
  assert.throws(
    () => manager.readJob("alice", "not-a-job"),
    hasCode("NOT_FOUND"),
  );
  assert.deepEqual(runner.runs[0].cancellations, []);
  manager.close();
  for (const run of runner.runs) run.callbacks.onExit({ exitCode: null });
});

test("idempotency deduplicates running and finished jobs, without retries", () => {
  const { manager, runner } = setup({ maxConcurrent: 1, maxJobs: 1 });
  const first = manager.execute("owner", request());
  assert.equal(manager.execute("owner", request()).reused, true);
  assert.equal(runner.runs.length, 1);
  assert.throws(
    () => manager.execute("owner", request("request-1", "changed")),
    hasCode("IDEMPOTENCY_CONFLICT"),
  );
  assert.throws(
    () => manager.execute("owner", { ...request(), timeoutMs: 100 }),
    hasCode("IDEMPOTENCY_CONFLICT"),
  );
  runner.runs[0].callbacks.onExit({ exitCode: 17 });
  const replay = manager.execute("owner", request());
  assert.equal(replay.reused, true);
  assert.equal(replay.job.jobId, first.job.jobId);
  assert.equal(replay.job.exitCode, 17);
  assert.equal(replay.job.status, "failed");
  assert.equal(runner.runs.length, 1);
});

test("idempotency keys cannot collide across owners", () => {
  const { manager, runner } = setup();
  const a = manager.execute("owner-a", request("same-key"));
  const b = manager.execute("owner-b", request("same-key"));
  assert.notEqual(a.job.jobId, b.job.jobId);
  assert.equal(runner.runs.length, 2);
  runner.runs.forEach((run) => run.callbacks.onExit({ exitCode: 0 }));
});

test("full concurrency rejects work without queueing or reserving the key", () => {
  const { manager, runner } = setup({ maxConcurrent: 1 });
  manager.execute("owner", request());
  assert.throws(
    () => manager.execute("owner", request("next-key")),
    hasCode("CAPACITY"),
  );
  assert.equal(runner.runs.length, 1);
  runner.runs[0].callbacks.onExit({ exitCode: 0 });
  assert.equal(runner.runs.length, 1);
  manager.execute("owner", request("next-key"));
  assert.equal(runner.runs.length, 2);
  runner.runs[1].callbacks.onExit({ exitCode: 0 });
});

test("retained job capacity rejects new work rather than evicting idempotency", () => {
  const { manager, runner } = setup({ maxJobs: 1 });
  const first = manager.execute("owner", request());
  runner.runs[0].callbacks.onExit({ exitCode: 0 });
  assert.throws(
    () => manager.execute("owner", request("next-key")),
    hasCode("CAPACITY"),
  );
  assert.equal(manager.execute("owner", request()).job.jobId, first.job.jobId);
});

test("stdout and stderr share one byte budget; received bytes remain visible", () => {
  const { manager, runner } = setup({ maxOutputBytes: 8 });
  const { job } = manager.execute("owner", request());
  runner.runs[0].callbacks.onOutput("stdout", "12345");
  runner.runs[0].callbacks.onOutput("stderr", Buffer.from("abcdef"));
  runner.runs[0].callbacks.onOutput("stdout", "later");
  runner.runs[0].callbacks.onExit({ exitCode: 0 });
  const result = manager.readJob("owner", job.jobId);
  assert.equal(result.stdout, "12345");
  assert.equal(result.stderr, "abc");
  assert.deepEqual(result.output, {
    retainedBytes: 8,
    receivedBytes: 16,
    limitBytes: 8,
    truncated: true,
  });
});

test("malformed, partial and Unicode output cannot expand the response byte budget", () => {
  const { manager, runner } = setup({ maxOutputBytes: 4 });
  const { job } = manager.execute("owner", request());
  runner.runs[0].callbacks.onOutput(
    "stdout",
    new Uint8Array([255, 255, 255, 255, 255]),
  );
  let result = manager.readJob("owner", job.jobId);
  assert.ok(
    Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <= 4,
  );
  assert.equal(result.output.retainedBytes, 4);
  runner.runs[0].callbacks.onExit({ exitCode: 0 });
  const next = manager.execute("owner", request("unicode"));
  runner.runs[1].callbacks.onOutput("stdout", Buffer.from([0xf0, 0x9f]));
  runner.runs[1].callbacks.onOutput("stdout", Buffer.from([0x98, 0x80]));
  result = manager.readJob("owner", next.job.jobId);
  assert.equal(result.stdout, "😀");
  assert.equal(result.output.retainedBytes, 4);
  runner.runs[1].callbacks.onExit({ exitCode: 0 });
});

test("snapshots are copies and late callbacks cannot rewrite a completed result", () => {
  const { manager, runner } = setup();
  const { job } = manager.execute("owner", request());
  job.status = "failed";
  job.output.truncated = true;
  assert.equal(manager.readJob("owner", job.jobId).status, "running");
  assert.equal(manager.readJob("owner", job.jobId).output.truncated, false);
  runner.runs[0].callbacks.onExit({ exitCode: 23, signal: "TEST_SIGNAL" });
  runner.runs[0].callbacks.onOutput("stdout", "late output");
  runner.runs[0].callbacks.onExit({ exitCode: 0 });
  const result = manager.readJob("owner", job.jobId);
  assert.equal(result.exitCode, 23);
  assert.equal(result.signal, "TEST_SIGNAL");
  assert.equal(result.stdout, "");
});

test("cancel is idempotent and capacity stays occupied until cleanup is confirmed", () => {
  const { manager, runner } = setup({ maxConcurrent: 1 });
  const { job } = manager.execute("owner", request());
  assert.equal(manager.cancel("owner", job.jobId).status, "cancelling");
  assert.equal(manager.cancel("owner", job.jobId).status, "cancelling");
  assert.deepEqual(runner.runs[0].cancellations, ["cancelled"]);
  assert.throws(
    () => manager.execute("owner", request("next-key")),
    hasCode("CAPACITY"),
  );
  runner.runs[0].callbacks.onExit({ exitCode: null, signal: "SIGTERM" });
  const result = manager.cancel("owner", job.jobId);
  assert.equal(result.status, "cancelled");
  assert.equal(result.signal, "SIGTERM");
  assert.deepEqual(runner.runs[0].cancellations, ["cancelled"]);
});

test("timeout requests cleanup once and preserves timeout after a later cancel", async () => {
  const { manager, runner } = setup({ maxConcurrent: 1 });
  const { job } = manager.execute("owner", { ...request(), timeoutMs: 5 });
  await delay(20);
  assert.equal(manager.readJob("owner", job.jobId).status, "cancelling");
  assert.deepEqual(runner.runs[0].cancellations, ["timeout"]);
  assert.throws(
    () => manager.execute("owner", request("next-key")),
    hasCode("CAPACITY"),
  );
  manager.cancel("owner", job.jobId);
  runner.runs[0].callbacks.onExit({ exitCode: null, signal: "SIGKILL" });
  assert.equal(manager.readJob("owner", job.jobId).status, "timed_out");
  assert.equal(
    manager.execute("owner", { ...request(), timeoutMs: 5 }).reused,
    true,
  );
});

test("retention starts only after exit and in-flight idempotency cannot expire", async () => {
  const { manager, runner } = setup({
    retentionMs: 5,
    maxConcurrent: 1,
    maxJobs: 1,
  });
  const first = manager.execute("owner", request());
  await delay(15);
  assert.equal(manager.execute("owner", request()).job.jobId, first.job.jobId);
  assert.equal(manager.readJob("owner", first.job.jobId).expiresAt, null);
  runner.runs[0].callbacks.onExit({ exitCode: 0 });
  await delay(15);
  assert.throws(
    () => manager.readJob("owner", first.job.jobId),
    hasCode("NOT_FOUND"),
  );
  // This process-local retention boundary is explicit; beyond it there is no deduplication guarantee.
  const next = manager.execute("owner", request());
  assert.notEqual(next.job.jobId, first.job.jobId);
  assert.equal(next.reused, false);
  runner.runs[1].callbacks.onExit({ exitCode: 0 });
});

test("close cancels live work, rejects new work and retains readable results", () => {
  const { manager, runner } = setup();
  const { job } = manager.execute("owner", request());
  manager.close();
  manager.close();
  assert.deepEqual(runner.runs[0].cancellations, ["cancelled"]);
  assert.throws(
    () => manager.execute("owner", request("new-request")),
    hasCode("RUNNER_DISABLED"),
  );
  assert.equal(manager.execute("owner", request()).reused, true);
  runner.runs[0].callbacks.onExit({ exitCode: null });
  assert.equal(manager.readJob("owner", job.jobId).status, "cancelled");
});

test("runtime input validation does not rely on MCP schemas", () => {
  const manager = new JobManager({ runner: new MockRunner() });
  const badInputs = [
    null,
    [],
    {},
    { ...request(), command: "" },
    { ...request(), command: "a\0b" },
    { ...request(), command: "😀".repeat(5_000) },
    { ...request(), command: 42 },
    { ...request(), idempotencyKey: "spaces are invalid" },
    { ...request(), idempotencyKey: "x".repeat(129) },
    { ...request(), timeoutMs: 0 },
    { ...request(), timeoutMs: 300_001 },
    { ...request(), timeoutMs: Number.NaN },
    { ...request(), timeoutMs: Infinity },
    { ...request(), cwd: "relative" },
  ];
  for (const input of badInputs)
    assert.throws(
      () => manager.execute("owner", input as ExecuteInput),
      hasCode("INVALID_INPUT"),
    );
  for (const owner of ["", "x".repeat(1_025), "bad\0owner", null]) {
    assert.throws(
      () => manager.execute(owner as string, request()),
      hasCode("INVALID_INPUT"),
    );
  }
  for (const options of [
    { maxJobs: 0 },
    { maxConcurrent: 17 },
    { maxJobs: 1_024, maxOutputBytes: 1_048_576 },
    { maxOutputBytes: 0 },
    { retentionMs: Infinity },
    { maxTimeoutMs: 0 },
    { defaultTimeoutMs: 300_001 },
  ]) {
    assert.throws(() => new JobManager(options), hasCode("INVALID_INPUT"));
  }
});

test("synchronous completion and startup failure are retained without automatic retries", () => {
  const manager = new JobManager({
    runner: {
      enabled: true,
      run(_job, callbacks) {
        callbacks.onExit({ exitCode: 0 });
        return { cancel() {} };
      },
    },
  });
  assert.equal(manager.execute("owner", request()).job.status, "succeeded");
  let attempts = 0;
  const failed = new JobManager({
    runner: {
      enabled: true,
      run() {
        attempts += 1;
        throw new Error("private failure detail");
      },
    },
  });
  const result = failed.execute("owner", request());
  assert.equal(result.job.status, "failed");
  assert.equal(result.job.error, "Runner failed to start");
  assert.equal(failed.execute("owner", request()).reused, true);
  assert.equal(attempts, 1);
});

test("a broken cancellation never falsely frees an execution slot", () => {
  let callbacks!: RunnerCallbacks;
  const manager = new JobManager({
    maxConcurrent: 1,
    runner: {
      enabled: true,
      run(_job, receivedCallbacks) {
        callbacks = receivedCallbacks;
        return {
          cancel() {
            throw new Error("cleanup failed");
          },
        };
      },
    },
  });
  const { job } = manager.execute("owner", request());
  const stopped = manager.cancel("owner", job.jobId);
  assert.equal(stopped.status, "cancelling");
  assert.match(stopped.error!, /cleanup is not confirmed/);
  assert.throws(
    () => manager.execute("owner", request("next-key")),
    hasCode("CAPACITY"),
  );
  callbacks.onExit({ exitCode: null });
});

test("mock cancellation actually clears its pending completion", async () => {
  const manager = new JobManager({ runner: new MockRunner({ delayMs: 25 }) });
  const { job } = manager.execute("owner", request());
  assert.equal(manager.cancel("owner", job.jobId).status, "cancelled");
  await delay(40);
  const result = manager.readJob("owner", job.jobId);
  assert.equal(result.status, "cancelled");
  assert.equal(result.stdout, "");
  assert.equal(result.exitCode, null);
});

test("reentrant cancellation during run is delivered once a handle exists", () => {
  let callbacks!: RunnerCallbacks;
  const cancellations: StopReason[] = [];
  let manager!: JobManager;
  manager = new JobManager({
    maxConcurrent: 1,
    runner: {
      enabled: true,
      run(job, receivedCallbacks) {
        callbacks = receivedCallbacks;
        manager.cancel("owner", job.jobId);
        return {
          cancel(reason) {
            cancellations.push(reason);
          },
        };
      },
    },
  });
  const { job } = manager.execute("owner", request());
  assert.equal(job.status, "cancelling");
  assert.deepEqual(cancellations, ["cancelled"]);
  assert.throws(
    () => manager.execute("owner", request("next-key")),
    hasCode("CAPACITY"),
  );
  callbacks.onExit({ exitCode: null });
  assert.equal(manager.readJob("owner", job.jobId).status, "cancelled");
});

test("reentrant cancellation failure cannot be mislabeled as a startup failure", () => {
  let callbacks!: RunnerCallbacks;
  let manager!: JobManager;
  manager = new JobManager({
    maxConcurrent: 1,
    runner: {
      enabled: true,
      run(job, receivedCallbacks) {
        callbacks = receivedCallbacks;
        manager.cancel("owner", job.jobId);
        return {
          cancel() {
            throw new Error("cleanup is still pending");
          },
        };
      },
    },
  });
  const { job } = manager.execute("owner", request());
  assert.equal(job.status, "cancelling");
  assert.match(job.error!, /cleanup is not confirmed/);
  assert.throws(
    () => manager.execute("owner", request("next-key")),
    hasCode("CAPACITY"),
  );
  callbacks.onExit({ exitCode: null });
});

test("diagnostics are byte-limited and an invalid exit is never success", () => {
  const { manager, runner } = setup();
  const { job } = manager.execute("owner", request());
  runner.runs[0].callbacks.onExit({
    exitCode: 999,
    signal: "😀".repeat(1_000),
    error: "😀".repeat(1_000),
  });
  const result = manager.readJob("owner", job.jobId);
  assert.equal(result.status, "failed");
  assert.equal(result.exitCode, null);
  assert.ok(Buffer.byteLength(result.signal!) <= 512);
  assert.ok(Buffer.byteLength(result.error!) <= 512);
});

test("null timeout is invalid even when bypassing a schema", () => {
  const manager = new JobManager({ runner: new MockRunner() });
  assert.throws(
    () =>
      manager.execute("owner", {
        ...request(),
        timeoutMs: null,
      } as unknown as ExecuteInput),
    hasCode("INVALID_INPUT"),
  );
});
