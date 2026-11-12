import { spawn } from "node:child_process";

const run = (command, args) =>
  spawn(command, args, {
    stdio: "inherit",
    env: process.env,
  });

const build = run("npm", ["run", "build"]);
const code = await new Promise((resolve) => build.once("exit", resolve));
if (code !== 0) process.exit(code ?? 1);

const auth = run(process.execPath, ["../../packages/dev-auth/server.mjs"]);
const ref = run("wrangler", [
  "dev",
  "--port",
  process.env.REF_DEV_PORT ?? "8787",
]);
let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  auth.kill(signal);
  ref.kill(signal);
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop());
await Promise.race([
  new Promise((resolve) => auth.once("exit", resolve)),
  new Promise((resolve) => ref.once("exit", resolve)),
]);
stop();
await Promise.all([
  new Promise((resolve) =>
    auth.exitCode !== null || auth.signalCode !== null
      ? resolve()
      : auth.once("exit", resolve),
  ),
  new Promise((resolve) =>
    ref.exitCode !== null || ref.signalCode !== null
      ? resolve()
      : ref.once("exit", resolve),
  ),
]);
