import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const { values } = parseArgs({ options: { output: { type: "string" } } });
const mapsRoot = fileURLToPath(new URL("..", import.meta.url));
const teaRoot = fileURLToPath(new URL("../../..", import.meta.url));
const serviceRoot = join(teaRoot, "apps/maps-service");
const collaborationRoot = join(teaRoot, "apps/maps-collaboration");
const state = await mkdtemp(join(tmpdir(), "tea-maps-hosted-smoke-"));
const secret = randomBytes(32).toString("hex");
const processes = [];
const result = { status: "running", checks: [], state };
let browser;
let fourm;
let compiler;

async function showEditorMenu(page, name) {
  await page.locator(".editor-menu").evaluateAll((menus, selected) => {
    for (const menu of menus) menu.open = menu.dataset.menu === selected;
  }, name);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function command(binary, args, cwd, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
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
              `${binary} ${args.join(" ")} exited ${code}\n${output.slice(-12000)}`,
            ),
          ),
    );
  });
}

function start(name, binary, args, cwd, env) {
  const child = spawn(binary, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const processState = { name, child, logs: "", error: null };
  child.stdout.on("data", (chunk) => (processState.logs += chunk));
  child.stderr.on("data", (chunk) => (processState.logs += chunk));
  child.once("error", (error) => (processState.error = error));
  processes.push(processState);
  return processState;
}

async function ready(processState, url, accept = (response) => response.ok) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (processState.error) throw processState.error;
    if (
      processState.child.exitCode !== null ||
      processState.child.signalCode !== null
    )
      throw new Error(
        `${processState.name} exited\n${processState.logs.slice(-12000)}`,
      );
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (accept(response)) return;
    } catch {}
    await delay(200);
  }
  throw new Error(
    `${processState.name} did not become ready\n${processState.logs.slice(-12000)}`,
  );
}

