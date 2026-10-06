import { spawn } from "node:child_process";
import type {
  Runner,
  RunnerJob,
  RunnerCallbacks,
  RunnerHandle,
} from "./execution/types.ts";

/** Only the fixed root-owned helper can launch units; never accepts auth data. */
export function createSystemdRunner(helperPath: string): Runner {
  return {
    enabled: true,
    run(job: RunnerJob, callbacks: RunnerCallbacks): RunnerHandle {
      const child = spawn("/usr/bin/sudo", ["-n", helperPath], {
        env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let buffer = "",
        finished = false;
      child.stdin.on("error", () => {});
      child.stderr.resume(); // Helper diagnostics are never exposed to clients.
      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        if (buffer.length > 262144) {
          child.stdin.destroy();
          return;
        }
        let end: number;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          try {
            const event = JSON.parse(line);
            if (event.stream === "stdout" || event.stream === "stderr")
              callbacks.onOutput(
                event.stream,
                Buffer.from(event.data, "base64"),
              );
            if (event.done === true && !finished) {
              finished = true;
              callbacks.onExit({
                exitCode: event.exitCode,
                ...(event.error
                  ? {
                      error:
                        "Execution outcome unknown; cleanup could not be verified",
                    }
                  : {}),
              });
            }
          } catch {
            child.stdin.destroy();
          }
        }
      });
      // A broken helper is NOT proof of cgroup cleanup: retain capacity and error
      // until control restart reconciles via unit timeout; never replay the job.
      child.on("error", () => {
        if (!finished) {
          finished = true;
          callbacks.onExit({
            exitCode: null,
            error: "Helper could not start; no command launched",
          });
        }
      });
      child.on("close", () => {
        child.stdin.destroy();
        if (!finished) callbacks.onUncertain?.();
      });
      child.stdin.write(
        JSON.stringify({
          command: job.command,
          cwd: job.cwd,
          timeoutMs: job.timeoutMs,
        }) + "\n",
      );
      return {
        cancel() {
          if (!finished && !child.stdin.destroyed) child.stdin.end("cancel\n");
        },
      };
    },
  };
}
