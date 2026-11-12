import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const teaRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = resolvePath(
  process.env.REF_SOURCE_ROOT ?? join(teaRoot, "../../../ref"),
);
const state = await mkdtemp(join(tmpdir(), "tea-ref-source-archive-"));
const password = randomBytes(32).toString("hex");
const binary = process.env.CELLD_BIN ?? "celld";
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==",
  "base64",
);
let runtime;
let runtimeLogs = "";
let browser;
let authOrigin;

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function environment(name, port) {
  const base = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("CELLD_")),
    ),
    CELLD_BUCKET: `sqlite://${join(state, name, "objects.sqlite3")}`,
    CELLD_WATCH: join(state, name, "replica"),
    CELLD_ADDR: `127.0.0.1:${port}`,
    CELLD_INTERNAL_ADDR: "127.0.0.1:0",
    CELLD_DURABILITY: "bucket",
    CELLD_ESBUILD: join(teaRoot, "../../node_modules/.bin/esbuild"),
  };
  return name === "source"
    ? { ...base, CELLD_VAR_REF_PASSWORD: password }
    : {
        ...base,
        CELLD_VAR_AUTH_ISSUER: authOrigin,
        CELLD_VAR_AUTH_CLIENT_ID: "ref-local-browser",
        CELLD_VAR_AUTH_PROJECT_ID: "ref-local-project",
        CELLD_VAR_AUTH_ORGANIZATION_ID: "ref-local-org",
        CELLD_VAR_AUTH_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
        CELLD_VAR_AUTH_INTROSPECTION_CLIENT_ID: "ref-local-resource",
        CELLD_VAR_AUTH_INTROSPECTION_SECRET: "ref-local-resource-secret",
      };
}

function command(cwd, env, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), {
      cwd,
      env,
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

async function start(cwd, env, origin, name) {
  runtimeLogs = "";
  let startupError;
  runtime = spawn(binary, ["--no-control-plane"], {
    cwd,
    env,
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
      const response =
        name === "source"
          ? await fetch(`${origin}/login`, {
              method: "POST",
              body: new URLSearchParams({ password }),
              redirect: "manual",
              signal: AbortSignal.timeout(2_000),
            })
          : await fetch(`${origin}/health`, {
              signal: AbortSignal.timeout(2_000),
            });
      if (name === "source" ? response.status === 303 : response.ok) return;
    } catch {}
    await delay(200);
  }
  throw new Error(`Celld did not become ready\n${runtimeLogs.slice(-12000)}`);
}

async function stop() {
  if (!runtime?.pid || runtime.exitCode !== null || runtime.signalCode !== null)
    return;
  const child = runtime;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  process.kill(-child.pid, "SIGKILL");
  await Promise.race([
    exited,
    delay(10_000).then(() => {
      throw new Error("Celld did not exit after SIGKILL");
    }),
  ]);
  runtime = undefined;
}

async function open(name, root, selectedPort) {
  const port = selectedPort ?? (await freePort());
  const origin = `http://127.0.0.1:${port}`;
  const env = environment(name, port);
  await command(root, env, [
    binary,
    "deploy",
    ".",
    "--bucket",
    env.CELLD_BUCKET,
  ]);
  await start(root, env, origin, name);
  return { origin, env };
}

async function archive(root, instance, action, path) {
  await command(
    root,
    root === sourceRoot
      ? { ...instance.env, REF_URL: instance.origin, REF_PASSWORD: password }
      : {
          ...instance.env,
          REF_URL: instance.origin,
          REF_ACCESS_TOKEN_FILE: join(state, "tea-token"),
        },
    [process.execPath, "scripts/archive.mjs", action, path],
  );
}

try {
  await command(sourceRoot, process.env, ["npm", "run", "build"]);
  await command(teaRoot, process.env, ["npm", "run", "build"]);
  const source = await open("source", sourceRoot);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(source.origin);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Enter" }).click();
  await page.getByRole("heading", { name: "Boards" }).waitFor();
  await page.locator("input[name=title]").fill("Transfer board");
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/\/boards\/[0-9a-f-]+/);
  await page.locator("#connection.online").waitFor();
  await page.locator("#file-input").setInputFiles({
    name: "transfer.png",
    mimeType: "image/png",
    buffer: image,
  });
  await page.locator(".board-item img[src]").waitFor();
  await page.locator("#link-menu summary").click();
  await page.locator("#link-url").fill("https://example.com/");
  await page.locator("#link-form button").click();
  await page.locator(".link-item").waitFor({ timeout: 20_000 });
  await page.close();
  await browser.close();
  browser = undefined;

  const originalArchive = join(state, "source-archive");
  await archive(sourceRoot, source, "backup", originalArchive);
  await stop();

  const teaPort = await freePort();
  const authPort = await freePort();
  authOrigin = `http://127.0.0.1:${authPort}`;
  const auth = spawn(process.execPath, ["packages/dev-auth/server.mjs"], {
    cwd: join(teaRoot, "../.."),
    env: {
      ...process.env,
      HARRHY_DEV_AUTH_PORT: String(authPort),
      HARRHY_DEV_AUTH_ORIGIN: authOrigin,
      HARRHY_DEV_AUTH_CALLBACK: `http://127.0.0.1:${teaPort}/auth/callback`,
    },
    stdio: "ignore",
  });
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        if ((await fetch(`${authOrigin}/.well-known/openid-configuration`)).ok)
          break;
      } catch {}
      if (attempt === 49) throw new Error("Local Jack Auth did not start");
      await delay(100);
    }
    await command(
      join(teaRoot, "../.."),
      {
        ...process.env,
        HARRHY_DEV_AUTH_ORIGIN: authOrigin,
        HARRHY_DEV_AUTH_CALLBACK: `http://127.0.0.1:${teaPort}/auth/callback`,
      },
      [
        process.execPath,
        "packages/dev-auth/token.mjs",
        join(state, "tea-token"),
      ],
    );
    const tea = await open("tea", teaRoot, teaPort);
    await archive(teaRoot, tea, "restore", originalArchive);
    await archive(teaRoot, tea, "restore", originalArchive);
    const teaArchive = join(state, "tea-archive");
    await archive(teaRoot, tea, "backup", teaArchive);
    const original = JSON.parse(
      await readFile(join(originalArchive, "manifest.json"), "utf8"),
    );
    const restored = JSON.parse(
      await readFile(join(teaArchive, "manifest.json"), "utf8"),
    );
    delete original.createdAt;
    delete restored.createdAt;
    assert.deepEqual(restored, original);
    assert.equal(original.boards.length, 1);
    assert.equal(original.boards[0].assets.length, 1);
    assert.equal(original.boards[0].links.length, 1);
    console.log(
      JSON.stringify({
        ok: true,
        boards: original.boards.length,
        items: original.boards[0].items.length,
        assets: original.boards[0].assets.length,
        links: original.boards[0].links.length,
        repeatedRestore: true,
      }),
    );
  } finally {
    auth.kill();
  }
} finally {
  await browser?.close();
  await stop();
  await rm(state, { recursive: true, force: true });
}
