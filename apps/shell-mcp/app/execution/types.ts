/** Trusted runner boundary. This API is not a sandbox or an authorization system. */
export type OutputStream = "stdout" | "stderr";
export type StopReason = "cancelled" | "timeout";
export type JobStatus =
  | "running"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "unknown";

export interface ExecuteInput {
  command: string;
  cwd?: string;
  /** Scoped to the authenticated owner; retained for the same lifetime as the job. */
  idempotencyKey: string;
  timeoutMs?: number;
}

export interface RunnerJob {
  readonly jobId: string;
  readonly command: string;
  readonly cwd?: string;
  readonly timeoutMs: number;
}

export interface RunnerExit {
  exitCode: number | null;
  signal?: string | null;
  /** Must not contain credentials or internal implementation details. */
  error?: string;
}

export interface RunnerCallbacks {
  /** Transport loss is not cleanup; keep capacity occupied until reconciliation. */
  onUncertain?(): void;
  onOutput(stream: OutputStream, data: string | Uint8Array): void;
  /** Call exactly once after cleanup. A runner must not emit output after this. */
  onExit(exit: RunnerExit): void;
}

export interface RunnerHandle {
  /** Idempotent; initiate bounded cleanup, then call onExit. Must not throw. */
  cancel(reason: StopReason): void;
}

export interface Runner {
  readonly enabled: boolean;
  /** Return immediately; do not block the event loop. Never automatically retry. */
  run(job: RunnerJob, callbacks: RunnerCallbacks): RunnerHandle;
}

export interface JobSnapshot {
  jobId: string;
  status: JobStatus;
  createdAt: string;
  finishedAt: string | null;
  /** Null until cleanup completes. Reads do not extend this retention period. */
  expiresAt: string | null;
  timeoutMs: number;
  stopReason: StopReason | null;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  stdout: string;
  stderr: string;
  output: {
    /** Raw retained output bytes, shared between stdout and stderr. */
    retainedBytes: number;
    receivedBytes: number;
    limitBytes: number;
    truncated: boolean;
  };
}

export interface ExecuteResult {
  job: JobSnapshot;
  reused: boolean;
}

export type JobErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "CAPACITY"
  | "IDEMPOTENCY_CONFLICT"
  | "RUNNER_DISABLED";

export interface JobError extends Error {
  name: "JobError";
  readonly code: JobErrorCode;
}

export function createJobError(code: JobErrorCode, message: string): JobError {
  return Object.assign(new Error(message), { name: "JobError" as const, code });
}

export function isJobError(error: unknown): error is JobError {
  return error instanceof Error && error.name === "JobError";
}
