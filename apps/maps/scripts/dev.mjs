import { spawn } from "node:child_process";

const watcher = spawn(
  process.execPath,
  ["scripts/build.mjs", "--watch", "--dev"],
  {
    stdio: "inherit",
  },
);
const server = spawn("cf", ["dev"], { stdio: "inherit" });

function stop() {
  watcher.kill("SIGINT");
  server.kill("SIGINT");
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

server.on("exit", (code) => {
  watcher.kill("SIGINT");
  process.exitCode = code ?? 0;
});
watcher.on("exit", (code) => {
  if (code && !server.killed) {
    server.kill("SIGINT");
    process.exitCode = code;
  }
});
