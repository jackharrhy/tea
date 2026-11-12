import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { transferArchive } from "../scripts/archive.mjs";
import { createInvite, completeInvite } from "./enrollment-browser.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const state = await mkdtemp(join(tmpdir(), "fourm-celld-smoke-"));
const output = join(
  root,
  ".review/evidence",
  new Date().toISOString().replace(/[:.]/g, ""),
);
await mkdir(output, { recursive: true });
const free = () =>
  new Promise((accept, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => accept(port));
    });
  });
const [port, issuerPort, providerPort] = await Promise.all([
  process.env.FOURM_SMOKE_PORT ? Number(process.env.FOURM_SMOKE_PORT) : free(),
  process.env.FOURM_SMOKE_ISSUER_PORT
    ? Number(process.env.FOURM_SMOKE_ISSUER_PORT)
    : free(),
  process.env.FOURM_SMOKE_PROVIDER_PORT
    ? Number(process.env.FOURM_SMOKE_PROVIDER_PORT)
    : free(),
]);
const origin = process.env.FOURM_SMOKE_ORIGIN ?? `http://127.0.0.1:${port}`;
const environment = {
  ...process.env,
  FOURM_REVIEW_STATE: state,
  FOURM_REVIEW_PORT: String(port),
  FOURM_REVIEW_ISSUER_PORT: String(issuerPort),
  FOURM_REVIEW_PROVIDER_PORT: String(providerPort),
  FOURM_REVIEW_ORIGIN: origin,
  FOURM_REVIEW_ISSUER:
    process.env.FOURM_SMOKE_ISSUER ?? `http://127.0.0.1:${issuerPort}`,
  FOURM_REVIEW_USER: "jane",
};
let runner;
let logs = "";
async function start() {
  runner = spawn(process.execPath, ["scripts/review.mjs"], {
    cwd: root,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  runner.stdout.on("data", (value) => (logs += value));
  runner.stderr.on("data", (value) => (logs += value));
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (runner.exitCode !== null) throw new Error("Review runner exited");
    try {
      const result = JSON.parse(
        await readFile(
          join(environment.FOURM_REVIEW_STATE, "runtime.json"),
          "utf8",
        ),
      );
      if (result.status === "RUNNING" && (await fetch(origin + "/ready")).ok)
        return;
    } catch {}
    await delay(150);
  }
  throw new Error("Review runner did not become ready");
}
async function stop() {
  if (!runner || runner.exitCode !== null) return;
  const stopped = new Promise((accept) => runner.once("exit", accept));
  runner.kill("SIGTERM");
  await Promise.race([
    stopped,
    delay(25000).then(() => {
      throw new Error("Review runner did not stop");
    }),
  ]);
  const report = JSON.parse(
    await readFile(
      join(environment.FOURM_REVIEW_STATE, "runtime.json"),
      "utf8",
    ),
  );
  for (const pid of report.pids) {
    let alive = true;
    for (let tries = 0; tries < 100; tries++) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        if (error.code === "ESRCH") {
          alive = false;
          break;
        }
        throw error;
      }
      await delay(100);
    }
    assert.equal(alive, false, "An owned child is still running; retain state");
  }
}
let success = false;
let restoredState;
const tokenPath = join(output, "fixture-access-token");
async function command(script, extra = {}) {
  const child = spawn(process.execPath, [script, ...(extra.arguments ?? [])], {
    cwd: root,
    env: { ...environment, ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (value) => (logs += value));
  child.stderr.on("data", (value) => (logs += value));
  assert.equal(
    await new Promise((accept) => child.once("exit", accept)),
    0,
    `Check failed: ${script}`,
  );
}
async function accessToken(
  roles = "member,admin,archive-read,archive-restore,pages-read,pages-write,media-read,media-write",
) {
  await rm(tokenPath, { force: true });
  await command("../../packages/dev-auth/token.mjs", {
    arguments: [tokenPath],
    HARRHY_DEV_AUTH_ORIGIN: environment.FOURM_REVIEW_ISSUER,
    HARRHY_DEV_AUTH_CALLBACK: origin + "/auth/callback",
    HARRHY_DEV_AUTH_CLIENT_ID: "fourm-local-browser",
    HARRHY_DEV_AUTH_PROJECT_ID: "fourm-local-project",
    HARRHY_DEV_AUTH_ROLES: roles,
  });
  return (await readFile(tokenPath, "utf8")).trim();
}
try {
  await start();
  const browser = spawn(process.execPath, ["__tests__/browser-smoke.mjs"], {
    cwd: root,
    env: {
      ...environment,
      FOURM_TEST_ORIGIN: origin,
      FOURM_TEST_OUTPUT: output,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  browser.stdout.on("data", (value) => (logs += value));
  browser.stderr.on("data", (value) => (logs += value));
  assert.equal(
    await new Promise((accept) => browser.once("exit", accept)),
    0,
    "Actual browser smoke failed",
  );
  const receipt = JSON.parse(
    await readFile(join(output, "browser.json"), "utf8"),
  );
  const publicDirectory = await fetch(origin + "/world/community").then(
    (response) => response.json(),
  );
  assert.equal(publicDirectory.members.length, 2);
  assert.deepEqual(
    await fetch(origin + "/world/binding-check", {
      headers: {
        Cookie: "fourm_session=fixture-not-for-peer",
        Authorization: "Bearer fixture-not-for-peer",
      },
    }).then((response) => response.json()),
    {
      databaseBinding: false,
      mediaBinding: false,
      enrollmentKey: false,
      cookieReceived: false,
      authorizationReceived: false,
    },
  );
  assert.equal(
    (await fetch(origin + "/world/community", { method: "POST" })).status,
    405,
  );
  assert.equal(
    (await fetch(origin + "/internal/auth/enrollments/unknown")).status,
    401,
  );
  const media = await fetch(origin + receipt.results[0].mediaPath);
  const bytes = Buffer.from(await media.arrayBuffer());
  assert.ok(bytes.length > 0);
  let access = await accessToken();
  let cliChecked = false;
  if (process.env.FOURM_CLI_BINARY) {
    await command("__tests__/cli-smoke.mjs", {
      FOURM_TEST_ORIGIN: origin,
      FOURM_ACCESS_TOKEN_FILE: tokenPath,
    });
    cliChecked = true;
  }
  const limited = await accessToken("member,pages-read");
  assert.equal(
    (
      await fetch(origin + "/api/v1/pages", {
        headers: { Authorization: "Bearer " + limited },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(origin + "/api/v1/pages/forbidden", {
        method: "PUT",
        headers: {
          Authorization: "Bearer " + limited,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: "Forbidden write" }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(origin + "/api/v1/media", {
        headers: { Authorization: "Bearer " + limited },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(origin + "/api/v1/me", {
        headers: { Authorization: "Bearer invalid" },
      })
    ).status,
    401,
  );
  const archive = join(output, "native-archive");
  await transferArchive({
    mode: "backup",
    directory: archive,
    origin,
    token: access,
  });
  await stop();
  await rm(join(state, "replica"), { recursive: true, force: true });
  await rm(join(state, "runtime.json"));
  await start();
  for (const result of receipt.results) {
    const thread = await fetch(origin + result.threadPath).then((response) =>
      response.text(),
    );
    assert.ok(thread.includes("A durable reply."));
    assert.equal(
      (await fetch(origin + `/u/jane/p/${result.privatePage}`)).status,
      404,
    );
  }
  assert.deepEqual(
    Buffer.from(
      await (await fetch(origin + receipt.results[0].mediaPath)).arrayBuffer(),
    ),
    bytes,
  );
  assert.equal(
    (
      await fetch(origin + "/world/community").then((response) =>
        response.json(),
      )
    ).members.length,
    2,
  );
  await stop();
  restoredState = await mkdtemp(join(tmpdir(), "fourm-celld-restored-"));
  environment.FOURM_REVIEW_STATE = restoredState;
  environment.FOURM_REVIEW_BOOTSTRAP = "0";
  await start();
  access = await accessToken();
  await transferArchive({
    mode: "restore",
    directory: archive,
    origin,
    token: access,
  });
  await transferArchive({
    mode: "restore",
    directory: archive,
    origin,
    token: access,
  });
  assert.deepEqual(
    Buffer.from(
      await (await fetch(origin + receipt.results[0].mediaPath)).arrayBuffer(),
    ),
    bytes,
  );
  const invitation = await createInvite(origin);
  await stop();
  await rm(join(restoredState, "runtime.json"));
  environment.FOURM_REVIEW_USER = "alex";
  await start();
  const enrollment = await completeInvite({
    origin,
    issuer: environment.FOURM_REVIEW_ISSUER,
    key: await readFile(join(restoredState, "enrollment-key"), "utf8"),
    invite: invitation,
    output,
  });
  await writeFile(
    join(output, "enrollment.json"),
    JSON.stringify(enrollment, null, 2),
  );
  success = true;
  await writeFile(
    join(output, "celld.json"),
    JSON.stringify(
      {
        status: "PASS",
        origin,
        coldRestart: true,
        replicaCacheRemoved: true,
        pagesThreadsMediaPersisted: true,
        nativeServiceBinding: true,
        peerHasNoDatabaseMediaOrEnrollmentKey: true,
        nativeArchiveRestoredToEmptyAuthority: true,
        restoreReplayIdempotent: true,
        originalCliCommandsChecked: cliChecked,
        productionTouched: false,
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: real Celld/browser and cold persistence; evidence ${output}`,
  );
} finally {
  try {
    await stop();
  } finally {
    await writeFile(join(output, "runtime.log"), logs);
  }
  if (success) await rm(state, { recursive: true, force: true });
  if (success && restoredState)
    await rm(restoredState, { recursive: true, force: true });
  await rm(tokenPath, { force: true });
}
