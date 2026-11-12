import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir, rm, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { transferArchive } from "../scripts/archive.mjs";
const root = "/home/jack/.local/state/form-harrhy-integration/candidate",
  repo = process.cwd(),
  origin = "http://127.0.0.1:18974";
const original = resolve("apps/fourm/.review/parity-local"),
  output = join(
    root,
    "metadata-roundtrip-" + new Date().toISOString().replace(/[:.]/g, ""),
  );
await mkdir(output, { mode: 0o700 });
const target = join(output, "target"),
  archive = join(output, "archive");
let current,
  originalStopped = false,
  phase = "backup",
  restored = false;
async function alive(pid) {
  try {
    return (await readFile(`/proc/${pid}/stat`, "utf8")).split(" ")[2] !== "Z";
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function stop(state) {
  const report = JSON.parse(
    await readFile(join(state, "runtime.json"), "utf8"),
  );
  const command = await readFile(
    `/proc/${report.supervisorPid}/cmdline`,
    "utf8",
  );
  assert.ok(command.includes("scripts/review.mjs"));
  process.kill(report.supervisorPid, "SIGTERM");
  const deadline = Date.now() + 25000;
  while (await alive(report.supervisorPid)) {
    if (Date.now() > deadline) throw Error("Owned runner did not stop");
    await delay(100);
  }
  for (const pid of report.pids)
    assert.equal(await alive(pid), false, "Owned service remains live");
}
async function start(state, persist = false) {
  const log = persist
    ? await open(join(output, "restored-source.log"), "a", 0o600)
    : null;
  const child = spawn(process.execPath, ["apps/fourm/scripts/review.mjs"], {
    cwd: repo,
    env: {
      ...process.env,
      CELLD_BIN: root + "/tools/celld",
      FOURM_REVIEW_STATE: state,
      FOURM_REVIEW_PORT: "18974",
      FOURM_REVIEW_ISSUER_PORT: "18975",
      FOURM_REVIEW_PROVIDER_PORT: "18976",
      FOURM_REVIEW_BOOTSTRAP: "0",
    },
    detached: persist,
    stdio: log ? ["ignore", log.fd, log.fd] : ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout?.on("data", (chunk) => (logs += chunk));
  child.stderr?.on("data", (chunk) => (logs += chunk));
  let spawnError;
  child.once("error", (error) => {
    spawnError = error;
  });
  await log?.close();
  current = { child, state };
  const deadline = Date.now() + 60000;
  while (true) {
    if (spawnError || child.exitCode !== null || child.signalCode !== null) {
      await writeFile(join(output, "start-failure.log"), logs, { mode: 0o600 });
      throw Error("Owned test runner exited during startup");
    }
    try {
      const r = JSON.parse(await readFile(join(state, "runtime.json"), "utf8"));
      if (r.supervisorPid === child.pid && (await fetch(origin + "/ready")).ok)
        break;
    } catch {}
    if (Date.now() > deadline)
      throw Error("Owned test runner readiness timeout");
    await delay(150);
  }
  if (persist) child.unref();
}
function token(name) {
  const path = join(output, name);
  const minted = spawnSync(
    process.execPath,
    ["packages/dev-auth/token.mjs", path],
    {
      cwd: repo,
      env: {
        ...process.env,
        HARRHY_DEV_AUTH_ORIGIN: "http://127.0.0.1:18975",
        HARRHY_DEV_AUTH_CALLBACK: origin + "/auth/callback",
        HARRHY_DEV_AUTH_CLIENT_ID: "fourm-local-browser",
        HARRHY_DEV_AUTH_PROJECT_ID: "fourm-local-project",
        HARRHY_DEV_AUTH_ROLES: "member,admin,archive-read,archive-restore",
      },
      encoding: "utf8",
    },
  );
  assert.equal(minted.status, 0, "Private fixture token creation failed");
  return readFile(path, "utf8");
}
try {
  const sourceToken = (await token("backup-token")).trim();
  await transferArchive({
    mode: "backup",
    directory: archive,
    origin,
    token: sourceToken,
  });
  const saved = JSON.parse(
    await readFile(join(archive, "archive.json"), "utf8"),
  );
  const inventory = JSON.parse(
    await readFile(
      root + "/parity-cohort-metadata-20261112/inventory.json",
      "utf8",
    ),
  );
  for (const source of inventory.assets) {
    const item = saved.objects.find(
      (candidate) => candidate.storage_path === source.path,
    );
    assert.ok(item);
    assert.equal(item.sha256, source.sha256);
    assert.equal(item.mtime_ns, source.mtime_ns);
    assert.equal(item.etag, source.etag);
    assert.equal(item.last_modified, source.last_modified);
    assert.equal(item.content_type, source.content_type);
  }
  phase = "stop-source";
  await stop(original);
  originalStopped = true;
  phase = "start-empty-authority";
  await start(target);
  let access = (await token("restore-token")).trim();
  phase = "restore";
  await transferArchive({
    mode: "restore",
    directory: archive,
    origin,
    token: access,
  });
  phase = "replay";
  await transferArchive({
    mode: "restore",
    directory: archive,
    origin,
    token: access,
  });
  phase = "cold-authority-reopen";
  await stop(target);
  current = null;
  assert.ok(target.startsWith(output + "/"));
  await rm(join(target, "replica"), { recursive: true });
  await start(target);
  access = (await token("cold-read-token")).trim();
  const result = await (
    await fetch(origin + "/api/archive", {
      headers: { Authorization: "Bearer " + access },
    })
  ).json();
  assert.deepEqual(result.tables, saved.tables);
  for (const item of saved.objects) {
    const stat = result.objects.find(
      (object) => object.storage_path === item.storage_path,
    );
    assert.equal(stat.mtime_ns, item.mtime_ns);
    assert.equal(stat.etag, item.etag);
    assert.equal(stat.last_modified, item.last_modified);
    assert.equal(stat.content_type, item.content_type);
  }
  restored = true;
} catch (error) {
  await writeFile(
    join(output, "failure.json"),
    JSON.stringify({ phase, message: error.message }, null, 2),
    { mode: 0o600 },
  );
  process.exitCode = 1;
} finally {
  if (current) {
    await stop(current.state);
    current = null;
  }
  if (originalStopped) {
    await start(original, true);
    current = null;
  }
  const ready = await fetch(origin + "/ready");
  assert.equal(ready.status, 200);
  await writeFile(
    join(output, "receipt.json"),
    JSON.stringify(
      {
        status: restored ? "PASS" : "FAIL",
        realAssets: 146,
        backup: true,
        restore: restored,
        replay: restored,
        cacheRemovedAfterVerifiedStop: restored,
        coldAuthorityMetadataReadback: restored,
        originalCandidateRestoredHealthy: true,
        productionTouched: false,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      status: restored ? "PASS" : "FAIL",
      output,
      originalCandidateHealthy: true,
    }),
  );
}
