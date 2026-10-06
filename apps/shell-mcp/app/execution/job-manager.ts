import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  statSync,
  writeSync,
} from "node:fs";
import { DisabledRunner } from "./runners.ts";
import { JobError } from "./types.ts";
import type {
  ExecuteInput,
  ExecuteResult,
  JobSnapshot,
  JobStatus,
  OutputStream,
  Runner,
  RunnerExit,
  RunnerHandle,
  StopReason,
} from "./types.ts";

interface JobManagerOptions {
  journalFile?: string;
  runner?: Runner;
  maxConcurrent?: number;
  maxJobs?: number;
  retentionMs?: number;
  maxOutputBytes?: number;
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
}

interface RecordState {
  jobId: string;
  ownerId: string;
  key: string;
  fingerprint: string;
  status: JobStatus;
  createdAt: number;
  finishedAt: number | null;
  expiresAt: number | null;
  timeoutMs: number;
  stopReason: StopReason | null;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  stdout: Buffer;
  stderr: Buffer;
  stdoutBytes: number;
  stderrBytes: number;
  receivedBytes: number;
  truncated: boolean;
  active: boolean;
  handle?: RunnerHandle;
  timer?: ReturnType<typeof setTimeout>;
}

const MAX_COMMAND_BYTES = 16_384;
const MAX_OWNER_BYTES = 1_024;
const MAX_TEXT_BYTES = 512;
const MAX_OUTPUT_PREALLOCATION = 64 * 1_024 * 1_024;

function integer(
  name: string,
  value: number,
  min: number,
  max: number,
): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new JobError(
      "INVALID_INPUT",
      `${name} must be an integer from ${min} to ${max}`,
    );
  }
  return value;
}

function validateOwner(ownerId: unknown): asserts ownerId is string {
  if (
    typeof ownerId !== "string" ||
    ownerId.length === 0 ||
    Buffer.byteLength(ownerId) > MAX_OWNER_BYTES ||
    ownerId.includes("\0")
  ) {
    throw new JobError(
      "INVALID_INPUT",
      "A valid authenticated owner is required",
    );
  }
}

/** Decode byte-limited text without making malformed UTF-8 expand the response budget. */
function boundedText(bytes: Uint8Array | string, maxBytes: number): string {
  const text =
    typeof bytes === "string"
      ? bytes.slice(0, maxBytes)
      : Buffer.from(bytes).toString("utf8");
  const encoded = Buffer.from(text, "utf8");
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(
    encoded.subarray(0, maxBytes),
    { stream: true },
  );
}

/** In-memory lifecycle manager. There is deliberately no queue and no retry loop. */
export class JobManager {
  private readonly runner: Runner;
  private readonly maxConcurrent: number;
  private readonly maxJobs: number;
  private readonly retentionMs: number;
  private readonly maxOutputBytes: number;
  private readonly defaultTimeoutMs: number;
  private readonly maxTimeoutMs: number;
  private readonly jobs = new Map<string, RecordState>();
  private readonly idempotency = new Map<string, string>();
  private activeCount = 0;
  private closed = false;
  private readonly journalFile?: string;

