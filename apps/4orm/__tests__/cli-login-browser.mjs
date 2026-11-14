import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath, relative } from "node:path";
import { reviewSourceFingerprint } from "../scripts/review-source.mjs";
import { exerciseNativeCli } from "./cli-native-workflow.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";
import { cliIssuerProxy } from "./cli-issuer-proxy.mjs";
process.umask(0o077);
const binary = process.env.FOURM_CLI_BINARY;
assert.ok(binary, "Set FOURM_CLI_BINARY to the preserved released CLI");
const issuer = "https://auth.jackharrhy.dev";
const directory = await mkdtemp(join(tmpdir(), "fourm-cli-browser-"));
const output =
  "/home/jack/.local/state/form-harrhy-integration/candidate/cli-browser-" +
  new Date().toISOString().replace(/[:.]/g, "");
await mkdir(output, { mode: 0o700 });
let provider, cli, proxy, browser;
let phase = "setup";
const nativeState = process.env.FOURM_CLI_NATIVE_STATE;
let nativeRuntime;
let configuration = {
  native: true,
  clientId: "fourm-isolated-cli",
  projectId: "fourm-isolated-project",
  organizationId: "fourm-isolated-org",
  subject: "fourm-isolated-cli-subject",
  username: "localfixture",
  displayName: "Isolated CLI fixture",
  roles: ["member"],
  callback: "http://localhost:4444/auth/cli/callback",
  resourceClientId: "fourm-isolated-resource",
  resourceSecret: "isolated-not-production",
};
if (nativeState) {
  assert.ok(
    !relative(
      resolvePath("apps/4orm/.review"),
      resolvePath(nativeState),
    ).startsWith(".."),
  );
  nativeRuntime = JSON.parse(
    await readFile(join(nativeState, "runtime.json"), "utf8"),
  );
  assert.equal(nativeRuntime.cliTransportCaged, true);
  assert.equal(nativeRuntime.productionTouched, false);
  assert.equal(
    nativeRuntime.sourceFingerprint,
    await reviewSourceFingerprint(resolvePath("apps/4orm")),
  );
  assert.equal(new URL(nativeRuntime.origin).hostname, "127.0.0.1");
  const live = await fetch(nativeRuntime.origin + "/ready").then((r) =>
    r.json(),
  );
  assert.equal(live.sourceFingerprint, nativeRuntime.sourceFingerprint);
  configuration = JSON.parse(
    await readFile(join(nativeState, "issuer.json"), "utf8"),
  ).applications.find((app) => app.native === true);
  assert.ok(configuration);
}
const configServer = createServer((req, res) => {
  if (req.method !== "GET" || req.url !== "/api/v1/auth-config") {
    res.writeHead(404).end();
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      issuer,
      client_id: configuration.clientId,
      scopes: [
        "openid",
        "profile",
        "offline_access",
        `urn:zitadel:iam:org:project:id:${configuration.projectId}:aud`,
        "urn:zitadel:iam:org:projects:roles",
        "urn:zitadel:iam:org:project:role:member",
      ],
    }),
  );
});
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await exited;
}
try {
  const key = join(directory, "key.pem"),
    cert = join(directory, "cert.pem");
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
        "/CN=auth.jackharrhy.dev",
        "-addext",
        "subjectAltName=DNS:auth.jackharrhy.dev",
      ],
      { stdio: "ignore" },
    ).status,
    0,
  );
  let upstream = process.env.FOURM_CLI_FIXTURE_ORIGIN;
  if (!nativeState) {
    const probe = createServer();
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    upstream = `http://127.0.0.1:${port}`;
    const providerConfig = join(directory, "provider.json");
    await writeFile(
      providerConfig,
      JSON.stringify({ applications: [configuration] }),
    );
    provider = spawn(process.execPath, ["packages/dev-auth/server.mjs"], {
      env: {
        ...process.env,
        HARRHY_DEV_AUTH_PORT: String(port),
        HARRHY_DEV_AUTH_ORIGIN: issuer,
        HARRHY_DEV_AUTH_CONFIG: providerConfig,
      },
      stdio: "ignore",
    });
    for (let i = 0; ; i++) {
      try {
        if ((await fetch(upstream + "/.well-known/openid-configuration")).ok)
          break;
      } catch {}
      assert.ok(
        i < 50 && provider.exitCode === null,
        "Fixture provider did not become ready",
      );
      await delay(50);
    }
  }
  assert.ok(upstream, "Explicit native fixture origin required");
  proxy = await cliIssuerProxy({
    key: await readFile(key),
    cert: await readFile(cert),
    upstream,
  });
  if (!nativeState)
    await new Promise((resolve) =>
      configServer.listen(0, "127.0.0.1", resolve),
    );
  const origin =
    nativeRuntime?.origin ?? `http://127.0.0.1:${configServer.address().port}`;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        ![/proxy/i, /^4ORM_/, /^SSL_CERT/].some((pattern) =>
          pattern.test(name),
        ),
    ),
  );
  Object.assign(env, {
    "4ORM_URL": origin,
    XDG_CONFIG_HOME: directory,
    HTTPS_PROXY: proxy.url,
    HTTP_PROXY: proxy.url,
    SSL_CERT_FILE: cert,
    SSL_CERT_DIR: directory,
  });
  phase = "released-cli-discovery";
  cli = spawn(binary, ["login"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "",
    stderr = "";
  cli.stdout.on("data", (part) => (stdout += part));
  cli.stderr.on("data", (part) => (stderr += part));
  const exited = new Promise((resolve) => cli.once("exit", resolve));
  for (let i = 0; !stdout.includes(issuer + "/oauth/v2/authorize?"); i++) {
    assert.ok(
      i < 100 && cli.exitCode === null,
      "CLI did not reach isolated browser authorization",
    );
    await delay(50);
  }
  const authorization = stdout
    .split(/\s+/)
    .find((part) => part.startsWith(issuer + "/oauth/v2/authorize?"));
  const url = new URL(authorization);
  assert.equal(url.searchParams.get("redirect_uri"), configuration.callback);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  const publicKey = spawnSync(
    "openssl",
    ["x509", "-in", cert, "-pubkey", "-noout"],
    { encoding: "utf8" },
  );
  assert.equal(publicKey.status, 0);
  const spki = spawnSync("openssl", ["pkey", "-pubin", "-outform", "DER"], {
    input: publicKey.stdout,
  });
  assert.equal(spki.status, 0);
  browser = await chromium.launch({
    proxy: { server: proxy.url, bypass: "localhost,127.0.0.1" },
    args: [
      "--ignore-certificate-errors-spki-list=" +
        createHash("sha256").update(spki.stdout).digest("base64"),
    ],
  });
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", (route) =>
    [issuer, "http://localhost:4444"].includes(
      new URL(route.request().url()).origin,
    )
      ? route.continue()
      : route.abort(),
  );
  const page = await context.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  phase = "actual-browser-callback";
  assert.equal((await page.goto(authorization)).status(), 200);
  await page.screenshot({
    path: join(output, "fixture-signin.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Continue as local user", exact: true })
    .click();
  await page.waitForURL(
    (u) =>
      u.origin === "http://localhost:4444" &&
      u.pathname === "/auth/cli/callback",
  );
  assert.ok((await page.textContent("body")).includes("4orm login complete"));
  await page.screenshot({
    path: join(output, "cli-callback.png"),
    fullPage: true,
  });
  assert.equal(browserErrors.length, 0);
  assert.equal(
    await Promise.race([exited, delay(10000).then(() => "timeout")]),
    0,
    "CLI signed identity validation failed",
  );
  assert.ok(stdout.includes("logged in"));
  assert.equal(stderr, "");
  const credentialPath = join(directory, "4orm/config.json");
  const credentials = JSON.parse(await readFile(credentialPath, "utf8"));
  assert.equal(credentials.issuer, issuer);
  assert.equal(credentials.client_id, configuration.clientId);
  assert.ok(credentials.access_token && credentials.refresh_token);
  assert.equal((await stat(credentialPath)).mode & 0o777, 0o600);
  let nativeAcceptance;
  if (nativeState) {
    phase = "native-cli-business-refresh-revocation";
    nativeAcceptance = await exerciseNativeCli({
      binary,
      env,
      origin,
      upstream,
      configuration,
      credentialPath,
      directory,
    });
  }
  await writeFile(
    join(output, "receipt.json"),
    JSON.stringify(
      {
        status: nativeState
          ? "PASS_RELEASED_CLI_NATIVE_API"
          : "PASS_RELEASED_CLI_BROWSER_PROTOCOL_ONLY",
        binary,
        binarySha256: createHash("sha256")
          .update(await readFile(binary))
          .digest("hex"),
        actualBrowserCallback: true,
        nativeAcceptance,
        signedIdentityAcceptedByUnmodifiedCLI: true,
        credentialsMode: "0600",
        transport: {
          fixedLoopbackUpstream: true,
          issuerHostnameNeverResolved: true,
          scopedCLITrust: true,
          browserPinnedFixtureSPKI: true,
          ...proxy.counts,
        },
        limits: nativeState
          ? [
              "Loopback native copy and synthetic provider, not production SSO",
              "No full migration or Tailnet acceptance claim",
            ]
          : [
              "Configuration endpoint is a disposable fixture, not the native 4orm API",
              "No native CLI business/API or refresh acceptance claim",
              "No production provider contact or production credentials",
            ],
        productionTouched: false,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      status: nativeState
        ? "PASS_RELEASED_CLI_NATIVE_API"
        : "PASS_RELEASED_CLI_BROWSER_PROTOCOL_ONLY",
      output,
    }),
  );
} catch (error) {
  await writeFile(
    join(output, "failure.json"),
    JSON.stringify({ status: "FAIL", phase, message: error.message }, null, 2),
  );
  console.error(
    "CLI isolated browser protocol failed; protected evidence: " + output,
  );
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await stop(cli);
  await stop(provider);
  if (proxy) await proxy.close();
  await new Promise((resolve) => configServer.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
