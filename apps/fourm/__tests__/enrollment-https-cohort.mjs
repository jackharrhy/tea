import assert from "node:assert/strict";
import { createServer as netServer } from "node:net";
import { createServer as tlsServer } from "node:https";
import { request } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { transferArchive } from "../scripts/archive.mjs";
import { createInvite } from "./enrollment-browser.mjs";
process.umask(0o077);
const root = "/home/jack/.local/state/form-harrhy-integration/candidate";
const temporary = await mkdtemp(join(tmpdir(), "fourm-enrollment-https-"));
const output = join(
  root,
  "enrollment-https-cohort-" + new Date().toISOString().replace(/[:.]/g, ""),
);
await mkdir(output, { mode: 0o700 });
const ports = await Promise.all(
  Array.from(
    { length: 5 },
    () =>
      new Promise((resolvePort, reject) => {
        const s = netServer();
        s.once("error", reject);
        s.listen(0, "127.0.0.1", () => {
          const p = s.address().port;
          s.close(() => resolvePort(p));
        });
      }),
  ),
);
assert.equal(new Set(ports).size, 5);
const [appPort, issuerPort, providerPort, appTLS, issuerTLS] = ports;
const origin = `https://127.0.0.1:${appTLS}`,
  issuer = `https://127.0.0.1:${issuerTLS}`;
const env = {
  ...process.env,
  CELLD_BIN: join(root, "tools/celld"),
  FOURM_REVIEW_STATE: join(temporary, "native"),
  FOURM_REVIEW_PORT: String(appPort),
  FOURM_REVIEW_ISSUER_PORT: String(issuerPort),
  FOURM_REVIEW_PROVIDER_PORT: String(providerPort),
  FOURM_REVIEW_ORIGIN: origin,
  FOURM_REVIEW_ISSUER: issuer,
  FOURM_REVIEW_BOOTSTRAP: "0",
  FOURM_REVIEW_PRIVATE: "1",
  FOURM_REVIEW_CLI_CAGE: "0",
  FOURM_REVIEW_USER: "jane",
};
const servers = [],
  sockets = new Set();
let runner,
  logs = "",
  phase = "setup";
