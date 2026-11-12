import { reviewSourceFingerprint } from "./review-source.mjs";
import { createServer } from "node:net";
import { parse } from "jsonc-parser";
import { spawn } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

process.umask(0o077);
const root = fileURLToPath(new URL("..", import.meta.url));
const repo = resolve(root, "../..");
const state = resolve(
  root,
  process.env.FOURM_REVIEW_STATE ?? ".review/candidate",
);
const port = Number(process.env.FOURM_REVIEW_PORT ?? 18944);
const issuerPort = Number(process.env.FOURM_REVIEW_ISSUER_PORT ?? 18945);
const providerPort = Number(process.env.FOURM_REVIEW_PROVIDER_PORT ?? 18946);
const origin = process.env.FOURM_REVIEW_ORIGIN ?? `http://127.0.0.1:${port}`;
const issuer =
  process.env.FOURM_REVIEW_ISSUER ?? `http://127.0.0.1:${issuerPort}`;
const user = process.env.FOURM_REVIEW_USER ?? "jane";
if (!/^[a-z]{3,20}$/.test(user))
  throw new Error("Fixture name must be 3–20 lowercase letters");
const subject = `fourm-fixture-${user}`;
const binary = process.env.CELLD_BIN;
if (!binary) throw new Error("Set CELLD_BIN to the reviewed Celld fork binary");
if (
  ![port, issuerPort, providerPort].every(
    (value) => Number.isSafeInteger(value) && value > 0 && value < 65536,
  ) ||
  new Set([port, issuerPort, providerPort]).size !== 3
)
  throw new Error("Choose three distinct valid review ports");
await Promise.all(
  [port, issuerPort, providerPort].map(
    (value) =>
      new Promise((accept, reject) => {
        const probe = createServer();
        probe.once("error", () =>
          reject(new Error(`Review port ${value} is already occupied`)),
        );
        probe.listen(value, "127.0.0.1", () => probe.close(accept));
      }),
  ),
);
await mkdir(state, { recursive: true, mode: 0o700 });
const fingerprint = await reviewSourceFingerprint(root);
let enrollmentKey;
try {
  enrollmentKey = await readFile(join(state, "enrollment-key"), "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  enrollmentKey = randomBytes(32).toString("hex");
  await writeFile(join(state, "enrollment-key"), enrollmentKey, {
    mode: 0o600,
    flag: "wx",
  });
}
const cleanEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !key.startsWith("CELLD_") &&
      !key.startsWith("AUTH_") &&
      !key.startsWith("HARRHY_DEV_AUTH_") &&
      !key.startsWith("FOURM_FIXTURE_"),
  ),
);
const environment = {
  ...cleanEnvironment,
  CELLD_BUCKET: `sqlite://${join(state, "objects.sqlite3")}`,
  CELLD_WATCH: join(state, "replica"),
  CELLD_DURABILITY: "bucket",
  CELLD_ADDR: `127.0.0.1:${port}`,
  CELLD_INTERNAL_ADDR: "127.0.0.1:0",
  CELLD_ESBUILD: join(repo, "node_modules/.bin/esbuild"),
};
const children = [];
const services = [];
const logs = [];
function start(args, extra = {}) {
  const child = spawn(args[0], args.slice(1), {
    cwd: root,
    env: { ...environment, ...extra },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  children.push(child);
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));
  child.on("error", () => logs.push("Child process failed to start"));
  return child;
}
function service(args, extra = {}) {
  const child = start(args, extra);
  services.push(child);
  return child;
}
function checkServices() {
  if (
    services.length !== 3 ||
    services.some(
      (child) => child.exitCode !== null || child.signalCode !== null,
    )
  )
    throw new Error("Review service failed during startup");
}
async function command(args, extra = {}) {
  const child = start(args, extra);
  const code = await new Promise((accept, reject) => {
    child.once("error", reject);
    child.once("exit", accept);
  });
  if (code !== 0) throw new Error(`Review command failed: ${args[0]}`);
}
async function ready(url) {
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) {
        checkServices();
        return;
      }
    } catch {}
    if (
      children.some((child) => child.exitCode !== null && child.exitCode !== 0)
    )
      throw new Error("Review child exited unexpectedly");
    await delay(150);
  }
  throw new Error(`Review readiness failed: ${url}`);
}
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await Promise.all(
    children
      .filter((child) => child.exitCode === null && child.signalCode === null)
      .map(
        (child) =>
          new Promise((accept, reject) => {
            const timeout = setTimeout(() => {
              if (child.exitCode === null && child.signalCode === null) {
                try {
                  process.kill(-child.pid, "SIGKILL");
                } catch {}
              }
            }, 15000);
            child.once("exit", () => {
              clearTimeout(timeout);
              accept();
            });
            child.once("error", (error) => {
              clearTimeout(timeout);
              reject(error);
            });
            try {
              process.kill(-child.pid, "SIGTERM");
            } catch (error) {
              clearTimeout(timeout);
              if (error.code === "ESRCH") accept();
              else reject(error);
            }
          }),
      ),
  );
  await writeFile(join(state, "runtime.log"), logs.join(""), { mode: 0o600 });
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void close().then(() => process.exit(0));
  });
