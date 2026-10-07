import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { join, resolve as resolvePath } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { parseArgs } from "node:util";
import { createStarterDocument, serializeMap } from "@tea/maps-editor/core";

const teaRoot = fileURLToPath(new URL("../../..", import.meta.url));
const app = fileURLToPath(new URL("..", import.meta.url));
const { values } = parseArgs({
  options: {
    binary: { type: "string", default: process.env.CELLD_BIN ?? "celld" },
    "source-binary": { type: "string" },
    "source-app": {
      type: "string",
      default: resolvePath(teaRoot, "../worldview/apps/collaboration-service"),
    },
    "keep-state": { type: "boolean", default: false },
  },
});
const esbuild = createRequire(import.meta.url).resolve("esbuild/bin/esbuild");
const state = await mkdtemp(join(tmpdir(), "tea-maps-cutover-"));
const secret = randomBytes(32).toString("hex");
const mapId = `cutover-${randomBytes(6).toString("hex")}`;
const secondMapId = `cutover-${randomBytes(6).toString("hex")}`;
const source = serializeMap(createStarterDocument());
const sourceApp = resolvePath(values["source-app"]);
const sourceBinary = values["source-binary"] ?? values.binary;
let runtime;
let comparisonSource;

function binaryVersion(binary) {
  const result = spawnSync(binary, ["--version"], { encoding: "utf8" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function run(cwd, env, args, binary = values.binary) {
  const result = spawnSync(binary, args, {
    cwd,
    env,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `celld ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`,
    );
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function environment(database, replicas, port, secretName) {
  return {
    ...process.env,
    CELLD_BUCKET: `sqlite://${database}`,
    CELLD_WATCH: replicas,
    CELLD_ADDR: `127.0.0.1:${port}`,
    CELLD_INTERNAL_ADDR: "127.0.0.1:0",
    CELLD_DURABILITY: "bucket",
    CELLD_ESBUILD: esbuild,
    [secretName]: secret,
  };
}

function spawnRuntime(cwd, env, label, binary) {
  const log = createWriteStream(join(state, `${label}.log`));
  const child = spawn(binary, ["--no-control-plane"], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return child;
}

async function stopChild(child, signal = "SIGTERM") {
  if (!child) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill(signal);
  const timeout = setTimeout(() => child.kill("SIGKILL"), 30_000);
  try {
    await new Promise((resolve) => child.once("exit", resolve));
  } finally {
    clearTimeout(timeout);
  }
}

async function start(cwd, env, label, binary = values.binary) {
  runtime = spawnRuntime(cwd, env, label, binary);
}

async function stop(signal = "SIGTERM") {
  const child = runtime;
  runtime = undefined;
  await stopChild(child, signal);
}

async function ready(origin, child = runtime) {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`Celld exited; see ${state}`);
    try {
      const response = await fetch(`${origin}/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.status > 0) return;
    } catch {}
    await delay(200);
  }
  throw new Error(`Celld did not become ready; see ${state}`);
}

function compareCells(
  hostedDatabase,
  sourceOrigin,
  targetOrigin,
  strict = false,
) {
  const result = spawnSync(
    process.execPath,
    [
      join(app, "scripts/compare-cells.mjs"),
      "--maps-db",
      hostedDatabase,
      "--source-origin",
      sourceOrigin,
      "--target-origin",
      targetOrigin,
      ...(strict ? ["--require-source-checkpoints"] : []),
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        MAPS_SOURCE_TICKET_SECRET: secret,
        MAPS_TARGET_TICKET_SECRET: secret,
      },
    },
  );
  if (result.error) throw result.error;
  return { exitCode: result.status, report: JSON.parse(result.stdout) };
}

function ticket(targetMapId = mapId) {
  const header = Buffer.from(
    JSON.stringify({ algorithm: "HS256", type: "WVT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      version: 2,
      mapId: targetMapId,
      principalId: "user-1",
      actorId: "user-1",
      role: "owner",
      expiresAt: Date.now() + 300_000,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

async function request(
  origin,
  path,
  method = "GET",
  body,
  targetMapId = mapId,
) {
  const response = await fetch(`${origin}/sync/maps/${targetMapId}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ticket(targetMapId)}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}

const sourceDirectory = join(state, "source");
const targetDirectory = join(state, "target");
const sourceDatabase = join(sourceDirectory, "objects.sqlite3");
const targetDatabase = join(targetDirectory, "objects.sqlite3");
try {
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(targetDirectory, { recursive: true });
  const sourcePort = await availablePort();
  const sourceEnv = environment(
    sourceDatabase,
    join(sourceDirectory, "replicas"),
    sourcePort,
    "CELLD_VAR_WORLDVIEW_REALTIME_TICKET_SECRET",
  );
  run(
    sourceApp,
    sourceEnv,
    ["diagnose", "--bucket", sourceEnv.CELLD_BUCKET, "--no-control-plane"],
    sourceBinary,
  );
  run(
    sourceApp,
    sourceEnv,
    ["deploy", ".", "--bucket", sourceEnv.CELLD_BUCKET],
    sourceBinary,
  );
  await start(sourceApp, sourceEnv, "source", sourceBinary);
  const sourceOrigin = `http://127.0.0.1:${sourcePort}`;
  await ready(sourceOrigin);
  await request(sourceOrigin, "/initialize", "PUT", { source });
  const before = await request(sourceOrigin, "/snapshot");
  assert.equal(before.source, source);
  const checkpoint = await request(sourceOrigin, "/checkpoints", "POST", {
    name: "Before Tea",
  });
  assert.ok(checkpoint.checkpoint?.id);
  const originalCheckpoints = await request(sourceOrigin, "/checkpoints");
  assert.equal(originalCheckpoints.checkpoints.length, 1);
  await request(sourceOrigin, "/initialize", "PUT", { source }, secondMapId);
  const secondBefore = await request(
    sourceOrigin,
    "/snapshot",
    "GET",
    undefined,
    secondMapId,
  );
  assert.equal(secondBefore.source, source);
  await stop();

  const backup = spawnSync(
    "sqlite3",
    [sourceDatabase, `.backup ${targetDatabase}`],
    { encoding: "utf8" },
  );
  if (backup.error) throw backup.error;
  if (backup.status !== 0)
    throw new Error(`SQLite backup failed: ${backup.stderr}`);
  await delay(11_000);

  const targetPort = await availablePort();
  const targetEnv = environment(
    targetDatabase,
    join(targetDirectory, "replicas"),
    targetPort,
    "CELLD_VAR_TEA_MAPS_REALTIME_TICKET_SECRET",
  );
  run(app, targetEnv, [
    "diagnose",
    "--bucket",
    targetEnv.CELLD_BUCKET,
    "--no-control-plane",
  ]);
  const deploy = [
    "deploy",
    "wrangler.celld-cutover.jsonc",
    "--bucket",
    targetEnv.CELLD_BUCKET,
  ];
  run(app, targetEnv, deploy);
  await start(app, targetEnv, "target");
  const targetOrigin = `http://127.0.0.1:${targetPort}`;
  await ready(targetOrigin);
  assert.deepEqual(await request(targetOrigin, "/snapshot"), before);
  assert.deepEqual(
    await request(targetOrigin, "/snapshot", "GET", undefined, secondMapId),
    secondBefore,
  );
  assert.deepEqual(
    await request(targetOrigin, "/checkpoints"),
    originalCheckpoints,
  );
  assert.equal(
    (await request(targetOrigin, `/checkpoints/${checkpoint.checkpoint.id}`))
      .source,
    source,
  );
  const hostedDatabase = join(state, "hosted-maps.db");
  const hosted = new DatabaseSync(hostedDatabase);
  hosted.exec("CREATE TABLE maps(id TEXT PRIMARY KEY)");
  hosted.prepare("INSERT INTO maps(id) VALUES (?)").run(mapId);
  hosted.prepare("INSERT INTO maps(id) VALUES (?)").run(secondMapId);
  hosted.close();
  comparisonSource = spawnRuntime(
    sourceApp,
    sourceEnv,
    "source-compare",
    sourceBinary,
  );
  await ready(sourceOrigin, comparisonSource);
  const matched = compareCells(hostedDatabase, sourceOrigin, targetOrigin);
  assert.equal(matched.exitCode, 0, JSON.stringify(matched.report));
  assert.equal(matched.report.status, "passed");
  assert.equal(matched.report.checkpointSourceMode, "metadata-only");
  assert.equal(matched.report.maps.length, 2);

  await stopChild(comparisonSource);
  comparisonSource = undefined;
  await delay(11_000);
  const sourceTeaEnv = environment(
    sourceDatabase,
    join(sourceDirectory, "replicas"),
    sourcePort,
    "CELLD_VAR_TEA_MAPS_REALTIME_TICKET_SECRET",
  );
  run(app, sourceTeaEnv, [
    "diagnose",
    "--bucket",
    sourceTeaEnv.CELLD_BUCKET,
    "--no-control-plane",
  ]);
  run(app, sourceTeaEnv, [
    "deploy",
    "wrangler.celld-cutover.jsonc",
    "--bucket",
    sourceTeaEnv.CELLD_BUCKET,
  ]);
  comparisonSource = spawnRuntime(
    app,
    sourceTeaEnv,
    "source-tea-compare",
    values.binary,
  );
  await ready(sourceOrigin, comparisonSource);
  const fullMatch = compareCells(
    hostedDatabase,
    sourceOrigin,
    targetOrigin,
    true,
  );
  assert.equal(fullMatch.exitCode, 0, JSON.stringify(fullMatch.report));
  assert.equal(fullMatch.report.status, "passed");
  assert.equal(fullMatch.report.checkpointSourceMode, "full");
  assert.equal(
    fullMatch.report.maps.find((map) => map.mapId === mapId)
      ?.checkpointSourcesCompared,
    1,
  );

  const edited = source.replace("Worldview editor starter", "Tea copied map");
  assert.notEqual(edited, source);
  const replaced = await request(targetOrigin, "/source", "PUT", {
    expectedMapVersion: before.mapVersion,
    expectedSourceSha256: before.sourceSha256,
    source: edited,
  });
  assert.equal(replaced.status, "replaced");
  assert.equal(replaced.map.source, edited);
  await stop("SIGKILL");
  await rm(targetEnv.CELLD_WATCH, { recursive: true, force: true });
  await delay(11_000);
  run(app, targetEnv, deploy);
  await start(app, targetEnv, "restored");
  await ready(targetOrigin);
  const restored = await request(targetOrigin, "/snapshot");
  assert.equal(restored.source, edited);
  assert.equal(restored.mapVersion, before.mapVersion + 1);
  assert.equal(
    (await request(targetOrigin, "/checkpoints")).checkpoints.length,
    2,
  );
  const diverged = compareCells(hostedDatabase, sourceOrigin, targetOrigin);
  assert.equal(diverged.exitCode, 1);
  assert.equal(diverged.report.status, "mismatch");
  assert.equal(
    diverged.report.maps.find((map) => map.mapId === mapId)?.matched,
    false,
  );
  assert.equal(
    diverged.report.maps.find((map) => map.mapId === secondMapId)?.matched,
    true,
  );
  console.log(
    JSON.stringify({
      status: "passed",
      mapId,
      sourceVersion: binaryVersion(sourceBinary),
      targetVersion: binaryVersion(values.binary),
      checks: [
        "original map and checkpoint",
        "stopped SQLite backup",
        "Tea snapshot and checkpoint match",
        "all-map comparator matches two copied cells and detects Tea-only edit",
        "strict comparator matches historical checkpoint bodies on two Tea copies",
        "Tea source edit survives SIGKILL and empty replica restore",
      ],
      state: values["keep-state"] ? state : undefined,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({ status: "failed", state, error: String(error) }),
  );
  process.exitCode = 1;
} finally {
  await stop();
  await stopChild(comparisonSource);
  if (process.exitCode !== 1 && !values["keep-state"])
    await rm(state, { recursive: true, force: true });
}
