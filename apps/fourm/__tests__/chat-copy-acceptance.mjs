import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  open,
  rm,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";
import { exerciseChatCopies } from "./chat-copy-workflow.mjs";
import { exercisePushCopies } from "./push-copy-workflow.mjs";
process.umask(0o077);
const workflow = process.env.FOURM_COPY_WORKFLOW ?? "chat";
assert.ok(["chat", "push"].includes(workflow));
const exerciseCopies =
  workflow === "push" ? exercisePushCopies : exerciseChatCopies;
const repo = process.cwd();
assert.equal(repo, "/home/jack/repos/personal/harrhy-fourm-celld");
const root = "/home/jack/.local/state/form-harrhy-integration/candidate";
const canonical = resolve("apps/fourm/.review/parity-local");
const oracle = join(root, "python-oracle");
const output = join(
  root,
  workflow + "-copy-" + new Date().toISOString().replace(/[:.]/g, ""),
);
await mkdir(output, { mode: 0o700 });
const target = join(output, "native"),
  source = join(output, "python-oracle");
await mkdir(target, { mode: 0o700 });
await mkdir(source, { mode: 0o700 });
let phase = "preflight",
  nativeStopped = false,
  oracleStopped = false,
  restored = false;
let sourceChild, nativeChild;
const operations = [];
async function checkpoint() {
  await writeFile(
    join(output, "progress.json"),
    JSON.stringify(
      {
        phase,
        nativeStopped,
        oracleStopped,
        restored,
        productionTouched: false,
      },
      null,
      2,
    ),
  );
}
async function alive(pid) {
  try {
    return (await readFile(`/proc/${pid}/stat`, "utf8")).split(" ")[2] !== "Z";
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function stopPid(pid, needle, cwd) {
  assert.ok((await readFile(`/proc/${pid}/cmdline`, "utf8")).includes(needle));
  assert.equal(
    await import("node:fs/promises").then((fs) =>
      fs.realpath(`/proc/${pid}/cwd`),
    ),
    cwd,
  );
  process.kill(pid, "SIGTERM");
  const deadline = Date.now() + 25000;
  while (await alive(pid)) {
    assert.ok(Date.now() < deadline, "Owned process stop deadline exceeded");
    await delay(100);
  }
}
async function stopNative(state) {
  const r = JSON.parse(await readFile(join(state, "runtime.json"), "utf8"));
  await stopPid(r.supervisorPid, "scripts/review.mjs", repo);
  for (const pid of r.pids) assert.equal(await alive(pid), false);
}
async function startNative(state, persist = false) {
  const log = await open(
    join(output, persist ? "canonical-native.log" : "clone-native.log"),
    "a",
    0o600,
  );
  const child = spawn(process.execPath, ["apps/fourm/scripts/review.mjs"], {
    cwd: repo,
    env: {
      ...process.env,
      CELLD_BIN: join(root, "tools/celld"),
      FOURM_REVIEW_STATE: state,
      FOURM_REVIEW_PORT: "18974",
      FOURM_REVIEW_ISSUER_PORT: "18975",
      FOURM_REVIEW_PROVIDER_PORT: "18976",
      FOURM_REVIEW_BOOTSTRAP: "0",
    },
    detached: persist,
    stdio: ["ignore", log.fd, log.fd],
  });
  await log.close();
  let spawnError;
  child.on("error", (error) => {
    spawnError = error;
  });
  if (!persist) nativeChild = child;
  const deadline = Date.now() + 60000;
  while (true) {
    if (spawnError) throw spawnError;
    assert.equal(child.exitCode, null, "Owned native runner exited");
    assert.equal(child.signalCode, null);
    try {
      const r = JSON.parse(await readFile(join(state, "runtime.json"), "utf8"));
      if (
        r.supervisorPid === child.pid &&
        (await fetch("http://127.0.0.1:18974/ready")).ok
      )
        break;
    } catch {}
    assert.ok(Date.now() < deadline, "Native readiness deadline exceeded");
    await delay(150);
  }
  if (persist) child.unref();
  return child;
}
const original = JSON.parse(
  await readFile(join(oracle, "runtime.json"), "utf8"),
);
assert.equal(original.productionTouched, false);
const envEntries = (await readFile(`/proc/${original.pid}/environ`, "utf8"))
  .split("\0")
  .filter(Boolean)
  .map((line) => {
    const i = line.indexOf("=");
    return [line.slice(0, i), line.slice(i + 1)];
  });
const sourceEnv = Object.fromEntries(envEntries);
const allowed = new Set([
  "DATABASE_URL",
  "FOURM_ENV",
  "FOURM_UPLOADS_DIR",
  "HOME",
  "OIDC_CLIENT_ID",
  "OIDC_ISSUER",
  "OIDC_REDIRECT_URI",
  "PATH",
  "SECRET_KEY",
  "SITE_URL",
  "UVICORN_RELOAD",
]);
assert.ok(Object.keys(sourceEnv).every((key) => allowed.has(key)));
assert.equal(
  sourceEnv.SECRET_KEY,
  await readFile(join(oracle, "secret"), "utf8"),
);
assert.equal(sourceEnv.OIDC_ISSUER, "https://127.0.0.1:18965");
await writeFile(
  join(output, "source-recovery-env.json"),
  JSON.stringify(sourceEnv),
);
async function startSource(directory, persist = false) {
  const log = await open(
    join(output, persist ? "canonical-source.log" : "clone-source.log"),
    "a",
    0o600,
  );
  const env =
    directory === oracle
      ? sourceEnv
      : {
          ...sourceEnv,
          DATABASE_URL: "sqlite:///" + join(directory, "oracle.sqlite3"),
          PYTHONPATH: oracle,
          FOURM_UPLOADS_DIR: join(directory, "uploads"),
        };
  const child = spawn(
    "/home/jack/repos/personal/4orm/.venv/bin/python",
    [join(directory, "run.py")],
    {
      cwd: directory,
      env,
      detached: persist,
      stdio: ["ignore", log.fd, log.fd],
    },
  );
  await log.close();
  let spawnError;
  child.on("error", (error) => {
    spawnError = error;
  });
  if (!persist) sourceChild = child;
  const deadline = Date.now() + 30000;
  while (true) {
    if (spawnError) throw spawnError;
    assert.equal(child.exitCode, null, "Owned Python oracle exited");
    assert.equal(child.signalCode, null);
    try {
      if ((await fetch("http://127.0.0.1:18964/chat")).ok) break;
    } catch {}
    assert.ok(Date.now() < deadline, "Python readiness deadline exceeded");
    await delay(150);
  }
  await writeFile(
    join(directory, "runtime.json"),
    JSON.stringify(
      {
        ...original,
        pid: child.pid,
        disposable: directory !== oracle,
        uploads: env.FOURM_UPLOADS_DIR,
        productionTouched: false,
      },
      null,
      2,
    ),
  );
  if (persist) child.unref();
  return child;
}
function copyDatabase(from, to) {
  const script =
    "import sqlite3,json,sys,pathlib\na,b=map(pathlib.Path,json.load(sys.stdin))\nwith sqlite3.connect(a.resolve().as_uri()+'?mode=ro',uri=True) as src, sqlite3.connect(b) as dst:\n src.backup(dst)\n assert dst.execute('PRAGMA integrity_check').fetchone()[0]=='ok'\n";
  const r = spawnSync("python3", ["-c", script], {
    input: JSON.stringify([from, to]),
    encoding: "utf8",
  });
  assert.equal(r.status, 0, "Private SQLite backup failed");
}
async function digest(path) {
  const { createReadStream } = await import("node:fs");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
async function stopCloneNative() {
  if (!nativeChild?.pid || !(await alive(nativeChild.pid))) {
    nativeChild = null;
    return;
  }
  await stopPid(nativeChild.pid, "scripts/review.mjs", repo);
  nativeChild = null;
}
async function stopCloneSource() {
  if (!sourceChild?.pid || !(await alive(sourceChild.pid))) {
    sourceChild = null;
    return;
  }
  await stopPid(sourceChild.pid, "run.py", source);
  sourceChild = null;
}
let nativeHash, sourceHash;
try {
  await checkpoint();
  phase = "stop-canonical-native";
  await stopNative(canonical);
  nativeStopped = true;
  await checkpoint();
  phase = "stop-canonical-source";
  await stopPid(original.pid, "run.py", oracle);
  oracleStopped = true;
  await checkpoint();
  phase = "clone-authorities";
  await checkpoint();
  nativeHash = await digest(join(canonical, "objects.sqlite3"));
  sourceHash = await digest(join(oracle, "oracle.sqlite3"));
  copyDatabase(
    join(canonical, "objects.sqlite3"),
    join(target, "objects.sqlite3"),
  );
  copyDatabase(join(oracle, "oracle.sqlite3"), join(source, "oracle.sqlite3"));
  assert.ok(sourceEnv.FOURM_UPLOADS_DIR.startsWith(oracle + "/"));
  const mediaCopy = spawnSync(
    "python3",
    [
      "-c",
      "import json,sys,shutil; a,b=json.load(sys.stdin); shutil.copytree(a,b,copy_function=shutil.copy2)",
    ],
    {
      input: JSON.stringify([
        sourceEnv.FOURM_UPLOADS_DIR,
        join(source, "uploads"),
      ]),
      encoding: "utf8",
    },
  );
  assert.equal(mediaCopy.status, 0, "Private source media copy failed");
  await copyFile(
    join(canonical, "enrollment-key"),
    join(target, "enrollment-key"),
  );
  for (const name of ["run.py", "secret", "media-registry.json"])
    await copyFile(join(oracle, name), join(source, name));
  await copyFile(join(oracle, "alembic.ini"), join(source, "alembic.ini"));
  const migrationCopy = spawnSync(
    "python3",
    [
      "-c",
      "import json,sys,shutil; a,b=json.load(sys.stdin); shutil.copytree(a,b,ignore=shutil.ignore_patterns('__pycache__'))",
    ],
    {
      input: JSON.stringify([join(oracle, "alembic"), join(source, "alembic")]),
      encoding: "utf8",
    },
  );
  assert.equal(
    migrationCopy.status,
    0,
    "Private oracle migration configuration copy failed",
  );
  const cloneRunner = await readFile(join(source, "run.py"), "utf8");
  assert.ok(cloneRunner.includes("access_log=False)"));
  await writeFile(
    join(source, "run.py"),
    cloneRunner.replace(
      "access_log=False)",
      "access_log=False,timeout_graceful_shutdown=5)",
    ),
  );
  await writeFile(
    join(source, "runtime.json"),
    JSON.stringify({ ...original, disposable: true, pid: null }),
  );
  phase = "start-copies";
  await checkpoint();
  await startSource(source);
  await startNative(target);
  phase = "exercise-copies";
  await checkpoint();
  await exerciseCopies({
    output,
    oracleRoot: source,
    authPath: join(root, "parity-cohort-20261112/review-auth.json"),
    async restart(name) {
      phase = `cold-restart-${name}`;
      await checkpoint();
      if (name === "native") {
        await stopCloneNative();
        await rm(join(target, "replica"), { recursive: true, force: true });
        await startNative(target);
      } else {
        await stopCloneSource();
        await startSource(source);
      }
      operations.push({ name, coldRestart: true });
      phase = "exercise-copies";
      await checkpoint();
    },
  });
  phase = "verify-original-authorities";
  await checkpoint();
  assert.equal(await digest(join(canonical, "objects.sqlite3")), nativeHash);
  assert.equal(await digest(join(oracle, "oracle.sqlite3")), sourceHash);
  await writeFile(
    join(output, "acceptance.json"),
    JSON.stringify(
      {
        status: "PASS",
        operations,
        originalAuthoritiesUnchanged: true,
        productionTouched: false,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await writeFile(
    join(output, "failure.json"),
    JSON.stringify({ status: "FAIL", phase, message: error.message }, null, 2),
  );
  process.exitCode = 1;
} finally {
  phase = "restore-canonical";
  await checkpoint();
  const recoveryErrors = [];
  for (const cleanup of [stopCloneNative, stopCloneSource]) {
    try {
      await cleanup();
    } catch (error) {
      recoveryErrors.push(error.message);
    }
  }
  if (oracleStopped) {
    try {
      await startSource(oracle, true);
      oracleStopped = false;
    } catch (error) {
      recoveryErrors.push(error.message);
    }
  }
  if (nativeStopped) {
    try {
      await startNative(canonical, true);
      nativeStopped = false;
    } catch (error) {
      recoveryErrors.push(error.message);
    }
  }
  try {
    assert.ok((await fetch("http://127.0.0.1:18964/chat")).ok);
    assert.ok((await fetch("http://127.0.0.1:18974/ready")).ok);
    assert.equal(recoveryErrors.length, 0);
    restored = true;
    phase = process.exitCode
      ? "failed-canonical-restored"
      : "pass-canonical-restored";
    await checkpoint();
  } catch (error) {
    await writeFile(
      join(output, "recovery-failure.json"),
      JSON.stringify(
        { phase, message: error.message, recoveryErrors },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}
console.log(
  JSON.stringify({
    status: process.exitCode ? "FAIL" : "PASS",
    output,
    canonicalRestored: restored,
  }),
);