try {
  const roles = [
    "member",
    "admin",
    "archive-restore",
    "archive-read",
    "pages-read",
    "pages-write",
    "media-read",
    "media-write",
  ];
  const config = {
    applications: [
      {
        clientId: "fourm-local-browser",
        callback: origin + "/auth/callback",
        projectId: "fourm-local-project",
        organizationId: "fourm-local-org",
        subject,
        username: user,
        displayName: user,
        roles,
        resourceClientId: "fourm-local-resource",
        resourceSecret: "isolated-local-resource-secret",
      },
    ],
  };
  await writeFile(join(state, "issuer.json"), JSON.stringify(config));
  await command([process.execPath, join(root, "scripts/build.mjs")]);
  const worker = parse(await readFile(join(root, "wrangler.jsonc"), "utf8"));
  worker.main = "worker.ts";
  worker.vars = {
    REVIEW_SOURCE_FINGERPRINT: fingerprint,
    AUTH_ISSUER: issuer,
    AUTH_CLIENT_ID: "fourm-local-browser",
    AUTH_PROJECT_ID: "fourm-local-project",
    AUTH_ORGANIZATION_ID: "fourm-local-org",
    AUTH_PUBLIC_ORIGIN: origin,
    AUTH_CLI_CLIENT_ID: "fourm-local-browser",
    AUTH_INTROSPECTION_CLIENT_ID: "fourm-local-resource",
    AUTH_INTROSPECTION_SECRET: "isolated-local-resource-secret",
    AUTH_ENROLLMENT_KEY: enrollmentKey,
  };
  const workerConfig = join(
    root,
    `.review-${createHash("sha256").update(state).digest("hex").slice(0, 12)}.jsonc`,
  );
  await writeFile(workerConfig, JSON.stringify(worker));
  await command([binary, "deploy", workerConfig]);
  await command([binary, "deploy", join(root, "review-peer")]);
  await command([binary, "deploy", join(root, "review-gateway")]);
  service([process.execPath, join(repo, "packages/dev-auth/server.mjs")], {
    HARRHY_DEV_AUTH_PORT: String(providerPort),
    HARRHY_DEV_AUTH_ORIGIN: issuer,
    HARRHY_DEV_AUTH_CONFIG: join(state, "issuer.json"),
  });
  service([process.execPath, join(root, "__tests__/issuer.mjs")], {
    FOURM_FIXTURE_ISSUER: issuer,
    FOURM_FIXTURE_PORT: String(issuerPort),
    FOURM_FIXTURE_UPSTREAM: `http://127.0.0.1:${providerPort}`,
    FOURM_FIXTURE_APP: origin,
    FOURM_FIXTURE_ENROLLMENT_KEY: enrollmentKey,
    FOURM_FIXTURE_SUBJECT: subject,
    FOURM_FIXTURE_USERNAME: user,
  });
  service([binary, "--no-control-plane", "--trust-forwarded-headers"]);
  await ready(`${issuer}/.well-known/openid-configuration`);
  await ready(`http://127.0.0.1:${port}/ready`);
  if (process.env.FOURM_REVIEW_BOOTSTRAP !== "0") {
    const tokenPath = join(
      state,
      `bootstrap-${randomBytes(8).toString("hex")}`,
    );
    try {
      await command(
        [
          process.execPath,
          join(repo, "packages/dev-auth/token.mjs"),
          tokenPath,
        ],
        {
          HARRHY_DEV_AUTH_ORIGIN: issuer,
          HARRHY_DEV_AUTH_CALLBACK: origin + "/auth/callback",
          HARRHY_DEV_AUTH_CLIENT_ID: "fourm-local-browser",
          HARRHY_DEV_AUTH_PROJECT_ID: "fourm-local-project",
          HARRHY_DEV_AUTH_ROLES: roles.join(","),
        },
      );
      const token = await readFile(tokenPath, "utf8");
      const response = await fetch(origin + "/api/archive", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tables: {
            users: [
              {
                id: 41,
                username: "jane",
                display_name: "Jane",
                password_hash: "",
                is_admin: 1,
                has_accepted_trust: 1,
              },
              {
                id: 72,
                username: "sam",
                display_name: "Sam",
                password_hash: "",
                is_admin: 0,
                has_accepted_trust: 1,
              },
            ],
            external_identities: [
              { issuer, subject: "fourm-fixture-jane", user_id: 41 },
              { issuer, subject: "fourm-fixture-sam", user_id: 72 },
            ],
          },
        }),
      });
      if (!response.ok && response.status !== 409)
        throw new Error(`Fixture restore rejected: ${response.status}`);
      if (response.status === 409 && !(await fetch(origin + "/u/jane")).ok)
        throw new Error("Existing store does not match the review fixture");
    } finally {
      await rm(tokenPath, { force: true });
    }
  }
  checkServices();
  const report = {
    status: "RUNNING",
    supervisorPid: process.pid,
    sourceFingerprint: fingerprint,
    origin,
    issuer,
    state,
    worker: "harrhy-fourm-candidate",
    gateway: "harrhy-fourm-review-gateway",
    fixtureSubject: subject,
    pids: services.map((child) => child.pid),
    productionTouched: false,
  };
  await writeFile(join(state, "runtime.json"), JSON.stringify(report, null, 2));
  await writeFile(join(state, "runtime.log"), logs.join(""));
  console.log(JSON.stringify(report));
  const unexpected = await new Promise((accept) => {
    for (const child of services) child.once("exit", () => accept(child));
  });
  throw new Error(`Review child exited: ${unexpected.pid}`);
} catch (error) {
  await close();
  console.error(error.message);
  process.exitCode = 1;
}