async function stop() {
  if (!runner || runner.exitCode !== null || runner.signalCode !== null) return;
  const stopped = new Promise((done) => runner.once("exit", done));
  runner.kill("SIGTERM");
  const timer = setTimeout(() => runner.kill("SIGKILL"), 60000);
  await stopped;
  clearTimeout(timer);
  runner = undefined;
}
async function start() {
  runner = spawn(process.execPath, ["apps/fourm/scripts/review.mjs"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  runner.stdout.on("data", (part) => (logs += part));
  runner.stderr.on("data", (part) => (logs += part));
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    assert.equal(runner.exitCode, null, "Owned fixture runtime exited");
    try {
      const r = JSON.parse(
        await readFile(join(env.FOURM_REVIEW_STATE, "runtime.json"), "utf8"),
      );
      if (
        r.supervisorPid === runner.pid &&
        (await fetch(`http://127.0.0.1:${appPort}/ready`)).ok
      )
        return;
    } catch {}
    await delay(150);
  }
  throw Error("HTTPS enrollment fixture readiness failed");
}
async function child(file, args = []) {
  const p = spawn(process.execPath, [file, ...args], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let text = "";
  p.stdout.on("data", (part) => (text += part));
  p.stderr.on("data", (part) => (text += part));
  const status = await new Promise((done, reject) => {
    p.once("error", reject);
    p.once("exit", done);
  });
  if (status !== 0) {
    await writeFile(join(output, "child-failure.log"), text);
    throw Error("Owned HTTPS enrollment child failed");
  }
}
try {
  const key = join(temporary, "key.pem"),
    cert = join(temporary, "cert.pem");
  assert.equal(
    spawnSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "1",
        "-subj",
        "/CN=127.0.0.1",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
      ],
      { stdio: "ignore" },
    ).status,
    0,
  );
  env.NODE_EXTRA_CA_CERTS = cert;
  for (const [port, upstream] of [
    [appTLS, appPort],
    [issuerTLS, issuerPort],
  ]) {
    const server = tlsServer(
      { key: await readFile(key), cert: await readFile(cert) },
      (req, res) => {
        const hop = request(
          {
            hostname: "127.0.0.1",
            port: upstream,
            path: req.url,
            method: req.method,
            headers: req.headers,
          },
          (reply) => {
            res.writeHead(reply.statusCode, {
              ...reply.headers,
              "Referrer-Policy": "same-origin",
            });
            reply.pipe(res);
          },
        );
        hop.on("error", () => {
          if (!res.headersSent) res.writeHead(502);
          res.end();
        });
        req.pipe(hop);
        res.on("close", () => hop.destroy());
      },
    );
    server.on("connection", (s) => {
      sockets.add(s);
      s.once("close", () => sockets.delete(s));
    });
    await new Promise((done, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", done);
    });
    servers.push(server);
  }
  const pub = spawnSync("openssl", ["x509", "-in", cert, "-pubkey", "-noout"], {
    encoding: "utf8",
  });
  assert.equal(pub.status, 0);
  const spki = spawnSync("openssl", ["pkey", "-pubin", "-outform", "DER"], {
    input: pub.stdout,
  });
  assert.equal(spki.status, 0);
  const browserOptions = {
    args: [
      "--ignore-certificate-errors-spki-list=" +
        createHash("sha256").update(spki.stdout).digest("base64"),
    ],
  };
  phase = "real-cohort-import";
  await start();
  const source = join(root, "corrected-cohort-stage-20261113/archive");
  const archive = JSON.parse(
    await readFile(join(source, "archive.json"), "utf8"),
  );
  const alias = archive.tables.external_identities.find(
    (row) =>
      row.issuer === "http://127.0.0.1:18985" &&
      row.subject === "fourm-fixture-jane",
  );
  assert.ok(alias);
  archive.tables.external_identities.push({ ...alias, issuer });
  const adminUsername = archive.tables.users.find(
    (row) => row.id === alias.user_id,
  ).username;
  const staged = join(temporary, "archive");
  await mkdir(staged);
  await writeFile(join(staged, "archive.json"), JSON.stringify(archive));
  await symlink(join(source, "objects"), join(staged, "objects"), "dir");
  Object.assign(env, {
    HARRHY_DEV_AUTH_ORIGIN: issuer,
    HARRHY_DEV_AUTH_CALLBACK: origin + "/auth/callback",
    HARRHY_DEV_AUTH_CLIENT_ID: "fourm-local-browser",
    HARRHY_DEV_AUTH_PROJECT_ID: "fourm-local-project",
    HARRHY_DEV_AUTH_ROLES:
      "member,admin,archive-restore,archive-read,pages-read,pages-write,media-read,media-write",
  });
  await child("packages/dev-auth/token.mjs", [join(temporary, "import-token")]);
  await transferArchive({
    mode: "restore",
    directory: staged,
    origin: `http://127.0.0.1:${appPort}`,
    token: (await readFile(join(temporary, "import-token"), "utf8")).trim(),
  });
  const baselineMembers = (
    await fetch(`http://127.0.0.1:${appPort}/world/community`).then((r) =>
      r.json(),
    )
  ).members.length;
  phase = "actual-invite-form";
  const invite = await createInvite(origin, {
    adminUsername,
    issuer,
    browserOptions,
  });
  await stop();
  env.FOURM_REVIEW_USER = "newfixture";
  await start();
  phase = "actual-https-enrollment";
  const workflow = join(temporary, "workflow.mjs");
  const config = join(temporary, "workflow.json");
  await writeFile(
    config,
    JSON.stringify({
      origin,
      issuer,
      key: await readFile(
        join(env.FOURM_REVIEW_STATE, "enrollment-key"),
        "utf8",
      ),
      invite,
      output,
      memberUsername: "newfixture",
      baselineMembers,
      browserOptions,
    }),
  );
  await writeFile(
    workflow,
    `import {readFile,writeFile} from 'node:fs/promises';import {completeInvite} from ${JSON.stringify(resolve("apps/fourm/__tests__/enrollment-browser.mjs"))};const settings=JSON.parse(await readFile(process.argv[2],'utf8'));const result=await completeInvite(settings);await writeFile(${JSON.stringify(join(output, "acceptance.json"))},JSON.stringify({...result,realCohortMembers:${archive.tables.users.length},https:true,productionTouched:false},null,2));`,
  );
  await child(workflow, [config]);
  console.log(
    JSON.stringify({ status: "PASS_REAL_COHORT_HTTPS_ENROLLMENT", output }),
  );
} catch (error) {
  await writeFile(
    join(output, "failure.json"),
    JSON.stringify({ phase, message: error.message }, null, 2),
  );
  throw error;
} finally {
  await stop();
  for (const socket of sockets) socket.destroy();
  await Promise.all(servers.map((s) => new Promise((done) => s.close(done))));
  await writeFile(join(output, "runtime.log"), logs);
  await rm(temporary, { recursive: true, force: true });
}
