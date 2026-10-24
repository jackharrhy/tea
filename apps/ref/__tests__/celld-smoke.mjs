import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";

const { values } = parseArgs({
  options: {
    output: { type: "string" },
    "keep-state": { type: "boolean", default: false },
  },
});
const root = fileURLToPath(new URL("..", import.meta.url));
const state = await mkdtemp(join(tmpdir(), "tea-ref-celld-smoke-"));
const password = randomBytes(32).toString("hex");
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => resolve(address.port));
  });
});
const origin = `http://127.0.0.1:${port}`;
const binary = process.env.CELLD_BIN ?? "celld";
const environment = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("CELLD_")),
  ),
  CELLD_BUCKET: `sqlite://${join(state, "objects.sqlite3")}`,
  CELLD_WATCH: join(state, "replica"),
  CELLD_ADDR: `127.0.0.1:${port}`,
  CELLD_INTERNAL_ADDR: "127.0.0.1:0",
  CELLD_DURABILITY: "bucket",
  CELLD_VAR_REF_PASSWORD: password,
  CELLD_ESBUILD: join(root, "..", "..", "node_modules", ".bin", "esbuild"),
};
const result = { status: "running", state, checks: [] };
let runtime;
let runtimeLogs = "";
let browser;

function command(args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), {
      cwd: root,
      env: { ...environment, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve(output)
        : reject(
            new Error(
              `${args.join(" ")} exited ${code}\n${output.slice(-12000)}`,
            ),
          ),
    );
  });
}

async function start() {
  runtimeLogs = "";
  let startupError;
  runtime = spawn(binary, ["--no-control-plane"], {
    cwd: root,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  runtime.stdout.on("data", (chunk) => (runtimeLogs += chunk));
  runtime.stderr.on("data", (chunk) => (runtimeLogs += chunk));
  runtime.once("error", (error) => (startupError = error));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (startupError) throw startupError;
    if (runtime.exitCode !== null || runtime.signalCode !== null)
      throw new Error(
        `Celld exited during startup\n${runtimeLogs.slice(-12000)}`,
      );
    try {
      const response = await fetch(`${origin}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ password }),
        redirect: "manual",
        signal: AbortSignal.timeout(2_000),
      });
      if (response.status === 303 && response.headers.has("set-cookie")) return;
    } catch {}
    await delay(200);
  }
  throw new Error(`Celld did not become ready\n${runtimeLogs.slice(-12000)}`);
}

async function stop(signal) {
  if (!runtime?.pid || runtime.exitCode !== null || runtime.signalCode !== null)
    return;
  const child = runtime;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  process.kill(-child.pid, signal);
  let timer;
  try {
    await Promise.race([
      exited,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Celld did not exit after ${signal}`)),
          10_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  runtime = undefined;
}

try {
  result.version = (await command([binary, "--version"])).trim();
  await command([
    binary,
    "diagnose",
    "--bucket",
    environment.CELLD_BUCKET,
    "--no-control-plane",
  ]);
  await command([binary, "deploy", ".", "--bucket", environment.CELLD_BUCKET]);
  await start();
  const smoke = await command([process.execPath, "scripts/smoke.mjs"], {
    REF_SMOKE_URL: origin,
    REF_SMOKE_PASSWORD: password,
  });
  const first = JSON.parse(smoke.trim().split("\n").at(-1));
  assert.equal(first.ok, true);
  result.checks.push(
    "browser smoke: live sync, private media, link preview, cleanup, logout",
  );

  assert.equal(
    runtime.exitCode,
    null,
    "Celld must be alive at the crash boundary",
  );
  await stop("SIGKILL");
  await rm(environment.CELLD_WATCH, { recursive: true, force: true });
  await start();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(origin);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Enter" }).click();
  await page.getByText("Renamed board").waitFor();
  await page.goto(`${origin}/boards/${first.boardId}`);
  await page.locator("#connection.online").waitFor();
  assert.equal(await page.locator(".link-item").count(), 2);
  result.checks.push(
    "SIGKILL and empty-replica restore: board, links, WebSocket",
  );
  result.status = "passed";
} catch (error) {
  result.status = "failed";
  result.error = error instanceof Error ? error.stack : String(error);
  result.runtimeLogTail = runtimeLogs.slice(-12000);
  process.exitCode = 1;
} finally {
  await browser?.close();
  try {
    await stop("SIGKILL");
  } catch (error) {
    result.status = "failed";
    result.error = `${result.error ?? ""}\nCleanup: ${String(error)}`;
    process.exitCode = 1;
  }
  if (values.output) {
    await mkdir(dirname(values.output), { recursive: true });
    await writeFile(values.output, JSON.stringify(result, null, 2) + "\n");
  }
  if (result.status === "passed" && !values["keep-state"])
    await rm(state, { recursive: true, force: true });
  console.log(JSON.stringify(result));
}
