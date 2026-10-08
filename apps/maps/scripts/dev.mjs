import { spawn } from "node:child_process";

const watcher = spawn(
  process.execPath,
  ["scripts/build.mjs", "--watch", "--dev"],
  {
    stdio: "inherit",
  },
);
const args = ["dev", "--config", "wrangler.dev.jsonc", "--port", "8790"];
if (process.env.TEA_MAPS_SERVICE_ORIGIN)
  args.push(
    "--var",
    `MAPS_SERVICE_ORIGIN:${process.env.TEA_MAPS_SERVICE_ORIGIN}`,
  );
if (process.env.TEA_MAPS_COLLABORATION_ORIGIN)
  args.push(
    "--var",
    `MAPS_COLLABORATION_ORIGIN:${process.env.TEA_MAPS_COLLABORATION_ORIGIN}`,
  );
const server = spawn("wrangler", args, { stdio: "inherit" });
const fixtures = spawn("vite", ["--config", "vite.config.ts"], {
  stdio: "inherit",
});

function stop() {
  watcher.kill("SIGINT");
  server.kill("SIGINT");
  fixtures.kill("SIGINT");
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

server.on("exit", (code) => {
  watcher.kill("SIGINT");
  fixtures.kill("SIGINT");
  process.exitCode = code ?? 0;
});
watcher.on("exit", (code) => {
  if (code && !server.killed) {
    server.kill("SIGINT");
    process.exitCode = code;
  }
});
fixtures.on("exit", (code) => {
  if (code && !server.killed) {
    server.kill("SIGINT");
    process.exitCode = code;
  }
});
