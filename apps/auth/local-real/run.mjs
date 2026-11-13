import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const mode = process.argv[2];
if (!["auth", "artbin"].includes(mode))
  throw new Error("Expected auth or artbin");
const state = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../.local-real",
);
const file = resolve(state, `${mode}.env.json`);
if (!existsSync(file)) throw new Error("Run npm run auth:real:seed first");
const config = JSON.parse(readFileSync(file, "utf8"));
if (mode === "artbin") {
  for (const path of ["artbin", "artbin/public", "artbin/tmp"])
    mkdirSync(resolve(state, path), { recursive: true, mode: 0o700 });
}
const repo = resolve(state, "../../..");
const child = spawn(
  process.execPath,
  mode === "auth"
    ? ["src/server.mjs"]
    : ["--import", "remix/node-tsx", "server.ts"],
  {
    cwd:
      mode === "auth"
        ? resolve(repo, "apps/auth")
        : resolve(repo, "apps/artbin"),
    env: { ...process.env, ...config },
    stdio: "inherit",
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});