  constructor(options: JobManagerOptions = {}) {
    this.runner = options.runner ?? new DisabledRunner();
    if (
      typeof this.runner.enabled !== "boolean" ||
      typeof this.runner.run !== "function"
    ) {
      throw new JobError("INVALID_INPUT", "Invalid runner");
    }
    this.maxJobs = integer("maxJobs", options.maxJobs ?? 128, 1, 1_024);
    this.maxConcurrent = integer(
      "maxConcurrent",
      options.maxConcurrent ?? Math.min(2, this.maxJobs),
      1,
      Math.min(16, this.maxJobs),
    );
    this.retentionMs = integer(
      "retentionMs",
      options.retentionMs ?? 900_000,
      1,
      86_400_000,
    );
    this.maxOutputBytes = integer(
      "maxOutputBytes",
      options.maxOutputBytes ?? 65_536,
      1,
      1_048_576,
    );
    // Two fixed buffers per job; no unbounded list of tiny output chunks.
    if (this.maxJobs * this.maxOutputBytes * 2 > MAX_OUTPUT_PREALLOCATION) {
      throw new JobError(
        "INVALID_INPUT",
        "Total output buffer allocation must not exceed 64 MiB",
      );
    }
    this.maxTimeoutMs = integer(
      "maxTimeoutMs",
      options.maxTimeoutMs ?? 300_000,
      1,
      300_000,
    );
    this.defaultTimeoutMs = integer(
      "defaultTimeoutMs",
      options.defaultTimeoutMs ?? Math.min(30_000, this.maxTimeoutMs),
      1,
      this.maxTimeoutMs,
    );
    this.journalFile = options.journalFile;
    if (this.journalFile && existsSync(this.journalFile)) {
      if (statSync(this.journalFile).size > 8_388_608)
        throw new Error("Journal full; operator reconciliation required");
      for (const line of readFileSync(this.journalFile, "utf8")
        .split("\n")
        .filter(Boolean)) {
        const entry = JSON.parse(line);
        const record: RecordState = {
          ...entry,
          status: "unknown",
          finishedAt: null,
          expiresAt: null,
          stopReason: null,
          exitCode: null,
          signal: null,
          error:
            "Outcome unknown after restart; do not replay. Inspect side effects before issuing a new command.",
          stdout: Buffer.alloc(0),
          stderr: Buffer.alloc(0),
          stdoutBytes: 0,
          stderrBytes: 0,
          receivedBytes: 0,
          truncated: false,
          active: false,
        };
        this.jobs.set(record.jobId, record);
        this.idempotency.set(record.key, record.jobId);
      }
    }
  }