async function stop(processState) {
  const child = processState.child;
  if (!child.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  process.kill(-child.pid, "SIGKILL");
  let timer;
  try {
    await Promise.race([
      exited,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${processState.name} did not stop`)),
          10_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

try {
  const [servicePort, collaborationPort, fourmPort, compilerPort, mapsPort] =
    await Promise.all([
      freePort(),
      freePort(),
      freePort(),
      freePort(),
      freePort(),
    ]);
  const mapsOrigin = `http://localhost:${mapsPort}`;
  const serviceOrigin = `http://127.0.0.1:${servicePort}`;
  const collaborationOrigin = `http://127.0.0.1:${collaborationPort}`;
  const fourmOrigin = `http://127.0.0.1:${fourmPort}`;
  const compilerOrigin = `http://127.0.0.1:${compilerPort}`;
  const bsp = Buffer.alloc(124);
  bsp.writeInt32LE(29, 0);
  const compileRequests = [];
  let authorizationCount = 0;
  fourm = createHttpServer((request, response) => {
    const url = new URL(request.url, fourmOrigin);
    if (url.pathname === "/oauth/authorize") {
      const callback = new URL(url.searchParams.get("redirect_uri"));
      assert.equal(callback.origin, mapsOrigin);
      callback.searchParams.set("state", url.searchParams.get("state"));
      callback.searchParams.set(
        "code",
        `disposable-code-${++authorizationCount}`,
      );
      response.writeHead(302, { Location: callback.toString() }).end();
    } else if (url.pathname === "/oauth/token") {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        const parameters = new URLSearchParams(body);
        if (parameters.get("grant_type") === "client_credentials") {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              access_token: "disposable-machine-token",
              token_type: "Bearer",
              expires_in: 3600,
            }),
          );
          return;
        }
        const code = parameters.get("code");
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            access_token: `disposable-token-${code?.split("-").at(-1)}`,
            token_type: "Bearer",
          }),
        );
      });
    } else if (url.pathname === "/oauth/userinfo") {
      const second =
        request.headers.authorization === "Bearer disposable-token-2";
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          sub: second ? "tea-smoke-viewer" : "tea-smoke",
          username: second ? "observer" : "mapper",
          display_name: second ? "Test Observer" : "Test Mapper",
          is_admin: false,
        }),
      );
    } else response.writeHead(404).end();
  });
  await new Promise((resolve) => fourm.listen(fourmPort, "127.0.0.1", resolve));
  compiler = createHttpServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/compile") {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const input = JSON.parse(body);
      compileRequests.push(input);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          status: "succeeded",
          buildId: "disposable-native-build",
          sourceDocumentRevision: input.expectedDocumentRevision,
          diagnostics: [],
          logs: [{ stage: "qbsp", text: "fixture build", truncated: false }],
          elapsedMilliseconds: 7,
          artifacts: [
            {
              name: "smoke.bsp",
              kind: "bsp",
              mediaType: "application/octet-stream",
              base64: bsp.toString("base64"),
            },
          ],
        }),
      );
    });
  });
  await new Promise((resolve) =>
    compiler.listen(compilerPort, "127.0.0.1", resolve),
  );

  await command(
    "npm",
    ["run", "build", "--workspace", "@tea/maps-service"],
    teaRoot,
  );
  await command(process.execPath, ["scripts/build.mjs", "--dev"], mapsRoot);
  const secrets = join(state, "collaboration.env");
  await writeFile(secrets, `TEA_MAPS_REALTIME_TICKET_SECRET=${secret}\n`);
  const collaboration = start(
    "collaboration",
    join(teaRoot, "node_modules/.bin/wrangler"),
    [
      "dev",
      "--port",
      String(collaborationPort),
      "--persist-to",
      join(state, "collaboration"),
      "--env-file",
      secrets,
    ],
    collaborationRoot,
    process.env,
  );
  await ready(
    collaboration,
    `${collaborationOrigin}/sync/maps/unknown/snapshot`,
    () => true,
  );
  const service = start(
    "service",
    process.execPath,
    ["dist/server.js"],
    serviceRoot,
    {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(servicePort),
      TEA_MAPS_DATA_ROOT: join(state, "service"),
      TEA_MAPS_URL: mapsOrigin,
      TEA_MAPS_COLLABORATION_URL: collaborationOrigin,
      TEA_MAPS_REALTIME_TICKET_SECRET: secret,
      FOURM_URL: fourmOrigin,
      TEA_MAPS_ARTBIN_URL: fourmOrigin,
      TEA_MAPS_ARTBIN_CLIENT_ID: "maps-smoke",
      TEA_MAPS_ARTBIN_CLIENT_SECRET: "disposable-secret",
      TEA_MAPS_QUAKE_COMPILER_URL: compilerOrigin,
    },
  );
  await ready(service, `${serviceOrigin}/health`);
  const maps = start(
    "maps",
    join(teaRoot, "node_modules/.bin/wrangler"),
    [
      "dev",
      "--config",
      "wrangler.dev.jsonc",
      "--port",
      String(mapsPort),
      "--var",
      `MAPS_SERVICE_ORIGIN:${serviceOrigin}`,
      "--var",
      `MAPS_COLLABORATION_ORIGIN:${collaborationOrigin}`,
    ],
    mapsRoot,
    {
      ...process.env,
    },
  );
  await ready(maps, `${mapsOrigin}/new-map`);

  browser = await chromium.launch({ headless: true });
  const owner = await browser.newPage();
  const ownerErrors = [];
  owner.on("pageerror", (error) => ownerErrors.push(error.message));
  await owner.goto(`${mapsOrigin}/projects`);
  await owner.getByText("Sign in to browse hosted projects").waitFor();
  assert.equal(
    (await owner.request.get(`${mapsOrigin}/api/projects`)).status(),
    401,
  );
  result.checks.push("signed-out project API rejects requests");

  await owner.locator("#projects-login").click();
  await owner.getByText("Signed in as Test Mapper").waitFor();
  await owner.locator("#projects-create summary").click();
  await owner.locator("#projects-create-name").fill("Smoke Project");
  await owner.locator("#projects-create-form button").click();
  await owner.waitForURL(/\/projects\/[a-z0-9]{12}$/);
  await owner.getByText("No maps in this project yet").waitFor();
  const projectUrl = owner.url();
  result.checks.push("OAuth login creates a hosted project");

  const observer = await browser.newPage();
  await observer.goto(`${mapsOrigin}/projects`);
  await observer.locator("#projects-login").click();
  await observer.getByText("Signed in as Test Observer").waitFor();
  await owner.locator("#project-access-tab").click();
  await owner
    .getByRole("combobox", { name: "Access role for Test Observer" })
    .selectOption("editor");
  await owner.getByRole("button", { name: "Add" }).click();
  await owner.getByText("2 members · showing 2 of 2 matching users").waitFor();

  await owner.goto(projectUrl);
  await owner.getByRole("link", { name: "New map" }).click();
  await owner.locator("#project-map-name").fill("smoke.map");
  await owner.locator("#project-map-create-form button").click();
  await owner.waitForURL(/\/editor\?hostedMap=[a-z0-9]{12}$/);
  await owner.getByText("Smoke Project / smoke.map opened").waitFor();
  const editorUrl = owner.url();
  const mapId = new URL(editorUrl).searchParams.get("hostedMap");
  await owner
    .locator("#hosted-presence-toggle")
    .getByText("Live · 1")
    .waitFor();
  await observer.goto(editorUrl);
  await owner
    .locator("#hosted-presence-toggle")
    .getByText("Live · 2")
    .waitFor();
  await observer
    .locator("#hosted-presence-toggle")
    .getByText("Live · 2")
    .waitFor();
  result.checks.push("two authorized editors join a hosted map");

  const before = Number(await owner.locator("#brush-count").textContent());
  await observer.locator("#inspector-tab-entity").click();
  await observer.locator("#add-box:not([disabled])").click();
  await owner.waitForFunction(
    (count) =>
      Number(document.querySelector("#brush-count")?.textContent) === count + 1,
    before,
  );
  await observer.locator("#undo:not([disabled])").click();
  await owner.waitForFunction(
    (count) =>
      Number(document.querySelector("#brush-count")?.textContent) === count,
    before,
  );
  result.checks.push("collaborative edit and undo reach the other editor");

  await observer.close();
  await owner.locator("#inspector-tab-entity").click();
  await owner.locator("#add-box:not([disabled])").click();
  await owner.waitForFunction(
    (count) =>
      Number(document.querySelector("#brush-count")?.textContent) === count + 1,
    before,
  );
  await owner.getByText(/Hosted map saved/).waitFor({ timeout: 20_000 });
  await owner.reload();
  await owner.waitForFunction(() =>
    document
      .querySelector("#editor-status")
      ?.textContent?.includes("live editing"),
  );
  assert.equal(
    Number(await owner.locator("#brush-count").textContent()),
    before + 1,
  );
  result.checks.push("hosted edit survives reload");

  await showEditorMenu(owner, "build");
  await owner.locator("#hosted-builds summary").click();
  const buildMapVersion = (
    await (await owner.request.get(`${mapsOrigin}/api/maps/${mapId}`)).json()
  ).map.mapVersion;
  await owner.locator("#build-map").click();
  const download = owner.getByRole("link", { name: "Download BSP" });
  await download.waitFor({ timeout: 15_000 });
  const artifact = await owner.request.get(
    `${mapsOrigin}${await download.getAttribute("href")}`,
  );
  assert.equal(artifact.status(), 200);
  assert.deepEqual(await artifact.body(), bsp);
  assert.equal(compileRequests.length, 1);
  assert.equal(compileRequests[0].expectedDocumentRevision, buildMapVersion);
  result.checks.push(
    "hosted build reaches compiler and serves its BSP artifact",
  );
  assert.deepEqual(ownerErrors, []);
  result.status = "passed";
} catch (error) {
  result.status = "failed";
  result.error = error instanceof Error ? error.stack : String(error);
  result.logs = Object.fromEntries(
    processes.map(({ name, logs }) => [name, logs.slice(-12000)]),
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const processState of processes.toReversed()) {
    try {
      await stop(processState);
    } catch (error) {
      result.status = "failed";
      result.error = `${result.error ?? ""}\nCleanup: ${String(error)}`;
      process.exitCode = 1;
    }
  }
  if (fourm) await new Promise((resolve) => fourm.close(resolve));
  if (compiler) {
    compiler.closeAllConnections();
    await new Promise((resolve) => compiler.close(resolve));
  }
  if (values.output) {
    await mkdir(dirname(values.output), { recursive: true });
    await writeFile(values.output, JSON.stringify(result, null, 2) + "\n");
  }
  if (result.status === "passed")
    await rm(state, { recursive: true, force: true });
  console.log(JSON.stringify(result));
}
