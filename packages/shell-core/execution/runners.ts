import type {
  Runner,
  RunnerCallbacks,
  RunnerHandle,
  RunnerJob,
} from "./types.ts";

/** Safe default. Construction of a JobManager never enables command execution. */
export class DisabledRunner implements Runner {
  readonly enabled = false;
  run(_job: RunnerJob, _callbacks: RunnerCallbacks): RunnerHandle {
    throw new Error("Command execution is disabled");
  }
}

/** Deterministic demonstration runner. It never evaluates or spawns the command. */
export class MockRunner implements Runner {
  readonly enabled = true;
  private readonly delayMs: number;
  private readonly stdout: string;
  private readonly stderr: string;
  private readonly exitCode: number;

  constructor(
    options: {
      delayMs?: number;
      stdout?: string;
      stderr?: string;
      exitCode?: number;
    } = {},
  ) {
    this.delayMs = options.delayMs ?? 5;
    this.stdout = options.stdout ?? "Mock runner: no command was executed.\n";
    this.stderr = options.stderr ?? "";
    this.exitCode = options.exitCode ?? 0;
    if (
      !Number.isInteger(this.delayMs) ||
      this.delayMs < 0 ||
      this.delayMs > 300_000 ||
      !Number.isInteger(this.exitCode) ||
      this.exitCode < 0 ||
      this.exitCode > 255 ||
      typeof this.stdout !== "string" ||
      typeof this.stderr !== "string" ||
      Buffer.byteLength(this.stdout) + Buffer.byteLength(this.stderr) >
        1_048_576
    ) {
      throw new TypeError("Invalid mock runner options");
    }
  }

  run(_job: RunnerJob, callbacks: RunnerCallbacks): RunnerHandle {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      callbacks.onOutput("stdout", this.stdout);
      callbacks.onOutput("stderr", this.stderr);
      callbacks.onExit({ exitCode: this.exitCode });
    }, this.delayMs);
    return {
      cancel() {
        if (done) return;
        done = true;
        clearTimeout(timer);
        callbacks.onExit({ exitCode: null, signal: "MOCK_CANCEL" });
      },
    };
  }
}