  execute(ownerId: string, input: ExecuteInput): ExecuteResult {
    validateOwner(ownerId);
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new JobError("INVALID_INPUT", "Execute input must be an object");
    }
    const allowed = new Set(["command", "cwd", "idempotencyKey", "timeoutMs"]);
    if (Object.keys(input).some((key) => !allowed.has(key))) {
      throw new JobError("INVALID_INPUT", "Unknown execute input field");
    }
    if (
      typeof input.command !== "string" ||
      input.command.trim().length === 0 ||
      input.command.includes("\0") ||
      Buffer.byteLength(input.command) > MAX_COMMAND_BYTES
    ) {
      throw new JobError(
        "INVALID_INPUT",
        "Command must be nonempty, NUL-free and at most 16384 UTF-8 bytes",
      );
    }
    if (
      typeof input.idempotencyKey !== "string" ||
      !/^[A-Za-z0-9._:-]{1,128}$/.test(input.idempotencyKey)
    ) {
      throw new JobError(
        "INVALID_INPUT",
        "idempotencyKey must be 1–128 ASCII letters, digits, periods, underscores, colons or hyphens",
      );
    }
    if (
      input.cwd !== undefined &&
      (typeof input.cwd !== "string" ||
        !input.cwd.startsWith("/") ||
        input.cwd.includes("\0") ||
        Buffer.byteLength(input.cwd) > 4096)
    )
      throw new JobError(
        "INVALID_INPUT",
        "cwd must be an absolute NUL-free path of at most 4096 bytes",
      );
    const timeoutMs = integer(
      "timeoutMs",
      input.timeoutMs === undefined ? this.defaultTimeoutMs : input.timeoutMs,
      1,
      this.maxTimeoutMs,
    );
    const key = JSON.stringify([ownerId, input.idempotencyKey]);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([input.command, input.cwd ?? null, timeoutMs]))
      .digest("hex");
    this.pruneExpired();
    const priorId = this.idempotency.get(key);
    if (priorId) {
      const prior = this.jobs.get(priorId)!;
      if (prior.fingerprint !== fingerprint) {
        throw new JobError(
          "IDEMPOTENCY_CONFLICT",
          "This idempotency key was already used with different input",
        );
      }
      return { job: this.snapshot(prior), reused: true };
    }
    if (this.closed || !this.runner.enabled)
      throw new JobError("RUNNER_DISABLED", "Command execution is disabled");
    if (this.activeCount >= this.maxConcurrent) {
      throw new JobError(
        "CAPACITY",
        "All execution slots are occupied; no job was queued or started",
      );
    }
    if (
      [...this.jobs.values()].filter((record) => record.status !== "unknown")
        .length >= this.maxJobs
    ) {
      throw new JobError(
        "CAPACITY",
        "Retained job capacity reached; no job was queued or started",
      );
    }
    const record: RecordState = {
      jobId: randomUUID(),
      ownerId,
      key,
      fingerprint,
      status: "running",
      createdAt: Date.now(),
      finishedAt: null,
      expiresAt: null,
      timeoutMs,
      stopReason: null,
      exitCode: null,
      signal: null,
      error: null,
      stdout: Buffer.alloc(this.maxOutputBytes),
      stderr: Buffer.alloc(this.maxOutputBytes),
      stdoutBytes: 0,
      stderrBytes: 0,
      receivedBytes: 0,
      truncated: false,
      active: true,
    };
    // Reserve both identity and slot before calling user-supplied runner code.
    if (this.journalFile) {
      const fd = openSync(this.journalFile, "a", 0o600);
      try {
        if (statSync(this.journalFile).size > 8_388_608)
          throw new JobError(
            "CAPACITY",
            "Journal full; operator reconciliation required",
          );
        writeSync(
          fd,
          JSON.stringify({
            jobId: record.jobId,
            ownerId: record.ownerId,
            key: record.key,
            fingerprint: record.fingerprint,
            createdAt: record.createdAt,
            timeoutMs: record.timeoutMs,
          }) + "\n",
        );
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    }
    this.jobs.set(record.jobId, record);
    this.idempotency.set(key, record.jobId);
    this.activeCount += 1;
    record.timer = setTimeout(
      () => this.requestStop(record, "timeout"),
      timeoutMs,
    );
    record.timer.unref();
    let handle: RunnerHandle;
    try {
      handle = this.runner.run(
        Object.freeze({
          jobId: record.jobId,
          command: input.command,
          cwd: input.cwd,
          timeoutMs,
        }),
        {
          onOutput: (stream, data) => this.appendOutput(record, stream, data),
          onExit: (exit) => this.finish(record, exit),
          onUncertain: () => {
            record.status = "unknown";
            record.error =
              "Outcome unknown; cleanup is not confirmed. Do not replay.";
          },
        },
      );
    } catch {
      // A trusted runner that throws is contractually responsible for its own cleanup.
      this.finish(record, { exitCode: null, error: "Runner failed to start" });
      return { job: this.snapshot(record), reused: false };
    }
    if (record.active) {
      record.handle = handle;
      // Covers a trusted runner that synchronously re-enters manager.cancel().
      if (record.stopReason !== null) this.signalStop(record);
    }
    return { job: this.snapshot(record), reused: false };
  }

  readJob(ownerId: string, jobId: string): JobSnapshot {
    return this.snapshot(this.findOwned(ownerId, jobId));
  }

  cancel(ownerId: string, jobId: string): JobSnapshot {
    const record = this.findOwned(ownerId, jobId);
    this.requestStop(record, "cancelled");
    return this.snapshot(record);
  }

  /** Stop accepting new work and request cancellation. Does not assert cleanup completed. */
  close(): void {
    this.closed = true;
    for (const record of this.jobs.values())
      this.requestStop(record, "cancelled");
  }

  async closeAndWait(timeoutMs = 8_000): Promise<void> {
    this.close();
    const deadline = Date.now() + timeoutMs;
    while (this.activeCount > 0) {
      if (Date.now() >= deadline)
        throw new Error("Cleanup not confirmed; outcomes unknown");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  private findOwned(ownerId: string, jobId: string): RecordState {
    validateOwner(ownerId);
    if (
      typeof jobId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        jobId,
      )
    ) {
      throw new JobError("NOT_FOUND", "Job not found");
    }
    this.pruneExpired();
    const record = this.jobs.get(jobId);
    // Deliberately indistinguishable unknown ID / another owner's ID.
    if (!record || record.ownerId !== ownerId)
      throw new JobError("NOT_FOUND", "Job not found");
    return record;
  }

  private requestStop(record: RecordState, reason: StopReason): void {
    if (!record.active || record.stopReason !== null) return;
    record.stopReason = reason;
    if (record.status !== "unknown") record.status = "cancelling";
    if (record.timer) clearTimeout(record.timer);
    this.signalStop(record);
  }

  private signalStop(record: RecordState): void {
    try {
      if (record.stopReason !== null) record.handle?.cancel(record.stopReason);
    } catch {
      // Never release the execution slot merely because cancellation was requested.
      record.error = "Runner cancellation failed; cleanup is not confirmed";
    }
  }

  private appendOutput(
    record: RecordState,
    stream: OutputStream,
    data: string | Uint8Array,
  ): void {
    if (!record.active || (stream !== "stdout" && stream !== "stderr")) return;
    if (typeof data !== "string" && !(data instanceof Uint8Array)) return;
    const incomingBytes =
      typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
    record.receivedBytes = Math.min(
      Number.MAX_SAFE_INTEGER,
      record.receivedBytes + incomingBytes,
    );
    const available =
      this.maxOutputBytes - record.stdoutBytes - record.stderrBytes;
    const keep = Math.min(available, incomingBytes);
    if (incomingBytes > keep) record.truncated = true;
    if (keep === 0) return;
    const target = stream === "stdout" ? record.stdout : record.stderr;
    const offset =
      stream === "stdout" ? record.stdoutBytes : record.stderrBytes;
    let written: number;
    if (typeof data === "string") {
      // Buffer.write never allocates for the full incoming string and preserves UTF-8 boundaries.
      written = target.write(data, offset, keep, "utf8");
      if (written < incomingBytes) record.truncated = true;
    } else {
      target.set(data.subarray(0, keep), offset);
      written = keep;
    }
    if (stream === "stdout") record.stdoutBytes += written;
    else record.stderrBytes += written;
  }

  private finish(record: RecordState, exit: RunnerExit): void {
    if (!record.active) return;
    record.active = false;
    if (record.timer) clearTimeout(record.timer);
    record.timer = undefined;
    record.handle = undefined;
    this.activeCount -= 1;
    record.finishedAt = Date.now();
    record.expiresAt = record.finishedAt + this.retentionMs;
    record.exitCode =
      Number.isSafeInteger(exit?.exitCode) &&
      exit.exitCode !== null &&
      exit.exitCode >= 0 &&
      exit.exitCode <= 255
        ? exit.exitCode
        : null;
    record.signal =
      typeof exit?.signal === "string"
        ? boundedText(exit.signal, MAX_TEXT_BYTES)
        : null;
    if (typeof exit?.error === "string")
      record.error = boundedText(exit.error, MAX_TEXT_BYTES);
    record.status =
      record.stopReason === "timeout"
        ? "timed_out"
        : record.stopReason === "cancelled"
          ? "cancelled"
          : record.exitCode === 0 && !record.error && !record.signal
            ? "succeeded"
            : "failed";
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [id, record] of this.jobs) {
      if (
        !record.active &&
        record.expiresAt !== null &&
        record.expiresAt <= now
      ) {
        this.jobs.delete(id);
        this.idempotency.delete(record.key);
      }
    }
  }

  private snapshot(record: RecordState): JobSnapshot {
    return {
      jobId: record.jobId,
      status: record.status,
      createdAt: new Date(record.createdAt).toISOString(),
      finishedAt:
        record.finishedAt === null
          ? null
          : new Date(record.finishedAt).toISOString(),
      expiresAt:
        record.expiresAt === null
          ? null
          : new Date(record.expiresAt).toISOString(),
      timeoutMs: record.timeoutMs,
      stopReason: record.stopReason,
      exitCode: record.exitCode,
      signal: record.signal,
      error: record.error,
      stdout: boundedText(
        record.stdout.subarray(0, record.stdoutBytes),
        record.stdoutBytes,
      ),
      stderr: boundedText(
        record.stderr.subarray(0, record.stderrBytes),
        record.stderrBytes,
      ),
      output: {
        retainedBytes: record.stdoutBytes + record.stderrBytes,
        receivedBytes: record.receivedBytes,
        limitBytes: this.maxOutputBytes,
        truncated: record.truncated,
      },
    };
  }
}
