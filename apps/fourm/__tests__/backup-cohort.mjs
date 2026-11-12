import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve as absolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { exportSource } from "../scripts/export-source.mjs";
function canonicalTables(tables) {
  return JSON.stringify(
    Object.entries(tables)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([table, rows]) => [
        table,
        rows
          .map((row) =>
            JSON.stringify(
              Object.entries(row).toSorted(([a], [b]) => a.localeCompare(b)),
            ),
          )
          .toSorted(),
      ]),
  );
}
process.umask(0o077);
assert.equal(process.cwd(), "/home/jack/repos/personal/harrhy-fourm-celld");
const root = "/home/jack/.local/state/form-harrhy-integration/candidate";
const cohort = join(root, "parity-cohort-metadata-20261112");
const state = await mkdtemp(join(tmpdir(), "fourm-backup-cohort-"));
const output = join(
  root,
  "backup-cohort-" + new Date().toISOString().replace(/[:.]/g, ""),
);
await mkdir(output, { mode: 0o700 });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const key = randomBytes(32).toString("hex");
const port = await new Promise((done) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const value = s.address().port;
    s.close(() => done(value));
  });
});
const origin = `http://127.0.0.1:${port}`;
let child,
  logs = "",
  phase = "export",
  failed = false;
const environment = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("CELLD_")),
  ),
  CELLD_BUCKET: `sqlite://${join(state, "objects.sqlite3")}`,
  CELLD_WATCH: join(state, "replica"),
  CELLD_DURABILITY: "bucket",
  CELLD_ADDR: `127.0.0.1:${port}`,
  CELLD_INTERNAL_ADDR: "127.0.0.1:0",
  CELLD_ESBUILD: absolute("node_modules/.bin/esbuild"),
};
async function checkpoint(details = {}) {
  await writeFile(
    join(output, "progress.json"),
    JSON.stringify({ phase, ...details, productionTouched: false }, null, 2),
  );
}
function run(args) {
  const c = spawn(join(root, "tools/celld"), args, {
    cwd: state,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  c.stdout.on("data", (p) => (logs += p));
  c.stderr.on("data", (p) => (logs += p));
  return c;
}
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const owned = child;
  const exit = new Promise((done) => owned.once("exit", done));
  owned.kill("SIGTERM");
  const timer = setTimeout(() => {
    if (owned.exitCode === null && owned.signalCode === null)
      owned.kill("SIGKILL");
  }, 30000);
  await exit;
  clearTimeout(timer);
  child = undefined;
}
async function start() {
  child = run(["--no-control-plane"]);
  for (let i = 0; i < 300; i++) {
    assert.equal(child.exitCode, null);
    try {
      if ((await fetch(origin + "/health")).ok) return;
    } catch {}
    await delay(100);
  }
  throw Error("Isolated cohort runtime did not become ready");
}
async function request(path, body, headers = {}) {
  const response = await fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${key}`, ...headers },
    ...(body === undefined ? {} : { body }),
    redirect: "error",
    signal: AbortSignal.timeout(300000),
  });
  if (!response.ok) {
    await writeFile(
      join(output, "http-failure.json"),
      JSON.stringify({
        phase,
        status: response.status,
        body: await response.text(),
      }),
    );
    throw Error(
      `Private cohort fixture HTTP${response.status}; see protected evidence`,
    );
  }
  return response;
}
try {
  await checkpoint();
  const sourceHash = sha(await readFile(join(cohort, "cohort.sqlite3")));
  const inventory = await exportSource({
    database: join(cohort, "cohort.sqlite3"),
    uploads: join(cohort, "uploads"),
    output: join(state, "source"),
  });
  const source = JSON.parse(
    await readFile(join(state, "source/archive.json"), "utf8"),
  );
  assert.equal(source.tables.users.length, 62);
  assert.equal(source.objects.length, 146);
  assert.equal(source.tables.auth_enrollments.length, 1);
  assert.ok(source.tables.users.every((u) => u.password_hash === ""));
  const actor = source.tables.users.filter((u) => u.is_admin && !u.is_disabled);
  assert.equal(actor.length, 1);
  await writeFile(
    join(state, "worker.ts"),
    `export {default,CommunityCell} from ${JSON.stringify(absolute("apps/fourm/__tests__/backup-cohort-worker.ts"))};`,
  );
  await writeFile(
    join(state, "wrangler.jsonc"),
    JSON.stringify({
      name: "fourm-backup-cohort",
      main: "worker.ts",
      compatibility_date: "2026-11-12",
      compatibility_flags: ["nodejs_compat"],
      vars: { FIXTURE_KEY: key, FIXTURE_ACTOR_ID: String(actor[0].id) },
      durable_objects: {
        bindings: [{ name: "COMMUNITIES", class_name: "CommunityCell" }],
      },
      migrations: [{ tag: "v1", new_sqlite_classes: ["CommunityCell"] }],
      r2_buckets: [{ binding: "MEDIA", bucket_name: "private-cohort-media" }],
    }),
  );
  const deployment = run(["deploy", join(state, "wrangler.jsonc")]);
  assert.equal(
    await new Promise((done, reject) => {
      deployment.once("error", reject);
      deployment.once("exit", done);
    }),
    0,
  );
  await start();
  assert.equal((await fetch(origin + "/manifest")).status, 401);
  phase = "upload";
  await checkpoint({ total: source.objects.length });
  for (const [index, item] of source.objects.entries()) {
    const bytes = await readFile(join(state, "source", item.file));
    assert.equal(sha(bytes), item.sha256);
    await request("/objects/" + encodeURIComponent(item.storage_path), bytes, {
      "Content-Type": item.content_type,
      "X-Content-SHA256": item.sha256,
      "X-Fixture-Metadata": JSON.stringify({
        fourm_etag: item.etag,
        fourm_last_modified: item.last_modified,
        fourm_mtime_ns: item.mtime_ns,
      }),
    });
    if (index % 10 === 0)
      await checkpoint({ uploaded: index + 1, total: source.objects.length });
  }
  phase = "seed";
  await checkpoint();
  await request("/seed", JSON.stringify(source.tables), {
    "Content-Type": "application/json",
  });
  phase = "capture";
  await checkpoint();
  const captured = await (await request("/capture", "{}")).json();
  assert.equal(captured.state, "complete");
  assert.equal(captured.files, 146);
  phase = "cold-recovery";
  await checkpoint();
  await stop();
  await rm(join(state, "replica"), { recursive: true, force: true });
  await start();
  const snapshot = await (await request("/manifest")).json();
  assert.equal(
    sha(canonicalTables(snapshot.tables)),
    sha(canonicalTables(source.tables)),
    "Snapshot content-field checksum mismatch",
  );
  phase = "remove-owned-live-copies";
  await checkpoint();
  assert.equal((await (await request("/drop-live", "{}")).json()).removed, 146);
  assert.equal((await (await request("/live-status")).json()).missing, 146);
  phase = "restore-objects";
  await checkpoint();
  for (let i = 0; i < snapshot.objects.length; i++) {
    await request(`/restore-object/${i}`, "{}");
    if (i % 10 === 0)
      await checkpoint({ restored: i + 1, total: snapshot.objects.length });
  }
  phase = "restore-tables";
  await checkpoint();
  const first = await (await request("/restore-tables", "{}")).json();
  const replay = await (await request("/restore-tables", "{}")).json();
  assert.deepEqual(replay, first);
  const restored = await (await request("/readback")).json();
  assert.equal(
    sha(canonicalTables(restored)),
    sha(canonicalTables(source.tables)),
    "Restored content-field checksum mismatch",
  );
  phase = "verify-restored-media";
  await checkpoint();
  for (const [index, item] of snapshot.objects.entries()) {
    const expected = source.objects.find(
      (object) => object.storage_path === item.storage_path,
    );
    assert.ok(expected);
    const response = await request(`/restored-object/${index}`),
      bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, expected.size_bytes);
    assert.equal(sha(bytes), expected.sha256);
    assert.equal(response.headers.get("etag"), expected.etag);
    assert.equal(response.headers.get("last-modified"), expected.last_modified);
    assert.equal(response.headers.get("x-fixture-mtime-ns"), expected.mtime_ns);
    assert.equal(response.headers.get("content-type"), expected.content_type);
    if (index % 10 === 0)
      await checkpoint({ verified: index + 1, total: snapshot.objects.length });
  }
  assert.equal(sha(await readFile(join(cohort, "cohort.sqlite3"))), sourceHash);
  await writeFile(
    join(output, "receipt.json"),
    JSON.stringify(
      {
        status: "PASS",
        scope:
          "isolated native real-content cohort archive capture and restore; no browser/OAuth/full operational backup claim",
        cohort,
        sourceDatabaseUnchanged: true,
        counts: inventory,
        tables: Object.fromEntries(
          Object.entries(source.tables).map(([name, rows]) => [
            name,
            {
              rows: rows.length,
              sha256: sha(canonicalTables({ [name]: rows })),
            },
          ]),
        ),
        all18ContentTablesExact: true,
        all146MediaBytesExact: true,
        allMediaValidatorsAndNanosecondsExact: true,
        completedEnrollmentPreserved: 1,
        replicaRemovedAndAuthorityRecovered: true,
        allSeededLiveObjectsRemovedBeforeRestore: true,
        restoreReplayIdempotent: true,
        unauthenticatedReadDenied: true,
        productionTouched: false,
        canonicalRuntimesTouched: false,
      },
      null,
      2,
    ),
  );
  phase = "pass";
} catch (error) {
  failed = true;
  await writeFile(
    join(output, "failure.json"),
    JSON.stringify(
      { phase, message: error.message, stack: error.stack },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await stop();
  await writeFile(join(output, "runtime.log"), logs);
  await checkpoint({ status: failed ? "FAIL" : "PASS", childStopped: true });
  await rm(state, { recursive: true, force: true });
  console.log(output);
}
