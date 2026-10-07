import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const reportPath = process.argv[2];
if (!reportPath)
  throw new Error(
    "Pass the JSON report from original Radio's test:celld --keep-state run",
  );
const report = JSON.parse(await readFile(resolvePath(reportPath), "utf8"));
assert.equal(report.status, "passed");
assert.equal(report.backend, "sqlite");
assert.match(report.bucket, /^sqlite:\/\/\//u);
assert.match(report.trackId, /^[0-9a-f-]{36}$/u);
assert.match(report.audioSha256, /^[0-9a-f]{64}$/u);
const sourceDatabase = new URL(report.bucket).pathname;
const root = fileURLToPath(new URL("..", import.meta.url));
const state = await mkdtemp(join(tmpdir(), "tea-radio-source-cutover-"));
const targetDatabase = join(state, "objects.sqlite3");
const bucket = `sqlite://${targetDatabase}`;
const binary = process.env.CELLD_BIN ?? "celld";
const password = randomBytes(24).toString("hex");
const environment = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("CELLD_")),
  ),
  NODE_ENV: "production",
  CELLD_BIN: binary,
  CELLD_BUCKET: bucket,
  CELLD_DURABILITY: "bucket",
  CELLD_WATCH: join(state, "replica"),
  CELLD_INTERNAL_ADDR: "127.0.0.1:0",
  CELLD_VAR_RADIO_PASSWORD: password,
  CELLD_VAR_RADIO_SESSION_SECRET: randomBytes(32).toString("hex"),
  CELLD_ESBUILD: createRequire(import.meta.url).resolve("esbuild/bin/esbuild"),
  RADIO_CELLD_DEPLOY_CONFIG: "wrangler.celld-cutover.jsonc",
};
let runtime;
let runtimeLogs = "";
let browser;
let passed = false;

function command(args, env = environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), {
      cwd: root,
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
            new Error(`${args[0]} exited ${code}\n${output.slice(-12000)}`),
          ),
    );
  });
}

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

async function start(origin) {
  let startupError;
  runtime = spawn("sh", ["scripts/start-celld.sh"], {
    cwd: root,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  runtime.stdout.on("data", (chunk) => (runtimeLogs += chunk));
  runtime.stderr.on("data", (chunk) => (runtimeLogs += chunk));
  runtime.once("error", (error) => (startupError = error));
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (startupError) throw startupError;
    if (runtime.exitCode !== null || runtime.signalCode !== null)
      throw new Error(
        `Celld exited during startup\n${runtimeLogs.slice(-12000)}`,
      );
    try {
      const response = await fetch(origin, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
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

try {
  const listed = await command([
    binary,
    "r2",
    "list",
    "radio-tracks",
    "--bucket",
    report.bucket,
    "--all",
    "--json",
  ]);
  const matches = listed
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line).key)
    .map((key) =>
      new RegExp(`^rooms/([^/]+)/tracks/${report.trackId}$`, "u").exec(key),
    )
    .filter(Boolean);
  assert.equal(matches.length, 1, "Source smoke track must occur in one room");
  const roomSlug = matches[0][1];

  await command(["sqlite3", sourceDatabase, `.backup '${targetDatabase}'`]);
  const origin = `http://127.0.0.1:${await freePort()}`;
  environment.CELLD_ADDR = new URL(origin).host;
  await start(origin);

  const login = await fetch(`${origin}/join`, {
    method: "POST",
    body: new URLSearchParams({
      name: "Transfer listener",
      password,
      roomSlug: "cozy",
    }),
    redirect: "manual",
  });
  assert.equal(login.status, 303);
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie);
  const request = (path, init = {}) =>
    fetch(new URL(path, origin), {
      ...init,
      headers: { ...init.headers, Cookie: cookie },
      signal: AbortSignal.timeout(20_000),
    });
  assert.match(await (await request("/")).text(), new RegExp(roomSlug, "u"));
  assert.equal((await request(`/rooms/${roomSlug}`)).status, 200);
  const mediaPath = `/media/${roomSlug}/${report.trackId}`;
  const head = await request(mediaPath, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(report.sizeBytes));
  assert.equal(head.headers.get("content-type"), "audio/wav");
  const media = await request(mediaPath);
  assert.equal(media.status, 200);
  const bytes = Buffer.from(await media.arrayBuffer());
  assert.equal(bytes.length, report.sizeBytes);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    report.audioSha256,
  );
  const suffix = await request(mediaPath, {
    headers: { Range: "bytes=-33" },
  });
  assert.equal(suffix.status, 206);
  assert.deepEqual(
    Buffer.from(await suffix.arrayBuffer()),
    bytes.subarray(-33),
  );

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const separator = cookie.indexOf("=");
  await context.addCookies([
    {
      name: cookie.slice(0, separator),
      value: cookie.slice(separator + 1),
      url: origin,
    },
  ]);
  const page = await context.newPage();
  await page.goto(`${origin}/rooms/${roomSlug}`);
  const snapshot = await page.evaluate(
    (slug) =>
      new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://${location.host}/ws/${slug}`);
        const timer = setTimeout(
          () => reject(new Error("Room state timed out")),
          20_000,
        );
        socket.addEventListener("open", () =>
          socket.send(
            JSON.stringify({ type: "JOIN", clientId: "cutover-check" }),
          ),
        );
        socket.addEventListener("message", ({ data }) => {
          const frame = JSON.parse(data);
          if (frame.type === "ROOM_STATE" || frame.type === "ERROR") {
            clearTimeout(timer);
            socket.close();
            if (frame.type === "ERROR") reject(new Error(frame.message));
            else resolve(frame.snapshot);
          }
        });
      }),
    roomSlug,
  );
  assert.equal(
    snapshot.tracks.find((track) => track.id === report.trackId)?.title,
    "Persisted smoke",
  );
  assert.equal(snapshot.volume, 0.42);
  assert.equal(snapshot.playback.type, "paused");
  assert.equal(snapshot.playback.trackId, report.trackId);
  assert.equal(snapshot.playback.trackTimeSeconds, 1.25);
  passed = true;
  console.log(
    JSON.stringify({
      ok: true,
      sourceWorker: "radio",
      teaWorker: "radio",
      roomSlug,
      trackId: report.trackId,
      bytes: bytes.length,
      sha256: report.audioSha256,
      queue: true,
      playback: true,
      range: true,
    }),
  );
} catch (error) {
  console.error(error);
  console.error(runtimeLogs.slice(-12000));
  console.error(`Disposable copy retained at ${state}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stop();
  if (passed) await rm(state, { recursive: true, force: true });
}
