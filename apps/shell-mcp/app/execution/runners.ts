import type { Runner } from "./types.ts";

/** Safe default. Creating a job manager never enables command execution. */
export function createDisabledRunner(): Runner {
  return {
    enabled: false,
    run() {
      throw new Error("Command execution is disabled");
    },
  };
}

/** Deterministic demonstration runner. It never evaluates or spawns the command. */
export function createMockRunner(
  options: {
    delayMs?: number;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
  } = {},
): Runner {
  const delayMs = options.delayMs ?? 5;
  const stdout = options.stdout ?? "Mock runner: no command was executed.\n";
  const stderr = options.stderr ?? "";
  const exitCode = options.exitCode ?? 0;
  if (
    !Number.isInteger(delayMs) ||
    delayMs < 0 ||
    delayMs > 300_000 ||
    !Number.isInteger(exitCode) ||
    exitCode < 0 ||
    exitCode > 255 ||
    typeof stdout !== "string" ||
    typeof stderr !== "string" ||
    Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 1_048_576
  ) {
    throw new TypeError("Invalid mock runner options");
  }

  return {
    enabled: true,
    run(_job, callbacks) {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        callbacks.onOutput("stdout", stdout);
        callbacks.onOutput("stderr", stderr);
        callbacks.onExit({ exitCode });
      }, delayMs);
      return {
        cancel() {
          if (done) return;
          done = true;
          clearTimeout(timer);
          callbacks.onExit({ exitCode: null, signal: "MOCK_CANCEL" });
        },
      };
    },
  };
}
