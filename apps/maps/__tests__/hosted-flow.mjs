import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

async function installViewerLoadProbe(page) {
  await page.addInitScript(() => {
    window.teaMapsViewerElementReady = false;
    window.teaMapsViewerSourceStarted = false;
    window.teaMapsViewerLoadSettled = false;
    window.addEventListener(
      "tea-maps-viewer-element-ready",
      () => {
        window.teaMapsViewerElementReady = true;
      },
      { once: true },
    );
    window.addEventListener("tea-maps-open-source", () => {
      window.teaMapsViewerSourceStarted = true;
      window.teaMapsViewerLoadSettled = false;
    });
    for (const type of ["ready", "error"])
      document.addEventListener(
        type,
        (event) => {
          if (
            window.teaMapsViewerSourceStarted &&
            event.target?.localName === "world-view"
          )
            window.teaMapsViewerLoadSettled = true;
        },
        true,
      );
  });
}

async function installSiteToolMock(page) {
  await page.addInitScript(() => {
    const tools = new Map();
    Object.defineProperty(document, "modelContext", {
      value: {
        registerTool(tool) {
          tools.set(tool.name, tool);
        },
      },
    });
    window.teaMapsTestTools = tools;
  });
}

try {
  const [servicePort, collaborationPort, fourmPort, compilerPort] =
    await Promise.all([freePort(), freePort(), freePort(), freePort()]);
  const mapsOrigin = "http://localhost:8790";
  const serviceOrigin = `http://127.0.0.1:${servicePort}`;
  const collaborationOrigin = `http://127.0.0.1:${collaborationPort}`;
  const fourmOrigin = `http://127.0.0.1:${fourmPort}`;
  const compilerOrigin = `http://127.0.0.1:${compilerPort}`;
  const bsp = Buffer.alloc(124);
  bsp.writeInt32LE(29, 0);
  const compileRequests = [];
  const artbinContent = Buffer.from('@PointClass = catalog : "Catalog" []');
  const artbinAsset = {
    id: "catalog-fgd",
    name: "catalog.fgd",
    path: "definitions/catalog.fgd",
    kind: "fgd",
    mimeType: "text/plain",
    size: artbinContent.length,
    sha256: createHash("sha256").update(artbinContent).digest("hex"),
    width: null,
    height: null,
    folder: null,
    tags: [],
  };
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
    } else if (
      request.headers.authorization === "Bearer disposable-machine-token" &&
      url.pathname === "/api/assets"
    ) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ assets: [artbinAsset], nextCursor: null }));
    } else if (
      request.headers.authorization === "Bearer disposable-machine-token" &&
      url.pathname === `/api/assets/${artbinAsset.id}`
    ) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ asset: artbinAsset }));
    } else if (
      request.headers.authorization === "Bearer disposable-machine-token" &&
      url.pathname === `/api/assets/${artbinAsset.id}/content` &&
      url.searchParams.get("sha256") === artbinAsset.sha256
    ) {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end(artbinContent);
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
      ARTBIN_URL: fourmOrigin,
      FOURM_SERVICE_CLIENT_ID: "maps-smoke",
      FOURM_SERVICE_CLIENT_SECRET: "disposable-secret",
      TEA_MAPS_QUAKE_COMPILER_URL: compilerOrigin,
    },
  );
  await ready(service, `${serviceOrigin}/health`);
  const maps = start(
    "maps",
    join(teaRoot, "node_modules/.bin/cf"),
    ["dev"],
    mapsRoot,
    {
      ...process.env,
      TEA_MAPS_SERVICE_ORIGIN: serviceOrigin,
      TEA_MAPS_COLLABORATION_ORIGIN: collaborationOrigin,
    },
  );
  await ready(maps, `${mapsOrigin}/new-map`);

  browser = await chromium.launch({ headless: true });
  const setupPage = await browser.newPage();
  await setupPage.goto(`${mapsOrigin}/new-map`);
  await setupPage.locator("#new-map-form[data-client-ready=true]").waitFor();
  await setupPage.locator("#new-map-name").fill("smoke.map");
  await setupPage.locator("#new-map-game").selectOption("quake2");
  assert.equal(
    await setupPage.locator("#new-map-format").inputValue(),
    "quake",
  );
  await setupPage
    .getByText(/Quake II source maps with classic faces/)
    .waitFor();
  await setupPage.locator("#new-map-game").selectOption("goldsrc");
  assert.equal(
    await setupPage.locator("#new-map-format").inputValue(),
    "valve-220",
  );
  assert.equal(
    await setupPage.locator("#new-map-name").inputValue(),
    "smoke.map",
  );
  await setupPage.getByRole("button", { name: "Open editor" }).click();
  await setupPage.waitForURL(/\/editor\?.*newMap=1/);
  assert.equal(new URL(setupPage.url()).searchParams.get("game"), "goldsrc");
  await setupPage.locator("#document-name").getByText("smoke.map").waitFor();
  await setupPage.close();
  result.checks.push("Remix new-map form keeps name and compatible format");

  const standalonePage = await browser.newPage();
  await standalonePage.goto(`${mapsOrigin}/editor`);
  const editorLayout = await standalonePage.evaluate(() => {
    const toolbar = document.querySelector(".editor-toolbar");
    const viewports = document.querySelector(".viewports");
    return {
      viewportHeight: viewports?.getBoundingClientRect().height ?? 0,
      toolbarHeight: toolbar?.getBoundingClientRect().height ?? 0,
      toolbarContentHeight: toolbar?.scrollHeight ?? 0,
      windowHeight: window.innerHeight,
    };
  });
  assert.ok(editorLayout.viewportHeight >= editorLayout.windowHeight * 0.55);
  assert.ok(editorLayout.toolbarHeight < editorLayout.toolbarContentHeight);
  assert.equal(
    await standalonePage.locator('[data-viewport-overlay="lasso"]').count(),
    4,
  );
  assert.equal(
    await standalonePage
      .locator('[data-viewport-overlay="transform-readout"]')
      .count(),
    4,
  );
  await standalonePage.locator("#toggle-inspector").click();
  assert.equal(
    await standalonePage.locator("#editor-inspector").isVisible(),
    false,
  );
  await standalonePage.reload();
  await standalonePage.waitForFunction(
    () =>
      document.querySelector(".editor-workspace")?.dataset.inspectorOpen ===
      "false",
  );
  assert.equal(
    await standalonePage.locator("#editor-inspector").isVisible(),
    false,
  );
  await standalonePage.locator("#toggle-inspector").click();
  assert.equal(
    await standalonePage.locator("#editor-inspector").isVisible(),
    true,
  );
  await standalonePage.locator("#document-summary summary").click();
  assert.equal(await standalonePage.locator("#brush-count").textContent(), "0");
  await standalonePage.locator("#example-map").click();
  await standalonePage.waitForFunction(
    () => document.querySelector("#brush-count")?.textContent === "3",
  );
  await standalonePage.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("tea-maps-pointer-position", {
        detail: { viewport: "xy", point: [64, 128, 0], surfaceNormal: null },
      }),
    ),
  );
  await standalonePage.getByText("XY · 64, 128, 0").waitFor();
  await standalonePage.locator("#game-profile").selectOption("quake");
  await standalonePage.getByText("Map resources", { exact: true }).click();
  await standalonePage.locator("#standalone-palette").setInputFiles({
    name: "custom.lmp",
    mimeType: "application/octet-stream",
    buffer: Buffer.alloc(768, 120),
  });
  await standalonePage
    .getByText(/custom palette · custom.lmp palette loaded/)
    .waitFor();
  await standalonePage.getByRole("button", { name: "Clear resources" }).click();
  await standalonePage.getByText(/0 WADs · Resources cleared/).waitFor();
  await standalonePage.close();
  result.checks.push(
    "standalone resources, document summary, pointer readout, inspector visibility, compact toolbar, and viewport overlays render in the Remix editor",
  );

  const themePage = await browser.newPage();
  await themePage.emulateMedia({ colorScheme: "light" });
  await themePage.goto(`${mapsOrigin}/editor`);
  await themePage.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  assert.equal(await themePage.locator("#editor-theme").inputValue(), "system");
  assert.equal(
    await themePage.evaluate(
      () => getComputedStyle(document.documentElement).backgroundColor,
    ),
    "rgb(238, 245, 238)",
  );
  await themePage.locator("#editor-theme").selectOption("dark");
  await themePage.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await themePage.reload();
  await themePage.waitForFunction(
    () =>
      document.documentElement.dataset.theme === "dark" &&
      document.querySelector("#editor-theme")?.value === "dark",
  );
  assert.equal(await themePage.locator("#editor-theme").inputValue(), "dark");
  await themePage.locator("#editor-theme").selectOption("system");
  await themePage.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  await themePage.emulateMedia({ colorScheme: "dark" });
  await themePage.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await themePage.locator("#editor-fov summary").click();
  await themePage.locator("#editor-fov-value").fill("75");
  await themePage.locator("#editor-fov-value").press("Tab");
  await themePage.waitForFunction(
    () =>
      document.querySelector("#editor-fov-trigger")?.textContent?.trim() ===
      "FOV 75° *",
  );
  await themePage.locator("#editor-fov-save").click();
  await themePage.getByText("Default: 75°").waitFor();
  await themePage.reload();
  await themePage.waitForFunction(
    () =>
      document.querySelector("#editor-fov-trigger")?.textContent?.trim() ===
      "FOV 75°",
  );
  await themePage.locator("#editor-fov summary").click();
  await themePage.locator("#editor-fov-factory").click();
  await themePage.waitForFunction(
    () =>
      document.querySelector("#editor-fov-trigger")?.textContent?.trim() ===
      "FOV 60°",
  );
  await themePage.locator("#editor-fov summary").click();
  await themePage.waitForFunction(
    () => !document.querySelector("#editor-fov")?.open,
  );
  await themePage.locator("#layer-tools summary").click();
  await themePage.locator("#new-layer-name").fill("Sketch");
  await themePage.locator("#create-layer").click();
  await themePage
    .getByRole("option", { name: "Sketch · active" })
    .waitFor({ state: "attached" });
  const sketchLayerId = await themePage.locator("#layer-select").inputValue();
  assert.ok(sketchLayerId);
  await themePage.locator("#layer-name").fill("Plan");
  await themePage.locator("#rename-layer").click();
  await themePage
    .getByRole("option", { name: "Plan · active" })
    .waitFor({ state: "attached" });
  await themePage.locator("#layer-omit").check();
  await themePage.locator("#new-layer-name").fill("Review");
  await themePage.locator("#create-layer").click();
  await themePage
    .getByRole("option", { name: "Review · active" })
    .waitFor({ state: "attached" });
  await themePage.locator("#layer-select").selectOption(sketchLayerId);
  assert.equal(await themePage.locator("#layer-name").inputValue(), "Plan");
  assert.equal(await themePage.locator("#layer-omit").isChecked(), true);
  await themePage.locator("#layer-down").click();
  assert.equal(
    await themePage
      .locator("#layer-select option")
      .last()
      .getAttribute("value"),
    sketchLayerId,
  );
  await themePage.locator("#layer-hidden").check();
  await themePage.locator("#show-all-layers").click();
  assert.equal(await themePage.locator("#layer-hidden").isChecked(), false);
  await themePage.waitForFunction(
    () => !document.querySelector("#snapshot-reference")?.disabled,
  );
  if (
    !(await themePage
      .locator("#reference-tools")
      .evaluate((details) => details.open))
  ) {
    await themePage.locator("#reference-tools summary").click();
  }
  await themePage.waitForFunction(
    () => document.querySelector("#reference-tools")?.open,
    undefined,
    { timeout: 5000 },
  );
  await themePage.locator("#snapshot-reference").click();
  await themePage.waitForFunction(
    () =>
      document.querySelector("#reference-count")?.textContent === "1 loaded",
  );
  const referenceRow = themePage.locator("#reference-list .reference-row");
  await referenceRow.locator("input[type='number']").first().fill("128");
  await referenceRow.locator("input[type='number']").first().press("Tab");
  assert.equal(
    await referenceRow.locator("input[type='number']").first().inputValue(),
    "128",
  );
  await referenceRow.locator("input[type='checkbox']").uncheck();
  await referenceRow.getByRole("button", { name: "Remove" }).click();
  await themePage.waitForFunction(
    () =>
      document.querySelector("#reference-count")?.textContent === "0 loaded",
  );
  await themePage.locator("#reference-file").setInputFiles({
    name: "fixture.map",
    mimeType: "text/plain",
    buffer: Buffer.from(await themePage.locator("#map-source").inputValue()),
  });
  await referenceRow.getByText("fixture.map").waitFor();
  await themePage.locator("#clear-references").click();
  await themePage.waitForFunction(
    () =>
      document.querySelector("#reference-count")?.textContent === "0 loaded",
  );
  await themePage.locator("#include-build-source").check();
  await themePage.locator("#export-after-build").check();
  await themePage.reload();
  await themePage.waitForFunction(
    () =>
      document.querySelector("#include-build-source")?.checked &&
      document.querySelector("#export-after-build")?.checked,
  );
  await themePage.evaluate(() => {
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: async () => ({ kind: "directory", name: "Test exports" }),
    });
  });
  await themePage.locator("#include-build-source").uncheck();
  await themePage.locator("#choose-export-directory").click();
  await themePage.getByText("Destination: Test exports").waitFor();
  await themePage.locator("#use-export-downloads").click();
  await themePage.getByText("Destination: Downloads").waitFor();
  await themePage.close();
  result.checks.push(
    "editor theme, Remix FOV, layers, references, and export settings work without WebGPU",
  );

  const localBuildPage = await browser.newPage();
  await localBuildPage.addInitScript((bspBase64) => {
    const originalFetch = window.fetch.bind(window);
    window.teaMapsLocalCompileRequests = [];
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.origin !== "http://127.0.0.1:8788")
        return originalFetch(input, init);
      if (url.pathname === "/capabilities") {
        return Response.json({
          protocolVersion: 1,
          compileProfiles: [
            {
              id: "test-quake",
              label: "Test Quake",
              game: "quake",
              qualities: ["preview", "final"],
            },
          ],
          launchProfiles: [],
        });
      }
      if (url.pathname === "/compile") {
        const request = JSON.parse(init.body);
        window.teaMapsLocalCompileRequests.push(request);
        return Response.json({
          status: "succeeded",
          buildId: "one-shot-build",
          sourceDocumentRevision: request.expectedDocumentRevision,
          diagnostics: [],
          logs: [],
          elapsedMilliseconds: 7,
          artifacts: [
            {
              name: "tea-map.bsp",
              kind: "bsp",
              mediaType: "application/octet-stream",
              base64: bspBase64,
            },
          ],
        });
      }
      return new Response(null, { status: 404 });
    };
  }, bsp.toString("base64"));
  await localBuildPage.goto(`${mapsOrigin}/editor`);
  await localBuildPage.waitForFunction(
    () => !document.querySelector("#build-export-once")?.disabled,
  );
  await localBuildPage.locator("#game-profile").selectOption("goldsrc");
  assert.equal(
    await localBuildPage.locator("#game-profile").inputValue(),
    "goldsrc",
  );
  await localBuildPage.locator("#game-profile").selectOption("quake");
  await localBuildPage.locator("#build-profile").selectOption("final");
  assert.equal(
    await localBuildPage.locator("#export-after-build").isChecked(),
    false,
  );
  const oneShotDownload = localBuildPage.waitForEvent("download");
  await localBuildPage.locator("#build-export-once").click();
  const exportedBuild = await oneShotDownload;
  assert.equal(exportedBuild.suggestedFilename(), "tea-map.bsp");
  assert.deepEqual(await readFile(await exportedBuild.path()), bsp);
  await localBuildPage.waitForFunction(() => {
    const message = document.querySelector("#export-status")?.textContent;
    return !!message && message !== "Preparing bundle…";
  });
  assert.match(
    await localBuildPage.locator("#export-status").textContent(),
    /texture lump is truncated/,
  );
  assert.equal(
    await localBuildPage.evaluate(
      () => window.teaMapsLocalCompileRequests.length,
    ),
    1,
  );
  assert.equal(
    await localBuildPage.evaluate(
      () => window.teaMapsLocalCompileRequests[0].quality,
    ),
    "final",
  );
  assert.equal(
    await localBuildPage.locator("#export-after-build").isChecked(),
    false,
  );
  await localBuildPage.close();
  result.checks.push(
    "one-shot local build export reports bundle failure and downloads BSP without changing preference",
  );

  const documentPage = await browser.newPage();
  await documentPage.goto(`${mapsOrigin}/editor`);
  await documentPage.waitForFunction(
    () => !document.querySelector("#open-map-button")?.disabled,
  );
  const portableSource =
    '{\n"classname" "worldspawn"\n"message" "tea_document_fixture"\n}\n';
  await documentPage.locator("#open-map").setInputFiles({
    name: "portable.map",
    mimeType: "text/plain",
    buffer: Buffer.from(portableSource),
  });
  await documentPage.waitForFunction(() =>
    document
      .querySelector("#map-source")
      ?.value.includes("tea_document_fixture"),
  );
  const mapDownload = documentPage.waitForEvent("download");
  await documentPage.locator("#download-map").click();
  const downloadedMap = await mapDownload;
  assert.equal(downloadedMap.suggestedFilename(), "portable.map");
  assert.equal(
    await readFile(await downloadedMap.path(), "utf8"),
    portableSource,
  );
  const normalizedDownload = documentPage.waitForEvent("download");
  await documentPage.locator("#export-normalized").click();
  assert.equal(
    (await normalizedDownload).suggestedFilename(),
    "portable.normalized.map",
  );
  await documentPage.locator("#new-map").click();
  await documentPage.waitForFunction(
    () =>
      !document
        .querySelector("#map-source")
        ?.value.includes("tea_document_fixture"),
  );
  await documentPage.locator("#example-map").click();
  await documentPage.waitForFunction(() =>
    document
      .querySelector("#map-source")
      ?.value.includes("Worldview editor starter"),
  );
  await documentPage.close();
  result.checks.push(
    "Remix document controls open source, download preserved and normalized copies, and switch maps",
  );

  const sourceEditorPage = await browser.newPage();
  await sourceEditorPage.goto(`${mapsOrigin}/editor`);
  await sourceEditorPage.locator("#inspector-tab-source").click();
  await sourceEditorPage.locator("#map-source:not([disabled])").waitFor();
  const sourceDraftInitial =
    '{\n"classname" "worldspawn"\n"message" "tea_source_draft"\n}\n';
  const editedSource = sourceDraftInitial.replace(
    "source_draft",
    "source_mid_draft",
  );
  await sourceEditorPage.locator("#map-source").fill(sourceDraftInitial);
  await sourceEditorPage.locator("#map-source").evaluate((textarea) => {
    const cursor = textarea.value.indexOf("draft");
    textarea.focus();
    textarea.setSelectionRange(cursor, cursor);
  });
  await sourceEditorPage.keyboard.type("mid_");
  await sourceEditorPage.getByText("Source has unapplied edits").waitFor();
  assert.equal(
    await sourceEditorPage.locator("#map-source").inputValue(),
    editedSource,
  );
  await delay(600);
  await sourceEditorPage.reload();
  await sourceEditorPage.locator("#inspector-tab-source").click();
  await sourceEditorPage.locator("#map-source:not([disabled])").waitFor();
  assert.equal(
    await sourceEditorPage.locator("#map-source").inputValue(),
    editedSource,
  );
  await sourceEditorPage.locator("#apply-source").click();
  const appliedDownload = sourceEditorPage.waitForEvent("download");
  await sourceEditorPage.locator("#download-map").click();
  assert.match(
    await readFile(await (await appliedDownload).path(), "utf8"),
    /tea_source_mid_draft/,
  );
  await sourceEditorPage.close();
  result.checks.push(
    "Remix source editor keeps unapplied drafts through reload and applies them",
  );

  const sourcePage = await browser.newPage();
  await sourcePage.goto(`${mapsOrigin}/?example=quake`);
  await sourcePage.locator("#map-name").getByText("Quake sky").waitFor();
  await sourcePage.locator("#example").selectOption("goldsrc");
  await sourcePage.getByRole("button", { name: "Open example" }).click();
  await sourcePage.waitForURL(/\?example=goldsrc$/);
  await sourcePage.locator("#map-name").getByText("GoldSrc room").waitFor();
  assert.equal(await sourcePage.locator("#movement-mode").count(), 1);
  assert.match(
    (await sourcePage.locator("#camera-position").textContent()) ?? "",
    /^Position: /,
  );
  const movementPage = await browser.newPage();
  await installViewerLoadProbe(movementPage);
  await movementPage.goto(mapsOrigin);
  await movementPage.waitForFunction(
    () => window.teaMapsViewerElementReady && window.teaMapsViewerLoadSettled,
  );
  await movementPage.locator("#viewport world-view").waitFor();
  await movementPage.evaluate(() => {
    const element = document.querySelector("#viewport world-view");
    const settings = {
      maxSpeed: 300,
      accelerate: 10,
      airAccelerate: 10,
      friction: 4,
      stopSpeed: 100,
      mouseSensitivity: 1,
      mouseAcceleration: 0,
      viewBob: 0.5,
    };
    const calls = [];
    Object.defineProperty(element, "viewer", {
      configurable: true,
      value: {
        world: {},
        movement: settings,
        setMovement(update) {
          calls.push(update);
          Object.assign(settings, update);
          element.dispatchEvent(
            new CustomEvent("movementchange", {
              detail: { mode: "walk", settings },
            }),
          );
        },
      },
    });
    window.movementProbe = { settings, calls };
  });
  await movementPage.waitForFunction(() => {
    const element = document.querySelector("#viewport world-view");
    element.dispatchEvent(
      new CustomEvent("movementchange", {
        detail: { mode: "walk", settings: window.movementProbe.settings },
      }),
    );
    const input = document.querySelector("#movement-max-speed");
    return !input.disabled && input.value === "300";
  });
  assert.equal(
    await movementPage.locator("#movement-max-speed").inputValue(),
    "300",
  );
  await movementPage.locator("details.movement-settings summary").click();
  await movementPage.locator("#movement-max-speed").fill("320");
  assert.equal(
    await movementPage.locator("#movement-max-speed").inputValue(),
    "320",
  );
  await movementPage.locator("#movement-max-speed").press("Tab");
  const movementCalls = await movementPage.evaluate(
    () => window.movementProbe.calls,
  );
  assert.deepEqual(movementCalls, [{ maxSpeed: 320 }]);
  await movementPage.close();
  result.checks.push("Remix viewer movement settings update renderer controls");
  const cameraPage = await browser.newPage();
  const cameraPageErrors = [];
  const cameraRequestFailures = [];
  cameraPage.on("pageerror", (error) => cameraPageErrors.push(error.message));
  cameraPage.on("requestfailed", (request) =>
    cameraRequestFailures.push(
      `${request.url()}: ${request.failure()?.errorText}`,
    ),
  );
  await installViewerLoadProbe(cameraPage);
  await cameraPage.goto(mapsOrigin);
  await cameraPage.waitForFunction(
    () => window.teaMapsViewerElementReady && window.teaMapsViewerLoadSettled,
  );
  await cameraPage.locator("#viewport world-view").waitFor();
  await cameraPage.evaluate(() => {
    const element = document.querySelector("#viewport world-view");
    const camera = {
      position: [0, 0, 0],
      yaw: 0,
      pitch: 0,
      fieldOfView: 75,
    };
    const world = {
      models: [],
      entities: [],
      faces: [],
      batches: [],
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      musicTracks: [
        {
          entityIndex: 7,
          reference: { basename: "theme.ogg" },
          targetName: "Theme",
        },
      ],
    };
    const calls = [];
    const captureCalls = [];
    const walkabilityCalls = [];
    const audioCalls = [];
    const audio = {
      enabled: false,
      suspended: false,
      muted: false,
      volume: 0.8,
      playerVolume: 1,
      musicVolume: 1,
      musicPlaying: false,
      musicEntityIndex: null,
      roomType: 0,
    };
    const graph = {
      format: "worldview-walkability",
      version: 1,
      worldFingerprint: "smoke",
      parameters: {
        spacing: 48,
        mergeDistance: 16,
        directions: 4,
        maximumNodes: 100,
        allowJump: false,
        jumpSeconds: 0.3,
        fixedDeltaSeconds: 0.05,
        movement: {
          gravity: 800,
          stopSpeed: 100,
          maxSpeed: 320,
          accelerate: 10,
          airAccelerate: 10,
          friction: 4,
          edgeFriction: 2,
          stepSize: 18,
        },
      },
      seeds: [],
      nodes: [],
      edges: [],
      boundaries: [],
      statistics: {
        nodes: 0,
        edges: 0,
        walkEdges: 0,
        jumpEdges: 0,
        dropEdges: 0,
        boundaries: 0,
        components: 0,
        truncated: false,
      },
    };
    window.cameraProbe = {
      camera,
      calls,
      world,
      captureCalls,
      walkabilityCalls,
      audioCalls,
    };
    function emitAudioChange() {
      element.dispatchEvent(
        new CustomEvent("audiochange", { detail: { state: { ...audio } } }),
      );
    }
    Object.defineProperty(element, "viewer", {
      configurable: true,
      value: {
        world,
        camera,
        audio,
        movementMode: "walk",
        walkability: null,
        setCamera(update) {
          calls.push(update);
          Object.assign(camera, update);
        },
        async captureOverview(options) {
          captureCalls.push(options);
          return {
            image: new Blob(["png"], { type: "image/png" }),
            layout: {
              width: options.width,
              height: options.height,
              rotation: options.rotation,
            },
          };
        },
        async generateWalkability(options) {
          walkabilityCalls.push({
            spacing: options.spacing,
            allowJump: options.allowJump,
          });
          options.onProgress({ nodes: 0 });
          return graph;
        },
        setWalkability(value) {
          this.walkability = value;
          element.dispatchEvent(
            new CustomEvent("walkabilitychange", {
              detail: {
                walkability: value,
                visible: element.walkabilityVisible,
              },
            }),
          );
        },
        async enableAudio() {
          audioCalls.push({ action: "enable" });
          audio.enabled = true;
          emitAudioChange();
        },
        setAudioMuted(value) {
          audioCalls.push({ action: "mute", value });
          audio.muted = value;
          emitAudioChange();
        },
        setAudioVolume(value) {
          audioCalls.push({ action: "volume", value });
          audio.volume = value;
          emitAudioChange();
        },
        setPlayerAudioVolume(value) {
          audioCalls.push({ action: "playerVolume", value });
          audio.playerVolume = value;
          emitAudioChange();
        },
        setMusicVolume(value) {
          audioCalls.push({ action: "musicVolume", value });
          audio.musicVolume = value;
          emitAudioChange();
        },
        async playMusic(entityIndex) {
          audioCalls.push({ action: "play", entityIndex });
          audio.musicEntityIndex = entityIndex;
          audio.musicPlaying = true;
          emitAudioChange();
        },
        stopMusic() {
          audioCalls.push({ action: "stop" });
          audio.musicPlaying = false;
          emitAudioChange();
        },
      },
    });
  });
  try {
    await cameraPage.waitForFunction(
      () => {
        const world = window.cameraProbe.world;
        const diagnostics = {
          format: "quake",
          version: 29,
          triangles: 0,
          faces: 0,
          batches: 0,
          materials: 0,
          lightmapPages: 0,
          sprites: 0,
          loadedSounds: 0,
          loadedMusic: 0,
          playerSounds: 0,
          loadMilliseconds: 0,
          warnings: [],
        };
        window.cameraProbe.diagnostics = diagnostics;
        document
          .querySelector("#viewport world-view")
          .dispatchEvent(
            new CustomEvent("ready", { detail: { world, diagnostics } }),
          );
        return !document.querySelector("#field-of-view").disabled;
      },
      undefined,
      { timeout: 60_000 },
    );
  } catch (error) {
    const viewerState = await cameraPage.evaluate(() => ({
      readyState: document.readyState,
      viewerWorld: !!document.querySelector("#viewport world-view")?.viewer
        ?.world,
      fieldOfView: document.querySelector("#field-of-view")?.outerHTML,
      details: document.querySelector("#map-details")?.textContent,
    }));
    throw new Error(
      `Viewer panels did not become ready: ${JSON.stringify({ viewerState, cameraPageErrors, cameraRequestFailures })}`,
      { cause: error },
    );
  }
  await cameraPage.locator("#map-details").getByText("QUAKE 29").waitFor();
  assert.equal(
    await cameraPage.locator("#entity-counts").textContent(),
    "0 supported · 0 partial · 0 baked · 0 skipped",
  );
  assert.equal(
    await cameraPage.locator("#entity-classes li").textContent(),
    "No partial or skipped entity classes",
  );
  await cameraPage.locator("#field-of-view").fill("90");
  assert.equal(await cameraPage.locator("#field-of-view").inputValue(), "90");
  await cameraPage.locator("#field-of-view").press("Tab");
  assert.deepEqual(await cameraPage.evaluate(() => window.cameraProbe.calls), [
    { fieldOfView: 90 },
  ]);
  await cameraPage.evaluate(() => {
    window.cameraProbe.camera.fieldOfView = 80;
    document.querySelector("#viewport world-view").dispatchEvent(
      new CustomEvent("ready", {
        detail: {
          world: window.cameraProbe.world,
          diagnostics: window.cameraProbe.diagnostics,
        },
      }),
    );
  });
  await cameraPage.waitForFunction(
    () => document.querySelector("#field-of-view")?.value === "80",
  );
  await cameraPage.locator("#download-overview:enabled").waitFor();
  await cameraPage.locator("#overview-z-min").fill("2");
  await cameraPage.locator("#download-overview").click();
  assert.equal(
    await cameraPage.locator("#overview-status").textContent(),
    "Lower height must not exceed upper height",
  );
  assert.deepEqual(
    await cameraPage.evaluate(() => window.cameraProbe.captureCalls),
    [],
  );
  await cameraPage.locator("#overview-z-min").fill("0");
  await cameraPage.locator("#overview-size").selectOption("1024x768");
  await cameraPage.locator("#overview-lighting").selectOption("fullbright");
  await cameraPage.locator("#overview-rotation").selectOption("90");
  await cameraPage.locator("#overview-cutaway").uncheck();
  await cameraPage.locator("#overview-transparent").uncheck();
  const [overviewDownload] = await Promise.all([
    cameraPage.waitForEvent("download"),
    cameraPage.locator("#download-overview").click(),
  ]);
  assert.match(overviewDownload.suggestedFilename(), /-overview\.png$/);
  assert.deepEqual(
    await cameraPage.evaluate(() => window.cameraProbe.captureCalls),
    [
      {
        width: 1024,
        height: 768,
        lighting: "fullbright",
        rotation: 90,
        zMin: 0,
        zMax: 1,
        cutaway: "none",
        background: [0.025, 0.035, 0.03, 1],
      },
    ],
  );
  await cameraPage.locator("#generate-walkability:enabled").waitFor();
  await cameraPage.locator("#walkability-spacing").fill("4");
  await cameraPage.locator("#generate-walkability").click();
  assert.equal(
    await cameraPage.locator("#walkability-status").textContent(),
    "Spacing must be between 8 and 128",
  );
  assert.deepEqual(
    await cameraPage.evaluate(() => window.cameraProbe.walkabilityCalls),
    [],
  );
  await cameraPage.locator("#walkability-spacing").fill("48");
  await cameraPage.locator("#walkability-jumps").uncheck();
  await cameraPage.locator("#generate-walkability").click();
  await cameraPage
    .locator("#walkability-status")
    .getByText("Walkability graph ready")
    .waitFor();
  assert.deepEqual(
    await cameraPage.evaluate(() => window.cameraProbe.walkabilityCalls),
    [{ spacing: 48, allowJump: false }],
  );
  assert.equal(await cameraPage.locator("#show-walkability").isChecked(), true);
  assert.equal(
    await cameraPage.locator("#walkability-details").textContent(),
    "0 nodes · 0 edges",
  );
  const [sidecarDownload] = await Promise.all([
    cameraPage.waitForEvent("download"),
    cameraPage.locator("#download-walkability").click(),
  ]);
  assert.match(
    sidecarDownload.suggestedFilename(),
    /\.tea-maps-walkability\.json$/,
  );
  await cameraPage.locator("#clear-walkability").click();
  assert.equal(
    await cameraPage.locator("#walkability-details").textContent(),
    "No graph loaded",
  );
  assert.equal(
    await cameraPage.locator("#show-walkability").isDisabled(),
    true,
  );
  await cameraPage.locator("#walkability-file").setInputFiles({
    name: "graph.json",
    mimeType: "application/json",
    buffer: Buffer.from("{}"),
  });
  assert.equal(
    await cameraPage.locator("#walkability-status").textContent(),
    "Loading walkability sidecar",
  );
  await cameraPage.evaluate(() => {
    document.querySelector("#viewport world-view").dispatchEvent(
      new CustomEvent("warning", {
        detail: {
          code: "asset-warning",
          message: "walkability sidecar could not be loaded: invalid graph",
        },
      }),
    );
  });
  assert.equal(
    await cameraPage.locator("#walkability-status").textContent(),
    "walkability sidecar could not be loaded: invalid graph",
  );
  assert.match(
    (await cameraPage.locator("#map-warnings").textContent()) ?? "",
    /walkability sidecar could not be loaded: invalid graph/,
  );
  assert.equal(
    await cameraPage.locator("#map-tool-status").textContent(),
    "walkability sidecar could not be loaded: invalid graph",
  );
  await cameraPage.locator("#enable-audio:enabled").waitFor();
  await cameraPage.locator("#enable-audio").click();
  assert.equal(
    await cameraPage.locator("#audio-details").textContent(),
    "Sound enabled",
  );
  await cameraPage.locator("#mute-audio").check();
  await cameraPage.locator("#audio-volume").focus();
  await cameraPage.locator("#audio-volume").press("ArrowRight");
  await cameraPage.locator("#player-volume").focus();
  await cameraPage.locator("#player-volume").press("ArrowLeft");
  await cameraPage.locator("#music-volume").focus();
  await cameraPage.locator("#music-volume").press("ArrowLeft");
  await cameraPage.locator("#play-music").click();
  assert.equal(
    await cameraPage.locator("#music-status").textContent(),
    "Playing",
  );
  await cameraPage.locator("#stop-music").click();
  assert.equal(
    await cameraPage.locator("#music-status").textContent(),
    "Stopped",
  );
  const audioCalls = await cameraPage.evaluate(
    () => window.cameraProbe.audioCalls,
  );
  assert.deepEqual(
    audioCalls.filter((call) => call.action === "enable"),
    [{ action: "enable" }],
  );
  assert.deepEqual(
    audioCalls.filter((call) => call.action === "mute"),
    [{ action: "mute", value: true }],
  );
  assert.ok(
    audioCalls.some((call) => call.action === "volume" && call.value > 0.8),
  );
  assert.ok(
    audioCalls.some((call) => call.action === "playerVolume" && call.value < 1),
  );
  assert.ok(
    audioCalls.some((call) => call.action === "musicVolume" && call.value < 1),
  );
  assert.deepEqual(
    audioCalls.filter((call) => call.action === "play"),
    [{ action: "play", entityIndex: 7 }],
  );
  assert.deepEqual(
    audioCalls.filter((call) => call.action === "stop"),
    [{ action: "stop" }],
  );
  await cameraPage.evaluate(() =>
    window.dispatchEvent(new Event("tea-maps-viewer-reset")),
  );
  assert.equal(
    await cameraPage.locator("#map-details").textContent(),
    "Loading map",
  );
  assert.equal(await cameraPage.locator("#map-tool-status").textContent(), "");
  await cameraPage.close();
  result.checks.push("Remix viewer field of view accepts typed camera values");
  result.checks.push(
    "Remix viewer overview validates and downloads capture options",
  );
  result.checks.push(
    "Remix viewer walkability generates and downloads Tea sidecars",
  );
  result.checks.push(
    "Remix viewer audio controls follow renderer playback state",
  );
  result.checks.push("Remix viewer diagnostics render map and warning state");
  const viewerFolder = join(state, "viewer-fixture");
  await mkdir(join(viewerFolder, "maps"), { recursive: true });
  await writeFile(join(viewerFolder, "maps", "folder.bsp"), bsp);
  await writeFile(
    join(viewerFolder, "maps", "folder.tea-maps.json"),
    JSON.stringify({ label: "Folder smoke" }),
  );
  await sourcePage.locator("#folder").setInputFiles(viewerFolder);
  await sourcePage.getByText("1 map found").waitFor();
  await sourcePage.getByRole("button", { name: "Open folder map" }).click();
  await sourcePage.locator("#map-name").getByText("Folder smoke").waitFor();
  await sourcePage.locator("#files").setInputFiles({
    name: "smoke.bsp",
    mimeType: "application/octet-stream",
    buffer: bsp,
  });
  await sourcePage.getByRole("button", { name: "Open files" }).click();
  await sourcePage.locator("#map-name").getByText("smoke.bsp").waitFor();
  assert.equal(new URL(sourcePage.url()).search, "");
  await sourcePage.evaluate(
    (bytes) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array(bytes)], "dropped.bsp", {
          type: "application/octet-stream",
        }),
      );
      document.querySelector(".shell").dispatchEvent(
        new DragEvent("dragenter", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
      window.viewerDropTransfer = transfer;
    },
    [...bsp],
  );
  await sourcePage.locator("#drop-target").waitFor({ state: "visible" });
  await sourcePage.evaluate(() => {
    document.querySelector(".shell").dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: window.viewerDropTransfer,
      }),
    );
  });
  await sourcePage.locator("#drop-target").waitFor({ state: "hidden" });
  await sourcePage.locator("#map-name").getByText("dropped.bsp").waitFor();
  assert.equal(new URL(sourcePage.url()).search, "");
  const remoteBsp = `${mapsOrigin}/missing.bsp`;
  await sourcePage.locator("#bsp-url").fill(remoteBsp);
  await sourcePage.getByRole("button", { name: "Open URL" }).click();
  try {
    await sourcePage
      .locator("#map-name")
      .getByText("missing.bsp")
      .waitFor({ timeout: 5_000 });
  } catch (error) {
    throw new Error(
      `Remote BSP did not open: ${JSON.stringify({
        url: sourcePage.url(),
        input: await sourcePage.locator("#bsp-url").inputValue(),
        name: await sourcePage.locator("#map-name").textContent(),
        status: await sourcePage.locator("#viewer-status").textContent(),
      })}`,
      { cause: error },
    );
  }
  assert.equal(new URL(sourcePage.url()).searchParams.get("bsp"), remoteBsp);
  await sourcePage.reload();
  await sourcePage.locator("#map-name").getByText("missing.bsp").waitFor();
  assert.equal(await sourcePage.locator("#bsp-url").inputValue(), remoteBsp);
  await sourcePage.close();
  result.checks.push(
    "Remix viewer picker opens examples, folders, files, and URLs",
  );
  result.checks.push("Remix viewer chrome opens dropped BSP files");

  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${mapsOrigin}/projects`);
  await page.getByText("Sign in to browse hosted projects").waitFor();
  assert.equal(
    (await page.request.get(`${mapsOrigin}/api/projects`)).status(),
    401,
  );
  result.checks.push("signed-out UI and protected same-origin service proxy");

  await page.goto(`${mapsOrigin}/projects/0123456789ab`);
  await page.getByText("Sign in to open this project").waitFor();
  assert.match(
    await page.locator("#projects-login").getAttribute("href"),
    /returnTo=%2Fprojects%2F0123456789ab/,
  );
  result.checks.push("signed-out hosted map page requests sign-in");
  await page.goto(`${mapsOrigin}/projects`);
  await page.getByText("Sign in to browse hosted projects").waitFor();

  await page.locator("#projects-login").click();
  await page.getByText("Signed in as Test Mapper").waitFor();
  await page.locator("#projects-create summary").click();
  await page.locator("#projects-create-name").fill("Smoke Project");
  await page.locator("#projects-create-form button").click();
  await page.waitForURL(/\/projects\/[a-z0-9]{12}$/);
  try {
    await page.getByText("No maps in this project yet").waitFor();
  } catch (error) {
    throw new Error(
      `Project Maps did not load: ${JSON.stringify({
        url: page.url(),
        status: await page
          .locator("#projects-status")
          .textContent()
          .catch(() => null),
        html: (
          await page
            .locator("#projects-app")
            .innerHTML()
            .catch(() => "")
        ).slice(0, 1600),
        errors,
      })}`,
      { cause: error },
    );
  }
  await page.getByRole("button", { name: "Open local project" }).waitFor();
  const projectUrl = page.url();
  result.checks.push(
    "OAuth callback and hosted project creation through Maps Worker",
  );

  const observer = await browser.newPage();
  await observer.goto(`${mapsOrigin}/projects`);
  await observer.locator("#projects-login").click();
  await observer.getByText("Signed in as Test Observer").waitFor();

  await page.locator("#project-access-tab").click();
  await page.getByText("1 members · showing 2 of 2 matching users").waitFor();
  await page.getByText("Test Mapper · @mapper").waitFor();
  await page
    .getByRole("combobox", { name: "Access role for Test Observer" })
    .selectOption("viewer");
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByText("2 members · showing 2 of 2 matching users").waitFor();
  assert.equal(
    await page
      .getByRole("combobox", { name: "Access role for Test Observer" })
      .inputValue(),
    "viewer",
  );
  await page
    .locator('.project-tabs a[aria-current="page"]')
    .getByText("Access")
    .waitFor();
  await observer.goto(projectUrl);
  await observer.getByText("Smoke Project").first().waitFor();
  assert.equal(await observer.locator("#project-access-tab").isHidden(), true);
  assert.equal(await observer.locator("#project-new-map-tab").isHidden(), true);
  await observer.goto(`${projectUrl}/new-map`);
  await observer.getByText("Editor access required to create a map").waitFor();
  assert.equal(await observer.locator("#project-map-create").isHidden(), true);
  assert.equal(
    (
      await observer.request.get(
        `${mapsOrigin}/api/projects/${projectUrl.split("/").at(-1)}/members`,
      )
    ).status(),
    403,
  );
  await observer.goto(`${projectUrl}/access`);
  await observer
    .getByText("Only the project owner can manage access")
    .waitFor();
  assert.equal(await observer.locator("#project-access-search").count(), 0);
  await observer.getByRole("link", { name: "Resources" }).click();
  await observer.getByText("No project resources yet").waitFor();
  assert.equal(
    await observer.locator("#project-resource-upload").isHidden(),
    true,
  );
  assert.equal(
    await observer.locator("#hosted-artbin-import").isHidden(),
    true,
  );
  result.checks.push("owner grants viewer access with read-only project pages");

  await page.getByRole("link", { name: "Resources" }).click();
  await page.getByText("No project resources yet").waitFor();
  assert.equal(
    await page
      .locator("#project-resource-folder")
      .getAttribute("webkitdirectory"),
    "",
  );
  await page.locator("#hosted-artbin-query").fill("catalog");
  await page.locator('#hosted-artbin-search button[type="submit"]').click();
  await page.getByText("catalog.fgd").waitFor();
  await page.getByRole("button", { name: "Import copy" }).click();
  await page.getByRole("link", { name: "catalog.fgd" }).waitFor();
  const catalogDownload = await page.request.get(
    `${mapsOrigin}${await page.getByRole("link", { name: "catalog.fgd" }).getAttribute("href")}`,
  );
  assert.equal(catalogDownload.status(), 200);
  assert.equal(await catalogDownload.text(), artbinContent.toString());
  await page.getByRole("button", { name: "Remove catalog.fgd" }).click();
  await page.getByText("No project resources yet").waitFor();
  result.checks.push("Artbin search, import copy, download, and removal");
  await page.locator("#project-resource-files").setInputFiles({
    name: "smoke.fgd",
    mimeType: "text/plain",
    buffer: Buffer.from('@PointClass base(Targetname) = smoke : "Smoke" []'),
  });
  await page.locator("#project-resource-upload-button").click();
  await page.getByRole("link", { name: "smoke.fgd" }).waitFor();
  const mounts = await page.request.get(
    `${mapsOrigin}/api/projects/${projectUrl.split("/").at(-1)}/resources`,
  );
  assert.equal(mounts.status(), 200);
  const mountId = (await mounts.json()).mounts[0].id;
  const content = await page.request.get(
    `${mapsOrigin}/api/projects/${projectUrl.split("/").at(-1)}/resources/${mountId}/content`,
  );
  assert.equal(content.status(), 200);
  assert.equal(
    await content.text(),
    '@PointClass base(Targetname) = smoke : "Smoke" []',
  );
  await page.getByRole("button", { name: "Remove smoke.fgd" }).click();
  await page.getByText("No project resources yet").waitFor();
  result.checks.push("project resource upload, listing, and removal");

  await page.goto(projectUrl);
  await page.getByText("No maps in this project yet").waitFor();

  await page.getByRole("link", { name: "New map" }).click();
  await page.waitForURL(`${projectUrl}/new-map`);
  await page.locator("#project-map-name").fill("smoke.map");
  await page.locator("#project-map-create-form button").click();
  await page.waitForURL(/\/editor\?hostedMap=[a-z0-9]{12}$/);
  try {
    await page.getByText("Smoke Project / smoke.map opened").waitFor();
  } catch (error) {
    throw new Error(
      `Created hosted map did not open: ${JSON.stringify({
        url: page.url(),
        status: await page
          .locator("#editor-status")
          .textContent()
          .catch(() => null),
        project: await (
          await page.request.get(
            `${mapsOrigin}/api/projects/${projectUrl.split("/").at(-1)}`,
          )
        )
          .json()
          .catch(() => null),
        errors,
      })}`,
      { cause: error },
    );
  }
  const hostedEditorUrl = page.url();
  await page.locator("#hosted-presence-toggle").getByText("Live · 1").waitFor();
  await page.locator("#hosted-presence-toggle").click();
  assert.equal(
    await page
      .locator("#hosted-editor-picker")
      .evaluate((picker) => picker.open),
    false,
  );
  await page.locator("#hosted-presence-toggle").click();
  assert.equal(
    await page
      .locator("#hosted-editor-picker")
      .evaluate((picker) => picker.open),
    true,
  );
  await page.locator("#hosted-share-link").waitFor({ state: "visible" });
  await observer.goto(hostedEditorUrl);
  await observer.waitForFunction(() =>
    document
      .querySelector("#hosted-participants")
      ?.textContent?.includes("Viewing hosted map"),
  );
  assert.equal(
    await observer.locator("#hosted-participant-list li").count(),
    0,
  );
  await observer
    .locator("#hosted-presence-toggle")
    .getByText("Viewing hosted map")
    .waitFor();
  assert.deepEqual(errors, []);
  result.checks.push("Remix header presence and hosted panel toggle");
  await page.locator("#inspector-tab-face").click();
  await page.locator("#material-filter").fill("no-such-material");
  await page.getByText("No materials match this view").waitFor();
  await page.locator("#material-filter").fill("");
  await page
    .locator("#material-replace-scope")
    .getByText(/No selection.*whole map/)
    .waitFor();
  assert.equal(
    await page
      .locator("#material-grid canvas")
      .first()
      .evaluate((canvas) =>
        Array.from(
          canvas.getContext("2d").getImageData(0, 0, 72, 72).data,
        ).some((value, index) => index % 4 === 3 && value > 0),
      ),
    true,
  );
  await page.locator("#material-current").fill("TEST_MATERIAL");
  assert.equal(
    await page.locator("#box-material").inputValue(),
    "TEST_MATERIAL",
  );
  result.checks.push("Remix material browser filters and activates materials");
  await page.locator("#performance-toggle").click();
  await page.locator("#performance-panel").waitFor({ state: "visible" });
  assert.equal(
    await page.locator("#performance-toggle").getAttribute("aria-pressed"),
    "true",
  );
  await page.locator("#performance-record").click();
  await page.waitForFunction(() =>
    /Recording.*[1-9][0-9]* frames/.test(
      document.querySelector("#performance-capture")?.textContent ?? "",
    ),
  );
  await page.locator("#performance-record").click();
  await page.locator("#performance-report").click();
  const performanceReport = JSON.parse(
    await page.locator("#performance-json").inputValue(),
  );
  assert.ok(performanceReport.summary.frames > 0);
  assert.equal(
    performanceReport.summary.frames,
    performanceReport.samples.length,
  );
  await page.locator("#performance-toggle").click();
  await page.locator("#performance-panel").waitFor({ state: "hidden" });
  result.checks.push(
    "Remix performance panel records and exports frame timings",
  );
  await page.locator("#hosted-project-resources summary").click();
  await page
    .locator("#hosted-resource-list")
    .getByText("No project resources yet")
    .waitFor();
  await page.locator("#hosted-resource-files").setInputFiles({
    name: "editor.fgd",
    mimeType: "text/plain",
    buffer: Buffer.from('@PointClass = editor_smoke : "Editor smoke" []'),
  });
  await page.locator("#hosted-resource-upload-button").click();
  await page
    .locator("#hosted-resource-list")
    .getByRole("link", { name: "editor.fgd" })
    .waitFor();
  await page
    .locator("#hosted-resource-list")
    .getByRole("button", { name: "Remove editor.fgd" })
    .click();
  await page
    .locator("#hosted-resource-list")
    .getByText("No project resources yet")
    .waitFor();
  await page.locator("#hosted-artbin-query").fill("catalog");
  await page.locator('#hosted-artbin-search button[type="submit"]').click();
  await page
    .locator("#hosted-artbin-results")
    .getByText("catalog.fgd")
    .waitFor();
  await page
    .locator("#hosted-artbin-results")
    .getByRole("button", { name: "Import copy" })
    .click();
  await page
    .locator("#hosted-resource-list")
    .getByRole("link", { name: "catalog.fgd" })
    .waitFor();
  await page
    .locator("#hosted-resource-list")
    .getByRole("button", { name: "Remove catalog.fgd" })
    .click();
  await page
    .locator("#hosted-resource-list")
    .getByText("No project resources yet")
    .waitFor();
  result.checks.push("Remix editor resources upload, import, and removal");
  try {
    await page.locator("#hosted-share").waitFor({ state: "visible" });
  } catch (error) {
    throw new Error(
      `Hosted presence did not render: ${JSON.stringify(
        await page.evaluate(() => ({
          state: window.teaMapsHostedPresence,
          share: document.querySelector("#hosted-share")?.outerHTML,
        })),
      )}`,
      { cause: error },
    );
  }
  assert.equal(
    await page.locator("#hosted-share-link").inputValue(),
    hostedEditorUrl,
  );
  await page.getByText("1 person here").waitFor();
  assert.equal(
    await page.evaluate(() => window.teaMapsHostedPresence.connection),
    "connected",
  );
  assert.equal(await page.locator("#hosted-participant-list li").count(), 1);
  await page.locator("#hosted-project-access").waitFor({ state: "visible" });
  await page.locator("#hosted-project-access summary").click();
  await page.locator("#hosted-access-search").fill("observer");
  await page
    .locator("#hosted-access-list")
    .getByText("Test Observer · @observer")
    .waitFor();
  assert.equal(await page.locator("#hosted-access-list li").count(), 1);
  const editorAccessRole = page.locator("#hosted-access-list select");
  assert.equal(await editorAccessRole.isVisible(), true);
  assert.equal(
    await editorAccessRole.getAttribute("aria-label"),
    "Access role for Test Observer",
  );
  assert.equal(await editorAccessRole.inputValue(), "viewer");
  await editorAccessRole.selectOption("editor");
  await page
    .locator("#hosted-access-list")
    .getByRole("button", { name: "Update" })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector("#hosted-access-status")
      ?.textContent?.includes("2 members"),
  );
  await observer.goto(hostedEditorUrl);
  await observer
    .locator("#hosted-presence-toggle")
    .getByText("Live · 2")
    .waitFor();
  await page.locator("#hosted-presence-toggle").getByText("Live · 2").waitFor();
  const collaborator = page
    .locator("#hosted-participant-list li")
    .filter({ hasText: "Test Observer" });
  await collaborator.waitFor();
  assert.match(
    await collaborator.getAttribute("data-color"),
    /^(red|orange|yellow|green|cyan|blue|violet|pink)$/,
  );
  await collaborator.getByText("Idle").waitFor();
  const initialBrushCount = Number(
    await page.locator("#brush-count").textContent(),
  );
  await observer.locator("#inspector-tab-entity").click();
  await observer.locator("#add-box:not([disabled])").click();
  await page.waitForFunction(
    (count) =>
      Number(document.querySelector("#brush-count")?.textContent) === count + 1,
    initialBrushCount,
  );
  await observer.locator("#undo:not([disabled])").click();
  await page.waitForFunction(
    (count) =>
      Number(document.querySelector("#brush-count")?.textContent) === count,
    initialBrushCount,
  );
  await observer.close();
  result.checks.push("two hosted editors share presence, edits, and undo");
  result.checks.push(
    "hosted map creation, editor launch, and Remix presence and access UI",
  );
  try {
    await page.waitForFunction(
      () => !document.querySelector("#hosted-source-open")?.disabled,
      null,
      { timeout: 5000 },
    );
  } catch (cause) {
    throw new Error(
      `Hosted source editor did not become available: ${await page.locator("#editor-status").textContent()}`,
      { cause },
    );
  }
  await page.locator("#hosted-source-open").click();
  await page.locator("#hosted-source-dialog").waitFor({ state: "visible" });
  const originalHostedSource = await page
    .locator("#hosted-source-draft")
    .inputValue();
  const revisedHostedSource = `// Format: Valve\n${originalHostedSource}`;
  await page.locator("#hosted-source-draft").fill(revisedHostedSource);
  await page.waitForFunction(
    async ({ mapId, source }) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("tea-maps-hosted-source-drafts", 1);
        request.addEventListener("error", () => reject(request.error));
        request.addEventListener("success", () => resolve(request.result));
      });
      try {
        const draft = await new Promise((resolve, reject) => {
          const request = db
            .transaction("drafts")
            .objectStore("drafts")
            .get(mapId);
          request.addEventListener("error", () => reject(request.error));
          request.addEventListener("success", () => resolve(request.result));
        });
        return draft?.source === source;
      } finally {
        db.close();
      }
    },
    {
      mapId: new URL(hostedEditorUrl).searchParams.get("hostedMap"),
      source: revisedHostedSource,
    },
    { timeout: 5000 },
  );
  const closeDraft = `${revisedHostedSource}// Close before debounce\n`;
  await page.locator("#hosted-source-draft").fill(closeDraft);
  await page.locator("#hosted-source-close").click();
  await page.locator("#hosted-source-open").click();
  try {
    await page
      .getByText("Recovered a source draft from this device")
      .waitFor({ timeout: 5000 });
  } catch (cause) {
    throw new Error(
      `Hosted draft was not recovered: ${JSON.stringify({
        dialogOpen: await page
          .locator("#hosted-source-dialog")
          .evaluate((dialog) => dialog.open),
        status: await page.locator("#hosted-source-status").textContent(),
        source: await page.locator("#hosted-source-draft").inputValue(),
      })}`,
      { cause },
    );
  }
  assert.equal(
    await page.locator("#hosted-source-draft").inputValue(),
    closeDraft,
  );
  await page.locator("#hosted-source-reload").click();
  await page.getByText(/Editing hosted version/).waitFor();
  assert.equal(
    await page.locator("#hosted-source-draft").inputValue(),
    originalHostedSource,
  );
  await page.locator("#hosted-source-draft").fill(revisedHostedSource);
  await page.locator("#hosted-source-save").click();
  await page.locator("#hosted-source-dialog").waitFor({ state: "hidden" });
  const revisedHostedMap = (
    await (
      await page.request.get(
        `${mapsOrigin}/api/maps/${new URL(hostedEditorUrl).searchParams.get("hostedMap")}`,
      )
    ).json()
  ).map;
  assert.equal(revisedHostedMap.source, revisedHostedSource);
  try {
    await page.waitForFunction(
      (source) => document.querySelector("#map-source")?.value === source,
      revisedHostedSource,
      { timeout: 10_000 },
    );
  } catch (cause) {
    throw new Error(
      `Hosted room did not load saved source: ${await page.locator("#editor-status").textContent()}`,
      { cause },
    );
  }
  result.checks.push("Remix hosted source draft recovery, discard, and save");
  assert.equal(await page.locator("#save-map").isDisabled(), true);
  assert.equal(
    await page.locator("#download-map").textContent(),
    "Download copy",
  );
  await page.locator("#create-checkpoint").waitFor({ state: "visible" });
  await page.waitForFunction(
    () => !document.querySelector("#create-checkpoint")?.disabled,
  );
  await page.locator("#checkpoint-label").fill("Before build");
  await page.locator("#create-checkpoint").click();
  await page.getByText(/Hosted checkpoint “Before build” saved/).waitFor();
  await page.waitForFunction(
    () => document.querySelector("#checkpoint-label")?.value === "",
  );
  await page.locator("#show-versions").click();
  await page
    .locator("#versions-list .version-row")
    .filter({ hasText: "Before build" })
    .getByRole("button", { name: "Restore copy" })
    .waitFor();
  await page.locator("#close-versions").click();
  result.checks.push("Remix recovery versions list hosted checkpoints");
  await page.locator("#hosted-builds summary").click();
  await page.getByText("0 builds · hosted compiler available").waitFor();
  assert.equal(await page.locator("#build-export-once").isDisabled(), true);
  assert.equal(await page.locator("#game-profile").isDisabled(), true);
  const buildMapVersion = (
    await (
      await page.request.get(
        `${mapsOrigin}/api/maps/${new URL(hostedEditorUrl).searchParams.get("hostedMap")}`,
      )
    ).json()
  ).map.mapVersion;
  await page.locator("#build-map").click();
  const download = page.getByRole("link", { name: "Download BSP" });
  try {
    await download.waitFor({ timeout: 8000 });
  } catch (cause) {
    throw new Error(
      `Hosted build did not finish: ${JSON.stringify({
        status: await page
          .locator("#build-status")
          .textContent()
          .catch(() => null),
        history: await page.locator("#hosted-builds").textContent(),
        requests: compileRequests.length,
      })}`,
      { cause },
    );
  }
  const artifact = await page.request.get(
    `${mapsOrigin}${await download.getAttribute("href")}`,
  );
  await page.locator("#build-details").waitFor({ state: "visible" });
  assert.match(
    await page.locator("#build-output").textContent(),
    /fixture build/,
  );
  assert.equal(artifact.status(), 200);
  assert.deepEqual(await artifact.body(), bsp);
  assert.equal(compileRequests.length, 1);
  assert.match(compileRequests[0].mapText, /worldspawn/);
  assert.equal(compileRequests[0].expectedDocumentRevision, buildMapVersion);
  await page.waitForFunction(() =>
    /Compiled preview (ready|unavailable)/.test(
      document.querySelector("#build-status")?.textContent ?? "",
    ),
  );
  await page.locator("#build-status").evaluate((status) => {
    window.teaMapsBuildStatusChanges = [];
    new MutationObserver(() => {
      window.teaMapsBuildStatusChanges.push(
        document.querySelector("#build-status")?.textContent ?? "",
      );
    }).observe(status.parentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  await page
    .locator("#hosted-builds-list button")
    .filter({ hasText: "Preview" })
    .click();
  await page.waitForFunction(() =>
    window.teaMapsBuildStatusChanges?.some((message) =>
      /Compiled preview (ready|unavailable)/.test(message),
    ),
  );
  result.checks.push(
    "hosted BSP build queue, compiler request, history, artifact download, and preview",
  );
  const hostedMapId = new URL(hostedEditorUrl).searchParams.get("hostedMap");
  assert.ok(hostedMapId);
  await page.goto(
    `${mapsOrigin}/?hostedProject=${projectUrl.split("/").at(-1)}&hostedMap=${hostedMapId}`,
  );
  await page.getByText("Choose a compiled build to view").waitFor();
  await page.getByRole("button", { name: "Open compiled map" }).click();
  await page.waitForURL(/hostedBuild=[a-f0-9-]{36}/);
  await page.getByText("smoke.map · preview").waitFor();
  await page.reload();
  await page.getByText("smoke.map · preview").waitFor();
  result.checks.push("Remix hosted viewer picker opens a compiled map");
  await page.goto(hostedEditorUrl);
  await page.locator("#hosted-builds summary").click();
  await page.route(/\/api\/maps\/[^/]+\/builds$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const payload = await response.json();
    payload.capability.durationHint = "Large maps may take several minutes";
    await route.fulfill({ response, json: payload });
  });
  await page.locator("#hosted-builds-refresh").click();
  await page.getByText("Large maps may take several minutes").waitFor();
  result.checks.push("hosted compiler duration hint in editor");
  const hostedMapSource = (
    await (
      await page.request.get(`${mapsOrigin}/api/maps/${hostedMapId}`)
    ).json()
  ).map.source;
  await installSiteToolMock(page);
  await page.goto(`${mapsOrigin}/editor`);
  await page.evaluate((sourceText) => {
    const manifest = JSON.stringify({
      schemaVersion: 1,
      name: "Smoke local project",
      game: "quake",
      mapRoots: ["maps"],
      resources: { wads: [], spriteRoots: [], entityDefinitions: [] },
      buildProfiles: [],
    });
    const fixture = {
      file(name, initialSource) {
        let source = initialSource;
        return {
          kind: "file",
          name,
          getFile: async () => new File([source], name),
          async createWritable() {
            let next = source;
            return {
              async write(data) {
                next = typeof data === "string" ? data : await data.text();
              },
              async close() {
                source = next;
              },
            };
          },
        };
      },
      directory(name, children) {
        return {
          kind: "directory",
          name,
          getFileHandle: async (child) => children[child],
          getDirectoryHandle: async (child) => children[child],
          async *entries() {
            yield* Object.entries(children);
          },
        };
      },
    };
    const mapFiles = Object.fromEntries(
      ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"].map((name) => [
        `${name}.map`,
        fixture.file(`${name}.map`, `// Format: Valve\n${sourceText}`),
      ]),
    );
    const root = fixture.directory("smoke", {
      "tea.maps.project.json": fixture.file("tea.maps.project.json", manifest),
      maps: fixture.directory("maps", mapFiles),
    });
    window.showDirectoryPicker = async () => root;
  }, hostedMapSource);
  await page.locator("#open-project").click();
  await page.locator("#project-map-selector").waitFor({ state: "visible" });
  assert.equal(await page.locator(".project-map-selector-row").count(), 6);
  await page.locator("#project-map-selector-filter").fill("beta");
  assert.equal(await page.locator(".project-map-selector-row").count(), 1);
  await page.getByRole("button", { name: "Open maps/beta.map" }).click();
  await page.locator("#project-map-selector").waitFor({ state: "hidden" });
  assert.equal(
    await page.locator("#project-maps").inputValue(),
    "maps/beta.map",
  );
  assert.match(
    (await page.locator("#project-resource-info").textContent()) ?? "",
    /textures/,
  );
  await page.locator("#project-maps").selectOption("maps/alpha.map");
  await page.waitForFunction(
    () =>
      window.teaMapsTestTools?.get("tea_maps_inspect_editor").execute({})
        .name === "alpha.map",
  );
  const selectedMapDownload = page.waitForEvent("download");
  await page.locator("#download-map").click();
  assert.equal((await selectedMapDownload).suggestedFilename(), "alpha.map");
  await page.locator("#project-maps").selectOption("maps/beta.map");
  await page.waitForFunction(
    () =>
      window.teaMapsTestTools?.get("tea_maps_inspect_editor").execute({})
        .name === "beta.map",
  );
  const beforeGuard = await page.locator("#map-source").inputValue();
  await page.locator("#inspector-tab-source").click();
  await page.locator("#map-source").fill(`${beforeGuard}\n// pending\n`);
  await page.locator("#project-maps").selectOption("maps/alpha.map");
  await page.locator("#switch-map-dialog").waitFor({ state: "visible" });
  await page.locator('#switch-map-dialog button[value="cancel"]').click();
  await page.waitForFunction(
    () => document.querySelector("#project-maps")?.value === "maps/beta.map",
  );
  await page.locator("#project-maps").selectOption("maps/alpha.map");
  await page.locator("#switch-map-dialog").waitFor({ state: "visible" });
  await page.locator('#switch-map-dialog button[value="discard"]').click();
  await page.waitForFunction(
    () =>
      window.teaMapsTestTools?.get("tea_maps_inspect_editor").execute({})
        .name === "alpha.map",
  );
  await page.locator("#project-maps").selectOption("maps/beta.map");
  await page.waitForFunction(
    () =>
      window.teaMapsTestTools?.get("tea_maps_inspect_editor").execute({})
        .name === "beta.map",
  );
  const beforeSaveGuard = await page.locator("#map-source").inputValue();
  await page
    .locator("#map-source")
    .fill(`${beforeSaveGuard}\n// saved by guard\n`);
  await page.locator("#project-maps").selectOption("maps/alpha.map");
  await page.locator("#switch-map-dialog").waitFor({ state: "visible" });
  await page.locator("#switch-map-dialog").press("Escape");
  await page.waitForFunction(
    () => document.querySelector("#project-maps")?.value === "maps/beta.map",
  );
  await page.locator("#project-maps").selectOption("maps/alpha.map");
  await page.locator("#switch-map-dialog").waitFor({ state: "visible" });
  await page.locator('#switch-map-dialog button[value="save"]').click();
  await page.waitForFunction(
    () =>
      window.teaMapsTestTools?.get("tea_maps_inspect_editor").execute({})
        .name === "alpha.map",
  );
  await page.locator("#project-maps").selectOption("maps/beta.map");
  await page.waitForFunction(
    () =>
      window.teaMapsTestTools?.get("tea_maps_inspect_editor").execute({})
        .name === "beta.map",
  );
  assert.match(
    await page.locator("#map-source").inputValue(),
    /saved by guard/,
  );
  result.checks.push(
    "Remix project map toolbar switches files and honors cancel, Escape, discard, and save",
  );
  await page.locator("#project-sync-open:not([disabled])").click();
  await page.locator("#project-sync-dialog").waitFor({ state: "visible" });
  await page
    .locator("#project-sync-dialog")
    .getByRole("button", { name: "Close" })
    .click();
  await page.locator("#open-project").click();
  await page.locator("#project-map-selector").waitFor({ state: "visible" });
  await page.locator("#project-map-selector-sync").click();
  await page.locator("#project-sync-dialog").waitFor({ state: "visible" });
  await page.locator("#project-sync-id").fill(projectUrl.split("/").at(-1));
  await page.locator("#project-sync-load").click();
  await page.getByText("Smoke Project: 1 hosted maps available").waitFor();
  assert.equal(await page.locator("#project-sync-mappings select").count(), 6);
  await page
    .locator("#project-sync-mappings select")
    .first()
    .selectOption(hostedMapId);
  await page.locator("#project-sync-link").click();
  try {
    await page
      .locator("#project-sync-linked")
      .waitFor({ state: "visible", timeout: 5000 });
  } catch (cause) {
    throw new Error(
      `Project link did not open: ${await page.locator("#project-sync-status").textContent()}`,
      { cause },
    );
  }
  await page.getByText(/No common sync point · hosted version/).waitFor();
  assert.equal(
    await page.evaluate(async () => {
      const root = await window.showDirectoryPicker();
      const handle = await root.getFileHandle("tea.maps.project.json");
      return JSON.parse(await (await handle.getFile()).text()).hosted.projectId;
    }),
    projectUrl.split("/").at(-1),
  );
  await page.locator("#project-sync-close").click();
  result.checks.push(
    "Remix Tea local project chooser, link writing, and source comparison",
  );
  await page.locator("#hosted-editor-picker summary").first().click();
  await page.waitForFunction(
    () => !document.querySelector("#hosted-editor-compare")?.disabled,
  );
  const comparedLocalSource = await page.locator("#map-source").inputValue();
  await page.locator("#hosted-editor-compare").click();
  await page.locator("#source-compare-dialog").waitFor({ state: "visible" });
  await page.getByText(/Sources differ at line/).waitFor();
  assert.equal(
    await page.locator("#source-compare-local").inputValue(),
    comparedLocalSource,
  );
  assert.equal(
    await page.locator("#source-compare-hosted").inputValue(),
    hostedMapSource,
  );
  await page.locator("#source-compare-close").click();
  result.checks.push(
    "Remix hosted source comparison keeps read-only snapshots",
  );
  const projectSiteTools = await page.evaluate(async () => {
    const tools = window.teaMapsTestTools;
    const inspect = () => tools.get("tea_maps_inspect_editor").execute({});
    const before = inspect();
    tools.get("tea_maps_create_box").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: before.revision,
      min: [0, 0, 0],
      max: [32, 32, 32],
      material: "STONE",
    });
    const dirty = inspect();
    let rejected = "";
    try {
      await tools.get("tea_maps_open_project_map").execute({
        expectedDocumentId: dirty.documentId,
        expectedRevision: dirty.revision,
        path: "maps/gamma.map",
      });
    } catch (error) {
      rejected = error.message;
    }
    const opened = await tools.get("tea_maps_open_project_map").execute({
      expectedDocumentId: dirty.documentId,
      expectedRevision: dirty.revision,
      path: "maps/gamma.map",
      discardUnsavedChanges: true,
    });
    return { rejected, opened, inspection: inspect() };
  });
  assert.match(projectSiteTools.rejected, /unsaved changes/);
  assert.equal(projectSiteTools.opened.name, "gamma.map");
  assert.equal(projectSiteTools.inspection.counts.brushes, 0);
  assert.equal(
    await page.locator("#project-maps").inputValue(),
    "maps/gamma.map",
  );
  result.checks.push(
    "browser site tool opens an authorized project map with explicit discard",
  );
  const toolSettingsPage = await browser.newPage();
  await installSiteToolMock(toolSettingsPage);
  await toolSettingsPage.goto(`${mapsOrigin}/editor`);
  await toolSettingsPage.waitForFunction(
    () => document.documentElement.dataset.teaMapsSiteTools === "ready",
  );
  const faceTool = await toolSettingsPage.evaluate(() =>
    window.teaMapsTestTools.get("tea_maps_set_tool").execute({ tool: "face" }),
  );
  assert.equal(faceTool.activeTool, "face");
  await toolSettingsPage.waitForFunction(
    () => document.querySelector("#viewport-tool")?.value === "face",
  );
  assert.equal(
    await toolSettingsPage.locator("#viewport-tool").inputValue(),
    "face",
  );
  await toolSettingsPage.evaluate(() => {
    window.teaMapsTestTools.get("tea_maps_set_tool").execute({ tool: "clip" });
  });
  await toolSettingsPage.locator("#inspector-tab-entity").click();
  await toolSettingsPage.locator("#clip-tools").waitFor({ state: "visible" });
  await toolSettingsPage.locator("#clip-front").click();
  await toolSettingsPage.waitForFunction(
    () =>
      document.querySelector("#clip-front")?.getAttribute("aria-pressed") ===
      "true",
  );
  await toolSettingsPage.evaluate(() => {
    window.teaMapsTestTools.get("tea_maps_set_tool").execute({ tool: "hull" });
  });
  await toolSettingsPage.locator("#hull-tools").waitFor({ state: "visible" });
  await toolSettingsPage.locator("#clip-tools").waitFor({ state: "hidden" });
  await toolSettingsPage.evaluate(() => {
    window.teaMapsTestTools
      .get("tea_maps_set_tool")
      .execute({ tool: "vertex" });
  });
  await toolSettingsPage
    .locator("#topology-tools")
    .waitFor({ state: "visible" });
  await toolSettingsPage
    .locator("#topology-title")
    .getByText("Vertex edit")
    .waitFor();
  await toolSettingsPage.evaluate(() => {
    window.teaMapsTestTools.get("tea_maps_set_tool").execute({ tool: "edge" });
  });
  await toolSettingsPage
    .locator("#topology-title")
    .getByText("Edge edit")
    .waitFor();
  await toolSettingsPage.evaluate(() => {
    window.teaMapsTestTools
      .get("tea_maps_set_tool")
      .execute({ tool: "create" });
  });
  await toolSettingsPage.locator("#shape-tools").waitFor({ state: "visible" });
  await toolSettingsPage.locator("#shape-kind").selectOption("cylinder");
  await toolSettingsPage
    .locator("#shape-circle-fields")
    .waitFor({ state: "visible" });
  assert.equal(
    await toolSettingsPage.locator("#shape-thickness").isDisabled(),
    true,
  );
  await toolSettingsPage.locator("#shape-hollow").check();
  await toolSettingsPage.waitForFunction(
    () => !document.querySelector("#shape-thickness")?.disabled,
  );
  await toolSettingsPage.locator("#shape-circle-mode").selectOption("scalable");
  await toolSettingsPage.waitForFunction(
    () => document.querySelector("#shape-sides")?.value === "12",
  );
  await toolSettingsPage.locator("#shape-kind").selectOption("stairs");
  await toolSettingsPage
    .locator("#shape-stair-fields")
    .waitFor({ state: "visible" });
  await toolSettingsPage
    .locator("#shape-circle-fields")
    .waitFor({ state: "hidden" });
  await toolSettingsPage.evaluate(() => {
    window.teaMapsTestTools
      .get("tea_maps_set_tool")
      .execute({ tool: "select" });
    const tools = window.teaMapsTestTools;
    const before = tools.get("tea_maps_inspect_editor").execute({});
    tools.get("tea_maps_create_box").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: before.revision,
      min: [10, 10, 10],
      max: [50, 50, 50],
      material: "STONE",
    });
  });
  await toolSettingsPage.evaluate(() => {
    window.teaMapsTestTools
      .get("tea_maps_set_tool")
      .execute({ tool: "rotate" });
  });
  await toolSettingsPage
    .locator("#transform-tool")
    .waitFor({ state: "visible" });
  const initialPivotX = await toolSettingsPage
    .locator("#transform-pivot-x")
    .inputValue();
  await toolSettingsPage
    .locator("#transform-pivot-x")
    .fill(String(Number(initialPivotX) + 32));
  await toolSettingsPage.locator("#transform-pivot-x").press("Tab");
  assert.equal(
    await toolSettingsPage.locator("#transform-pivot-x").inputValue(),
    String(Number(initialPivotX) + 32),
  );
  await toolSettingsPage.locator("#reset-transform-pivot").click();
  await toolSettingsPage.waitForFunction(
    (value) => document.querySelector("#transform-pivot-x")?.value === value,
    initialPivotX,
  );
  await toolSettingsPage.evaluate(() => {
    window.teaMapsTestTools.get("tea_maps_set_tool").execute({ tool: "shear" });
  });
  await toolSettingsPage
    .locator("#transform-title")
    .getByText("Shear")
    .waitFor();
  await toolSettingsPage.evaluate(() => {
    window.teaMapsTestTools
      .get("tea_maps_set_tool")
      .execute({ tool: "select" });
  });
  await toolSettingsPage
    .locator("#transform-tool")
    .waitFor({ state: "hidden" });
  await toolSettingsPage.locator("#grid-size").selectOption("32");
  await toolSettingsPage.locator("#texture-lock").uncheck();
  await toolSettingsPage.locator("#snap-to-grid").click();
  const snappedBounds = await toolSettingsPage.evaluate(
    () =>
      window.teaMapsTestTools
        .get("tea_maps_list_objects")
        .execute({ kind: "brush" }).objects[0].bounds,
  );
  assert.deepEqual(snappedBounds, { min: [0, 0, 0], max: [64, 64, 64] });
  result.checks.push(
    "Remix tool, Clip/Hull, topology, shape, transform pivot, grid, and texture-lock controls update live editor settings",
  );
  await toolSettingsPage.evaluate(() => document.activeElement?.blur());
  await toolSettingsPage.keyboard.press("f");
  await toolSettingsPage.waitForFunction(
    () => document.querySelector("#viewport-tool")?.value === "face",
  );
  await toolSettingsPage.keyboard.press("f");
  await toolSettingsPage.waitForFunction(
    () => document.querySelector("#viewport-tool")?.value === "select",
  );
  await toolSettingsPage.keyboard.press("1");
  await toolSettingsPage.waitForFunction(
    () => document.querySelector("#grid-size")?.value === "1",
  );
  await toolSettingsPage.keyboard.press("]");
  await toolSettingsPage.waitForFunction(
    () => document.querySelector("#grid-size")?.value === "2",
  );
  await toolSettingsPage.keyboard.press("6");
  await toolSettingsPage.waitForFunction(
    () => document.querySelector("#grid-size")?.value === "32",
  );
  result.checks.push(
    "Worldview tool and grid keyboard shortcuts work in the Remix editor",
  );
  const shortcutBrushCount = await toolSettingsPage.evaluate(
    () =>
      window.teaMapsTestTools
        .get("tea_maps_list_objects")
        .execute({ kind: "brush" }).objects.length,
  );
  await toolSettingsPage.locator("#select-all").click();
  await toolSettingsPage.evaluate(() => document.activeElement?.blur());
  await toolSettingsPage.keyboard.press("Control+d");
  await toolSettingsPage.waitForFunction(
    (count) =>
      window.teaMapsTestTools
        .get("tea_maps_list_objects")
        .execute({ kind: "brush" }).objects.length ===
      count + 1,
    shortcutBrushCount,
  );
  await toolSettingsPage.keyboard.press("Control+z");
  await toolSettingsPage.waitForFunction(
    (count) =>
      window.teaMapsTestTools
        .get("tea_maps_list_objects")
        .execute({ kind: "brush" }).objects.length === count,
    shortcutBrushCount,
  );
  await toolSettingsPage.locator("#select-all").click();
  await toolSettingsPage.evaluate(() => document.activeElement?.blur());
  await toolSettingsPage.keyboard.press("Delete");
  await toolSettingsPage.waitForFunction(
    () =>
      window.teaMapsTestTools
        .get("tea_maps_list_objects")
        .execute({ kind: "brush" }).objects.length === 0,
  );
  await toolSettingsPage.keyboard.press("Control+z");
  await toolSettingsPage.waitForFunction(
    (count) =>
      window.teaMapsTestTools
        .get("tea_maps_list_objects")
        .execute({ kind: "brush" }).objects.length === count,
    shortcutBrushCount,
  );
  result.checks.push(
    "Keyboard duplicate and Delete edit the document and Undo restores it",
  );
  await toolSettingsPage.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        clearInterval(retry);
        reject(new Error("Context menu did not hydrate"));
      }, 5000);
      const retry = setInterval(
        () =>
          window.dispatchEvent(new Event("tea-maps-context-menu-bridge-ready")),
        25,
      );
      window.addEventListener(
        "tea-maps-context-menu-ready",
        () => {
          clearTimeout(timer);
          clearInterval(retry);
          resolve();
        },
        { once: true },
      );
    });
    window.teaMapsContextMenuTest = {
      hits: 0,
      state: {
        visible: true,
        x: 64,
        y: 64,
        sections: [
          {
            label: "Test actions",
            actions: [
              { label: "First action", run() {} },
              { label: "Disabled action", disabled: true, run() {} },
              {
                label: "Last action",
                run() {
                  window.teaMapsContextMenuTest.hits += 1;
                },
              },
            ],
          },
        ],
      },
      hide() {
        this.state = { ...this.state, visible: false, sections: [] };
        window.dispatchEvent(
          new CustomEvent("tea-maps-context-menu-state", { detail: this }),
        );
      },
      runAction(action) {
        this.hide(true);
        action.run();
      },
    };
    window.dispatchEvent(
      new CustomEvent("tea-maps-context-menu-state", {
        detail: window.teaMapsContextMenuTest,
      }),
    );
  });
  await toolSettingsPage
    .locator("#viewport-context-menu")
    .waitFor({ state: "visible" });
  await toolSettingsPage.waitForFunction(
    () => document.activeElement?.textContent?.trim() === "First action",
  );
  await toolSettingsPage.locator("#viewport-context-menu").press("ArrowDown");
  await toolSettingsPage.waitForFunction(
    () => document.activeElement?.textContent?.trim() === "Last action",
  );
  await toolSettingsPage.locator("#viewport-context-menu").press("Escape");
  await toolSettingsPage
    .locator("#viewport-context-menu")
    .waitFor({ state: "hidden" });
  await toolSettingsPage.evaluate(() => {
    const menu = window.teaMapsContextMenuTest;
    menu.state = {
      ...menu.state,
      visible: true,
      sections: [
        {
          label: "Test actions",
          actions: [
            {
              label: "Last action",
              run() {
                menu.hits += 1;
              },
            },
          ],
        },
      ],
    };
    window.dispatchEvent(
      new CustomEvent("tea-maps-context-menu-state", { detail: menu }),
    );
  });
  await toolSettingsPage
    .locator("#viewport-context-menu")
    .getByRole("menuitem", { name: "Last action" })
    .click();
  assert.equal(
    await toolSettingsPage.evaluate(() => window.teaMapsContextMenuTest.hits),
    1,
  );
  await toolSettingsPage
    .locator("#viewport-context-menu")
    .waitFor({ state: "hidden" });
  await toolSettingsPage.close();
  result.checks.push(
    "Remix context menu renders actions, skips disabled items, handles Escape, and activates commands",
  );
  const geometryPage = await browser.newPage();
  await installSiteToolMock(geometryPage);
  await geometryPage.goto(`${mapsOrigin}/editor`);
  await geometryPage.waitForFunction(
    () => document.documentElement.dataset.teaMapsSiteTools === "ready",
  );
  await geometryPage.locator("#inspector-tab-entity").click();
  await geometryPage.locator("#box-material").fill("BRICK");
  await geometryPage.locator("#add-box:not([disabled])").click();
  const firstGeometryBrush = await geometryPage.evaluate(() => {
    const brushes = window.teaMapsTestTools
      .get("tea_maps_list_objects")
      .execute({ kind: "brush" }).objects;
    const brush = brushes.find((candidate) =>
      candidate.materials.includes("BRICK"),
    );
    if (!brush) throw new Error("Add box did not use the selected texture");
    return brush.id;
  });
  const secondGeometryBrush = await geometryPage.evaluate(() => {
    const tools = window.teaMapsTestTools;
    const before = tools.get("tea_maps_inspect_editor").execute({});
    return tools.get("tea_maps_create_box").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: before.revision,
      min: [32, -32, 0],
      max: [96, 32, 64],
      material: "STONE",
    }).brushId;
  });
  await geometryPage.evaluate(
    (brushIds) => {
      const tools = window.teaMapsTestTools;
      const before = tools.get("tea_maps_inspect_editor").execute({});
      tools.get("tea_maps_select").execute({
        expectedDocumentId: before.documentId,
        expectedRevision: before.revision,
        mode: "objects",
        brushIds,
      });
    },
    [firstGeometryBrush, secondGeometryBrush],
  );
  await geometryPage.locator("#inspector-tab-face").click();
  await geometryPage
    .locator("#material-replace-scope")
    .getByText(/2 selected brushes/)
    .waitFor();
  await geometryPage.locator("#inspector-tab-entity").click();
  await geometryPage.locator("#csg-tools summary").click();
  await geometryPage.locator("#csg-merge:not([disabled])").click();
  await geometryPage.getByText(/Convex merge applied/).waitFor();
  const merged = await geometryPage.evaluate(
    () =>
      window.teaMapsTestTools
        .get("tea_maps_list_objects")
        .execute({ kind: "brush" }).objects,
  );
  assert.equal(merged.length, 1);
  assert.ok(merged[0].materials.includes("BRICK"));
  const beforeInvalidHollow = await geometryPage.evaluate(
    () =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
        .revision,
  );
  await geometryPage.locator("#csg-thickness").fill("0");
  await geometryPage.locator("#csg-hollow:not([disabled])").click();
  await geometryPage
    .getByText("Hollow wall thickness must be positive")
    .waitFor();
  assert.equal(
    await geometryPage.evaluate(
      () =>
        window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
          .revision,
    ),
    beforeInvalidHollow,
  );
  await geometryPage.locator("#csg-thickness").fill("8");
  await geometryPage.locator("#csg-hollow").click();
  await geometryPage.getByText(/Hollow applied/).waitFor();
  await geometryPage.close();
  result.checks.push(
    "Remix brush texture, Add box, convex merge, and Hollow controls use editor transactions",
  );
  const facePage = await browser.newPage();
  await installSiteToolMock(facePage);
  await facePage.goto(`${mapsOrigin}/editor`);
  await facePage.waitForFunction(
    () => document.documentElement.dataset.teaMapsSiteTools === "ready",
  );
  const selectedFaceId = await facePage.evaluate(() => {
    const tools = window.teaMapsTestTools;
    const before = tools.get("tea_maps_inspect_editor").execute({});
    const created = tools.get("tea_maps_create_box").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: before.revision,
      min: [0, 0, 0],
      max: [64, 64, 64],
      material: "STONE",
    });
    const brush = tools
      .get("tea_maps_list_objects")
      .execute({ kind: "brush" })
      .objects.find((candidate) => candidate.id === created.brushId);
    if (!brush) throw new Error("Face test brush was not found");
    const after = tools.get("tea_maps_inspect_editor").execute({});
    tools.get("tea_maps_select").execute({
      expectedDocumentId: after.documentId,
      expectedRevision: after.revision,
      mode: "faces",
      faces: [{ brushId: brush.id, faceId: brush.faceIds[0] }],
    });
    return brush.faceIds[0];
  });
  await facePage.locator("#face-inspector").waitFor({ state: "visible" });
  assert.equal(
    await facePage.locator("#selected-face").inputValue(),
    selectedFaceId,
  );
  await facePage.evaluate(() => {
    window.teaMapsTestTools.get("tea_maps_set_tool").execute({ tool: "sweep" });
  });
  await facePage.locator("#inspector-tab-entity").click();
  await facePage.locator("#sweep-tools").waitFor({ state: "visible" });
  await facePage.waitForFunction(() => {
    const count = document.querySelector("#sweep-count")?.textContent;
    return count && count !== "0 brushes" && count !== "Invalid sweep";
  });
  await facePage.locator("#sweep-segments").fill("0");
  await facePage
    .getByText("Sweep segments must be an integer from 1 to 128")
    .waitFor();
  assert.equal(await facePage.locator("#apply-sweep").isDisabled(), true);
  await facePage.locator("#sweep-segments").fill("4");
  await facePage.locator("#sweep-path").selectOption("arc");
  assert.equal(await facePage.locator("#sweep-path").inputValue(), "arc");
  await facePage.locator("#reset-sweep").click();
  await facePage.waitForFunction(
    () => document.querySelector("#sweep-path")?.value === "straight",
  );
  await facePage.evaluate(() => {
    window.teaMapsTestTools.get("tea_maps_set_tool").execute({ tool: "face" });
  });
  await facePage.locator("#sweep-tools").waitFor({ state: "hidden" });
  await facePage.locator("#inspector-tab-face").click();
  await facePage.locator("#uv-frame:not([disabled])").click();
  await facePage
    .locator("#uv-editor-status")
    .getByText("Framed the selected face in the UV plane.")
    .waitFor();
  await facePage.locator("#uv-grid-x:not([disabled])").fill("4");
  await facePage.locator("#uv-grid-x").press("Tab");
  const uvGridState = await facePage.evaluate(() => ({
    x: document.querySelector("#uv-grid-x")?.value,
    status: document.querySelector("#uv-editor-status")?.textContent,
  }));
  assert.equal(uvGridState.x, "4");
  assert.equal(uvGridState.status?.trim(), "UV grid 4 × 1.");
  await facePage.locator("#uv-reset-pivot:not([disabled])").click();
  await facePage
    .locator("#uv-editor-status")
    .getByText("UV origin reset to the face center.")
    .waitFor();
  await facePage.locator("#selected-material").fill("BRICK");
  await facePage.locator("#apply-material:not([disabled])").click();
  await facePage.waitForFunction(() =>
    window.teaMapsTestTools
      .get("tea_maps_list_objects")
      .execute({ kind: "brush" })
      .objects.some((brush) => brush.materials.includes("BRICK")),
  );
  const beforeProjection = await facePage.evaluate(
    () =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
        .revision,
  );
  await facePage.locator("#texture-offset-u").fill("12");
  await facePage.locator("#texture-offset-u").press("Tab");
  await facePage.waitForFunction(
    (revision) =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
        .revision > revision,
    beforeProjection,
  );
  await facePage.locator("#texture-alignment summary").click();
  await facePage.locator("#texture-width").fill("64");
  const beforeAlignment = await facePage.evaluate(
    () =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
        .revision,
  );
  await facePage.locator("#apply-texture-alignment:not([disabled])").click();
  await facePage.getByText("Enter both texture dimensions").waitFor();
  assert.equal(
    await facePage.evaluate(
      () =>
        window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
          .revision,
    ),
    beforeAlignment,
  );
  await facePage.locator("#texture-height").fill("64");
  await facePage.locator("#texture-alignment-operation").selectOption("flip-u");
  await facePage.locator("#apply-texture-alignment").click();
  await facePage.waitForFunction(
    (revision) =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
        .revision > revision,
    beforeAlignment,
  );
  const beforeFaceGeometry = await facePage.evaluate(
    () =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
        .revision,
  );
  await facePage.locator("#face-distance").fill("0");
  await facePage.locator("#extrude-face:not([disabled])").click();
  await facePage.getByText("Enter a non-zero face distance").waitFor();
  assert.equal(
    await facePage.evaluate(
      () =>
        window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
          .revision,
    ),
    beforeFaceGeometry,
  );
  await facePage.locator("#face-distance").fill("8");
  await facePage.locator("#extrude-face").click();
  await facePage.waitForFunction(
    (revision) =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
        .revision > revision,
    beforeFaceGeometry,
  );
  await facePage.close();
  result.checks.push(
    "Remix face picker, Sweep and UV controls, material, projection, alignment, and geometry controls use editor transactions",
  );
  const surfacePage = await browser.newPage();
  await installSiteToolMock(surfacePage);
  await surfacePage.goto(`${mapsOrigin}/editor`);
  await surfacePage.waitForFunction(
    () => document.documentElement.dataset.teaMapsSiteTools === "ready",
  );
  await surfacePage.locator("#game-profile").selectOption("quake2");
  const surfaceBrush = await surfacePage.evaluate(() => {
    const tools = window.teaMapsTestTools;
    const before = tools.get("tea_maps_inspect_editor").execute({});
    const created = tools.get("tea_maps_create_box").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: before.revision,
      min: [0, 0, 0],
      max: [64, 64, 64],
      material: "STONE",
    });
    const brush = tools
      .get("tea_maps_list_objects")
      .execute({ kind: "brush" })
      .objects.find((candidate) => candidate.id === created.brushId);
    if (!brush) throw new Error("Surface test brush was not found");
    const after = tools.get("tea_maps_inspect_editor").execute({});
    tools.get("tea_maps_select").execute({
      expectedDocumentId: after.documentId,
      expectedRevision: after.revision,
      mode: "faces",
      faces: [{ brushId: brush.id, faceId: brush.faceIds[0] }],
    });
    return { id: brush.id, faceIds: brush.faceIds };
  });
  await surfacePage
    .locator("#surface-attributes")
    .waitFor({ state: "visible" });
  await surfacePage.locator("#surface-attributes summary").click();
  const lightFlag = surfacePage.locator("#surface-flags").getByLabel("Light", {
    exact: true,
  });
  const beforeFlag = await surfacePage.evaluate(
    () =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
        .revision,
  );
  await lightFlag.check();
  await surfacePage.waitForFunction(
    (revision) =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
        .revision > revision,
    beforeFlag,
  );
  const afterFlag = await surfacePage.evaluate(
    () =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
        .revision,
  );
  await surfacePage.locator("#surface-value").fill("200");
  await surfacePage.locator("#surface-value").press("Tab");
  await surfacePage.waitForFunction(
    (revision) =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
        .revision > revision,
    afterFlag,
  );
  await surfacePage.evaluate(({ id, faceIds }) => {
    const tools = window.teaMapsTestTools;
    const before = tools.get("tea_maps_inspect_editor").execute({});
    tools.get("tea_maps_select").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: before.revision,
      mode: "faces",
      faces: [
        { brushId: id, faceId: faceIds[0] },
        { brushId: id, faceId: faceIds[1] },
      ],
    });
  }, surfaceBrush);
  await surfacePage.waitForFunction(() => {
    const checkbox = document.querySelector("#surface-flags input");
    return checkbox?.indeterminate === true;
  });
  assert.equal(await lightFlag.getAttribute("aria-checked"), "mixed");
  assert.equal(
    await surfacePage.locator("#surface-value").getAttribute("placeholder"),
    "Mixed",
  );
  await surfacePage.close();
  result.checks.push(
    "Remix Quake II surface flags and value preserve mixed face selection state",
  );
  const entityPage = await browser.newPage();
  await installSiteToolMock(entityPage);
  await entityPage.goto(`${mapsOrigin}/editor`);
  await entityPage.waitForFunction(
    () => document.documentElement.dataset.teaMapsSiteTools === "ready",
  );
  await entityPage.locator("#inspector-tab-entity").click();
  await entityPage.locator("#point-entity-classname").fill("light");
  await entityPage.locator("#point-origin-x").fill("24");
  await entityPage.locator("#point-origin-y").fill("48");
  await entityPage.locator("#point-origin-z").fill("96");
  await entityPage.locator("#add-point-entity").click();
  await entityPage.waitForFunction(() =>
    window.teaMapsTestTools
      .get("tea_maps_list_objects")
      .execute({ kind: "entity" })
      .objects.some(
        (entity) =>
          entity.classname === "light" &&
          entity.properties.origin === "24 48 96",
      ),
  );
  await entityPage.locator("#undo").click();
  await entityPage.waitForFunction(
    () =>
      !window.teaMapsTestTools
        .get("tea_maps_list_objects")
        .execute({ kind: "entity" })
        .objects.some((entity) => entity.classname === "light"),
  );
  await entityPage.locator("#redo").click();
  await entityPage.waitForFunction(() =>
    window.teaMapsTestTools
      .get("tea_maps_list_objects")
      .execute({ kind: "entity" })
      .objects.some((entity) => entity.classname === "light"),
  );
  await entityPage.locator("#point-origin-y").fill("");
  await entityPage.locator("#add-point-entity").click();
  await entityPage
    .getByText("Point origin needs three finite coordinates")
    .waitFor();
  await entityPage.evaluate(() => {
    const tools = window.teaMapsTestTools;
    const before = tools.get("tea_maps_inspect_editor").execute({});
    const point = tools
      .get("tea_maps_list_objects")
      .execute({ kind: "entity" })
      .objects.find((entity) => entity.classname === "light");
    if (!point) throw new Error("Created point entity was not found");
    tools.get("tea_maps_select").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: before.revision,
      mode: "objects",
      entityIds: [point.id],
    });
  });
  await entityPage.locator("#point-entity-inspector").waitFor({
    state: "visible",
  });
  await entityPage
    .locator("#selected-point-classname")
    .fill("info_player_start");
  await entityPage.locator("#selected-point-origin").fill("10 20 30");
  await entityPage.locator("#update-point-entity:not([disabled])").click();
  await entityPage.waitForFunction(() =>
    window.teaMapsTestTools
      .get("tea_maps_list_objects")
      .execute({ kind: "entity" })
      .objects.some(
        (entity) =>
          entity.classname === "info_player_start" &&
          entity.properties.origin === "10 20 30",
      ),
  );
  await entityPage.locator("#entity-property-key").fill("message");
  await entityPage.locator("#entity-property-value").fill("Welcome");
  await entityPage.locator("#save-entity-property:not([disabled])").click();
  await entityPage.waitForFunction(() =>
    window.teaMapsTestTools
      .get("tea_maps_list_objects")
      .execute({ kind: "entity" })
      .objects.some((entity) => entity.properties.message === "Welcome"),
  );
  await entityPage
    .locator("#entity-property-list")
    .getByText("message")
    .waitFor();
  const messageField = entityPage
    .locator("#entity-property-list .entity-property-row")
    .filter({ hasText: "message" })
    .locator('input[type="text"]');
  await messageField.fill("Welcome again");
  await messageField.press("Tab");
  await entityPage.waitForFunction(() =>
    window.teaMapsTestTools
      .get("tea_maps_list_objects")
      .execute({ kind: "entity" })
      .objects.some((entity) => entity.properties.message === "Welcome again"),
  );
  await entityPage.locator("#remove-entity-property:not([disabled])").click();
  await entityPage.waitForFunction(() =>
    window.teaMapsTestTools
      .get("tea_maps_list_objects")
      .execute({ kind: "entity" })
      .objects.every((entity) => entity.properties.message === undefined),
  );
  const entityBrush = await entityPage.evaluate(() => {
    const tools = window.teaMapsTestTools;
    const before = tools.get("tea_maps_inspect_editor").execute({});
    return tools.get("tea_maps_create_box").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: before.revision,
      min: [0, 0, 0],
      max: [64, 64, 64],
      material: "STONE",
    }).brushId;
  });
  await entityPage.evaluate((brushId) => {
    const tools = window.teaMapsTestTools;
    const before = tools.get("tea_maps_inspect_editor").execute({});
    tools.get("tea_maps_select").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: before.revision,
      mode: "objects",
      brushIds: [brushId],
    });
  }, entityBrush);
  await entityPage.locator("#brush-entity-classname").fill("func_detail");
  await entityPage.locator("#make-brush-entity:not([disabled])").click();
  await entityPage.waitForFunction(() =>
    window.teaMapsTestTools
      .get("tea_maps_list_objects")
      .execute({ kind: "entity" })
      .objects.some((entity) => entity.classname === "func_detail"),
  );
  await entityPage.locator("#make-structural:not([disabled])").click();
  await entityPage.waitForFunction(
    () =>
      !window.teaMapsTestTools
        .get("tea_maps_list_objects")
        .execute({ kind: "entity" })
        .objects.some((entity) => entity.classname === "func_detail"),
  );
  await entityPage.evaluate((brushId) => {
    const tools = window.teaMapsTestTools;
    const before = tools.get("tea_maps_inspect_editor").execute({});
    tools.get("tea_maps_select").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: before.revision,
      mode: "objects",
      brushIds: [brushId],
    });
  }, entityBrush);
  await entityPage.locator("#move-x").fill("16");
  await entityPage.locator("#move-selection:not([disabled])").click();
  await entityPage.waitForFunction(() =>
    window.teaMapsTestTools
      .get("tea_maps_list_objects")
      .execute({ kind: "brush" })
      .objects.some((brush) => brush.bounds.min[0] === 16),
  );
  await entityPage.getByRole("button", { name: "Nudge X positive" }).click();
  await entityPage.waitForFunction(() =>
    window.teaMapsTestTools
      .get("tea_maps_list_objects")
      .execute({ kind: "brush" })
      .objects.some((brush) => brush.bounds.min[0] === 32),
  );
  const transformRevision = await entityPage.evaluate(
    () =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
        .revision,
  );
  await entityPage.locator("#rotate-degrees").fill("45");
  await entityPage.locator("#rotate-selection").click();
  await entityPage.waitForFunction(
    (revision) =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
        .revision > revision,
    transformRevision,
  );
  const rotatedRevision = await entityPage.evaluate(
    () =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
        .revision,
  );
  await entityPage.locator("#scale-x").fill("0");
  await entityPage.locator("#scale-selection").click();
  await entityPage
    .getByText("Select objects and enter positive scale factors")
    .waitFor();
  assert.equal(
    await entityPage.evaluate(
      () =>
        window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
          .revision,
    ),
    rotatedRevision,
  );
  await entityPage.locator("#scale-x").fill("1.25");
  await entityPage.locator("#scale-selection").click();
  await entityPage.waitForFunction(
    (revision) =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
        .revision > revision,
    rotatedRevision,
  );
  await entityPage.locator("#advanced-transforms summary").click();
  const scaledRevision = await entityPage.evaluate(
    () =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
        .revision,
  );
  await entityPage.locator("#shear-selection").click();
  await entityPage.waitForFunction(
    (revision) =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
        .revision > revision,
    scaledRevision,
  );
  const shearedRevision = await entityPage.evaluate(
    () =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
        .revision,
  );
  await entityPage.locator("#flip-x").click();
  await entityPage.waitForFunction(
    (revision) =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
        .revision > revision,
    shearedRevision,
  );
  await entityPage.close();
  result.checks.push(
    "Remix entity and transform controls create entities, restore geometry, and edit a brush",
  );
  const selectionPage = await browser.newPage();
  await installSiteToolMock(selectionPage);
  await selectionPage.goto(`${mapsOrigin}/editor`);
  await selectionPage.waitForFunction(
    () => document.documentElement.dataset.teaMapsSiteTools === "ready",
  );
  const selectionSetup = await selectionPage.evaluate(() => {
    const tools = window.teaMapsTestTools;
    const inspect = () => tools.get("tea_maps_inspect_editor").execute({});
    const before = inspect();
    const volume = tools.get("tea_maps_create_box").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: before.revision,
      min: [0, 0, 0],
      max: [128, 128, 128],
      material: "STONE",
    });
    const afterVolume = inspect();
    tools.get("tea_maps_create_box").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: afterVolume.revision,
      min: [32, 32, 32],
      max: [64, 64, 64],
      material: "STONE",
    });
    const afterCreate = inspect();
    tools.get("tea_maps_select").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: afterCreate.revision,
      mode: "objects",
      brushIds: [volume.brushId],
    });
    return { brushes: afterCreate.counts.brushes };
  });
  await selectionPage.locator("#selection-brush-tools summary").click();
  for (const label of [
    "Select enclosed",
    "Select touching",
    "Select enclosed in 2D",
  ]) {
    if (label === "Select enclosed in 2D")
      await selectionPage
        .locator("#selection-brush-projection")
        .selectOption("xz");
    await selectionPage
      .getByRole("button", { name: label, exact: true })
      .click();
    await selectionPage.getByText(/Consumed 1 selection brush/).waitFor();
    if (label === "Select enclosed in 2D")
      await selectionPage.getByText(/selected 1 xz enclosed object/).waitFor();
    assert.equal(
      await selectionPage.evaluate(
        () =>
          window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
            .counts.brushes,
      ),
      selectionSetup.brushes - 1,
    );
    await selectionPage.locator("#undo").click();
    assert.equal(
      await selectionPage.evaluate(
        () =>
          window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
            .counts.brushes,
      ),
      selectionSetup.brushes,
    );
  }
  await selectionPage.locator("#select-all").click();
  await selectionPage
    .getByText("Selected 2 visible, unlocked objects")
    .waitFor();
  await selectionPage
    .locator("#selection-info")
    .getByText("2 brushes selected")
    .waitFor();
  await selectionPage.locator("#duplicate-selection").click();
  await selectionPage.waitForFunction(
    () =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({}).counts
        .brushes === 4,
  );
  assert.match(
    (await selectionPage.locator("#undo").getAttribute("title")) ?? "",
    /^Undo /,
  );
  await selectionPage.locator("#undo").click();
  assert.match(
    (await selectionPage.locator("#redo").getAttribute("title")) ?? "",
    /^Redo /,
  );
  await selectionPage.locator("#redo").click();
  await selectionPage.waitForFunction(
    () =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({}).counts
        .brushes === 4,
  );
  await selectionPage.locator("#undo").click();
  await selectionPage.locator("#hide-selection").click();
  await selectionPage.locator("#show-all:not([disabled])").waitFor();
  await selectionPage.locator("#show-all").click();
  await selectionPage.locator("#select-all").click();
  await selectionPage.locator("#lock-selection").click();
  await selectionPage.locator("#unlock-all:not([disabled])").waitFor();
  await selectionPage.locator("#unlock-all").click();
  await selectionPage.locator("#invert-selection").click();
  await selectionPage.getByText(/Selection (inverted|cleared)/).waitFor();
  await selectionPage.locator("#select-all").click();
  await selectionPage.locator("#delete-selection").click();
  await selectionPage.waitForFunction(
    () =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({}).counts
        .brushes === 0,
  );
  await selectionPage.locator("#undo").click();
  await selectionPage.waitForFunction(
    () =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({}).counts
        .brushes === 2,
  );
  result.checks.push(
    "Remix selection commands duplicate, hide, lock, invert, and delete with Undo and Redo",
  );
  await selectionPage.locator("#select-all").click();
  await selectionPage.locator("#copy-selection").click();
  await selectionPage
    .getByText(/Copied selected objects as map text|Copied inside Maps/)
    .waitFor();
  await selectionPage.locator("#paste-original").click();
  await selectionPage.waitForFunction(
    () =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({}).counts
        .brushes === 4,
  );
  await selectionPage.locator("#undo").click();
  await selectionPage.locator("#select-all").click();
  await selectionPage.locator("#snap-to-grid").click();
  await selectionPage.getByText("Selection is already on the grid").waitFor();
  result.checks.push(
    "Remix clipboard and grid actions copy, paste, undo, and snap",
  );
  await selectionPage.locator("#duplicate-selection").click();
  await selectionPage.locator("#repeat-commands:not([disabled])").waitFor();
  await selectionPage.locator("#repeat-commands").click();
  await selectionPage.waitForFunction(
    () =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({}).counts
        .brushes > 4,
  );
  await selectionPage.locator("#clear-repeat-commands").click();
  await selectionPage.locator("#repeat-commands[disabled]").waitFor();
  await selectionPage.locator("#undo").click();
  await selectionPage.locator("#undo").click();
  await selectionPage.waitForFunction(
    () =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({}).counts
        .brushes === 2,
  );
  result.checks.push("Remix repeat controls replay and clear object commands");
  await selectionPage.locator("#inspector-tab-map").click();
  await selectionPage.locator("#view-filters summary").click();
  await selectionPage.locator("#show-world-brushes").uncheck();
  await selectionPage.getByText("View filters · 2 filtered").waitFor();
  await selectionPage.locator("#show-world-brushes").check();
  await selectionPage.getByText("View filters · 0 filtered").waitFor();
  await selectionPage.locator("#entity-links summary").click();
  await selectionPage.locator("#entity-link-mode").selectOption("none");
  assert.equal(
    await selectionPage.locator("#entity-link-mode").inputValue(),
    "none",
  );
  await selectionPage.close();
  result.checks.push(
    "selection brush queries consume volumes and undo restores them",
  );
  result.checks.push(
    "Remix view filters update visible brushes and entity link mode",
  );
  result.checks.push("Remix editor readouts follow status and selection");
  const issuesPage = await browser.newPage();
  await issuesPage.goto(`${mapsOrigin}/editor`);
  await issuesPage.locator("#inspector-tab-source").click();
  await issuesPage.locator("#map-source").waitFor({ state: "visible" });
  await issuesPage
    .locator("#map-source")
    .fill(
      '{\n"classname" "worldspawn"\n}\n{\n"classname" "light"\n"origin" "not a vector"\n}\n',
    );
  await issuesPage.locator("#apply-source").click();
  await issuesPage.locator("#toggle-inspector").click();
  await issuesPage.locator("#issue-status").click();
  await issuesPage.locator("#editor-inspector").waitFor({ state: "visible" });
  await issuesPage.waitForFunction(
    () => document.querySelector("#issue-browser")?.open === true,
  );
  const originIssue = issuesPage.locator(
    '.issue-row[data-issue-id^="invalid-origin:"]',
  );
  await originIssue.waitFor();
  await originIssue.getByRole("button", { name: "Select" }).click();
  await issuesPage.locator("#inspector-tab-map").click();
  await issuesPage.getByText(/Selected:.*origin/i).waitFor();
  await originIssue.getByRole("button", { name: "Reveal" }).click();
  await issuesPage.getByText(/Revealed:.*origin/i).waitFor();
  await issuesPage.locator("#inspector-tab-map").click();
  await originIssue.getByRole("button", { name: "Hide" }).click();
  assert.equal(await originIssue.count(), 0);
  await issuesPage.locator("#show-hidden-issues").check();
  await originIssue.getByRole("button", { name: "Unhide" }).click();
  await originIssue
    .getByRole("button", { name: "Reset invalid origin" })
    .click();
  await originIssue.waitFor({ state: "detached" });
  await issuesPage.locator("#inspector-tab-map").click();
  await issuesPage.locator("#view-filters summary").click();
  await issuesPage
    .locator("#entity-class-filters")
    .getByRole("checkbox", { name: /light/ })
    .uncheck();
  await issuesPage.getByText("View filters · 1 filtered").waitFor();
  await issuesPage.locator("#entity-class-search").fill("missing-class");
  await issuesPage.getByText("No matching classnames").waitFor();
  await issuesPage.locator("#show-all-classes").click();
  await issuesPage.getByText("View filters · 0 filtered").waitFor();
  await issuesPage.locator("#undo").click();
  await originIssue.waitFor();
  await issuesPage.close();
  result.checks.push(
    "Remix issue browser selects, filters, fixes, and undoes findings",
  );
  const linkedPage = await browser.newPage();
  await installSiteToolMock(linkedPage);
  await linkedPage.goto(`${mapsOrigin}/editor`);
  await linkedPage.waitForFunction(
    () => document.documentElement.dataset.teaMapsSiteTools === "ready",
  );
  await linkedPage.evaluate(() => {
    const tools = window.teaMapsTestTools;
    const before = tools.get("tea_maps_inspect_editor").execute({});
    tools.get("tea_maps_create_point_entity").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: before.revision,
      classname: "info_player_start",
      origin: [32, 32, 32],
    });
  });
  await linkedPage.locator("#inspector-tab-entity").click();
  await linkedPage.locator("#group-tools summary").click();
  await linkedPage.locator("#group-name").fill("Review group");
  await linkedPage.locator("#group-selection").click();
  await linkedPage.locator("#group-name").fill("Linked review");
  await linkedPage.locator("#rename-group").click();
  await linkedPage.waitForFunction(() =>
    document.querySelector("#map-source")?.value.includes('"Linked review"'),
  );
  await linkedPage.locator("#linked-duplicate-group").click();
  const linkedGroupId = await linkedPage.evaluate(
    () =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
        .selection.groupId,
  );
  assert.ok(linkedGroupId);
  await linkedPage.locator("#open-group").click();
  const linkedMember = await linkedPage.evaluate((groupId) => {
    const tools = window.teaMapsTestTools;
    const current = tools.get("tea_maps_inspect_editor").execute({});
    const members = tools
      .get("tea_maps_list_objects")
      .execute({ kind: "entity" });
    const point = members.objects.find(
      (entity) =>
        entity.classname === "info_player_start" &&
        entity.properties["_tb_group"] === groupId,
    );
    if (!point) throw new Error("Linked group point entity was not found");
    tools.get("tea_maps_select").execute({
      expectedDocumentId: current.documentId,
      expectedRevision: current.revision,
      mode: "objects",
      entityIds: [point.id],
    });
    return point.id;
  }, linkedGroupId);
  await linkedPage.locator("#entity-property-protection-option").waitFor({
    state: "visible",
  });
  await linkedPage.locator("#entity-property-key").fill("message");
  await linkedPage.locator("#entity-property-value").fill("Only this copy");
  await linkedPage.locator("#entity-property-protected").check();
  await linkedPage.locator("#save-entity-property").click();
  const protectedMembers = await linkedPage.evaluate(() =>
    window.teaMapsTestTools
      .get("tea_maps_list_objects")
      .execute({ kind: "entity" })
      .objects.filter((entity) => entity.classname === "info_player_start"),
  );
  assert.equal(protectedMembers.length, 2);
  assert.equal(
    protectedMembers.find((entity) => entity.id === linkedMember).properties
      .message,
    "Only this copy",
  );
  assert.equal(
    protectedMembers.find((entity) => entity.id !== linkedMember).properties
      .message,
    undefined,
  );
  await linkedPage
    .getByRole("checkbox", {
      name: "Keep message independent in this linked copy",
    })
    .click();
  const unprotectedMembers = await linkedPage.evaluate(() =>
    window.teaMapsTestTools
      .get("tea_maps_list_objects")
      .execute({ kind: "entity" })
      .objects.filter((entity) => entity.classname === "info_player_start"),
  );
  assert.equal(
    unprotectedMembers.find((entity) => entity.id === linkedMember).properties[
      "_tb_protected_properties"
    ],
    undefined,
  );
  await linkedPage.locator("#close-group").click();
  assert.equal(await linkedPage.locator("#close-group").isDisabled(), true);
  await linkedPage.close();
  result.checks.push(
    "Remix groups support rename, linked editing, and close with independent entity properties",
  );
  const siteToolPage = await browser.newPage();
  siteToolPage.on("pageerror", (error) => errors.push(error.message));
  await installSiteToolMock(siteToolPage);
  await siteToolPage.goto(`${mapsOrigin}/editor`);
  await siteToolPage.waitForFunction(
    () => document.documentElement.dataset.teaMapsSiteTools === "ready",
  );
  const siteTools = await siteToolPage.evaluate(async () => {
    const tools = window.teaMapsTestTools;
    const inspect = () => tools.get("tea_maps_inspect_editor").execute({});
    const before = inspect();
    const activeTool = tools
      .get("tea_maps_set_tool")
      .execute({ tool: "rotate" });
    const created = tools.get("tea_maps_create_box").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: before.revision,
      min: [0, 0, 0],
      max: [64, 64, 64],
      material: "STONE",
    });
    const afterCreate = inspect();
    const selected = tools.get("tea_maps_select").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: afterCreate.revision,
      mode: "objects",
      brushIds: [created.brushId],
    });
    const translated = tools.get("tea_maps_translate_selection").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: afterCreate.revision,
      delta: [16, 0, 0],
    });
    let staleError = "";
    try {
      tools.get("tea_maps_translate_selection").execute({
        expectedDocumentId: before.documentId,
        expectedRevision: afterCreate.revision,
        delta: [16, 0, 0],
      });
    } catch (error) {
      staleError = error.message;
    }
    const undone = await tools.get("tea_maps_history").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: translated.revision,
      action: "undo",
    });
    const rotated = tools.get("tea_maps_rotate_selection").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: undone.revision,
      pivot: [32, 32, 32],
      axis: "z",
      degrees: 90,
    });
    const scaled = tools.get("tea_maps_scale_selection").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: rotated.revision,
      pivot: [32, 32, 32],
      factors: [1.5, 1, 1],
    });
    const sheared = tools.get("tea_maps_shear_selection").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: scaled.revision,
      pivot: [32, 32, 32],
      sourceAxis: "x",
      targetAxis: "y",
      factor: 0.25,
    });
    const applied = tools.get("tea_maps_apply_material").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: sheared.revision,
      material: "BRICK",
    });
    const material = tools.get("tea_maps_list_materials").execute({
      query: "BRICK",
      usedOnly: true,
    });
    const worldspawn = tools
      .get("tea_maps_list_objects")
      .execute({ kind: "entity" }).objects[0];
    const property = tools.get("tea_maps_edit_entity_property").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: applied.revision,
      entityId: worldspawn.id,
      key: "message",
      value: "Site tool map",
    });
    const point = tools.get("tea_maps_create_point_entity").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: property.revision,
      classname: "info_player_start",
      origin: [32, 32, 32],
    });
    const duplicated = tools.get("tea_maps_duplicate_selection").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: point.revision,
      delta: [16, 0, 0],
    });
    const deleted = tools.get("tea_maps_delete_selection").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: duplicated.revision,
    });
    return {
      names: [...tools.keys()],
      before,
      activeTool,
      created,
      selected,
      translated,
      staleError,
      undone,
      rotated,
      scaled,
      sheared,
      applied,
      material,
      property,
      point,
      duplicated,
      deleted,
      inspection: inspect(),
      objects: tools.get("tea_maps_list_objects").execute({}),
      source: tools.get("tea_maps_get_map_source").execute({}),
    };
  });
  assert.equal(siteTools.names.length, 21);
  assert.equal(siteTools.activeTool.activeTool, "rotate");
  assert.equal(siteTools.inspection.name, "tea-map.map");
  assert.equal(siteTools.inspection.counts.brushes, 1);
  assert.equal(siteTools.objects.total, 3);
  assert.deepEqual(siteTools.selected.selection.brushIds, [
    siteTools.created.brushId,
  ]);
  assert.ok(siteTools.translated.revision > siteTools.created.revision);
  assert.ok(siteTools.undone.revision > siteTools.translated.revision);
  assert.ok(siteTools.sheared.revision > siteTools.undone.revision);
  assert.equal(siteTools.material.materials[0].faceCount, 6);
  assert.ok(siteTools.point.revision > siteTools.property.revision);
  assert.ok(siteTools.deleted.revision > siteTools.duplicated.revision);
  assert.equal(siteTools.inspection.counts.pointEntities, 1);
  assert.match(siteTools.staleError, /Stale document revision/);
  assert.match(siteTools.source.text, /worldspawn/);
  result.checks.push(
    "browser WebMCP tools inspect and edit the live editor with revision guards",
  );
  const sourceReplacement = await siteToolPage.evaluate(async () => {
    const tools = window.teaMapsTestTools;
    const inspect = () => tools.get("tea_maps_inspect_editor").execute({});
    const before = inspect();
    let rejected = "";
    try {
      await tools.get("tea_maps_replace_map_source").execute({
        expectedDocumentId: before.documentId,
        expectedRevision: before.revision,
        source: '{\n"classname" "worldspawn"\n}\n',
      });
    } catch (error) {
      rejected = error.message;
    }
    const replaced = await tools.get("tea_maps_replace_map_source").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: before.revision,
      source: '{\n"classname" "worldspawn"\n}\n',
      name: "replaced.map",
      confirmDestructive: true,
    });
    return { rejected, replaced, inspection: inspect() };
  });
  assert.match(sourceReplacement.rejected, /Tool input is invalid/);
  assert.equal(sourceReplacement.replaced.name, "replaced.map");
  assert.equal(sourceReplacement.inspection.counts.brushes, 0);
  assert.equal(sourceReplacement.inspection.dirty, true);
  await siteToolPage.reload();
  await siteToolPage.waitForFunction(
    () => document.documentElement.dataset.teaMapsSiteTools === "ready",
  );
  const recoveredReplacement = await siteToolPage.evaluate(() =>
    window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({}),
  );
  assert.equal(recoveredReplacement.name, "replaced.map");
  assert.equal(recoveredReplacement.dirty, true);
  result.checks.push(
    "browser site tool replaces source as a detached local copy",
  );
  await page.goto(hostedEditorUrl);
  await page.waitForFunction(
    () => document.documentElement.dataset.teaMapsSiteTools === "ready",
  );
  await page.waitForFunction(
    () =>
      document.querySelector("#switch-map-dialog")?.open ||
      /live editing|Hosted map · connected/.test(
        document.querySelector("#editor-status")?.textContent ?? "",
      ),
  );
  if (await page.locator("#switch-map-dialog").isVisible())
    await page.getByRole("button", { name: "Discard" }).click();
  try {
    await page.getByText(/live editing|Hosted map · connected/).waitFor();
  } catch (error) {
    throw new Error(
      `Hosted editor did not reconnect: ${JSON.stringify({ url: page.url(), status: await page.locator("#editor-status").textContent(), dialog: await page.locator("#switch-map-dialog").isVisible(), errors })}`,
      { cause: error },
    );
  }
  const hostedToolEdit = await page.evaluate(() => {
    const tools = window.teaMapsTestTools;
    const before = tools.get("tea_maps_inspect_editor").execute({});
    const created = tools.get("tea_maps_create_box").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: before.revision,
      min: [0, 0, 0],
      max: [64, 64, 64],
      material: "STONE",
    });
    return { before, created };
  });
  assert.equal(hostedToolEdit.before.hostedMap.role, "owner");
  await page.getByText(/Hosted map saved/).waitFor({ timeout: 20_000 });
  await page.reload();
  await page.waitForFunction(
    () =>
      document.querySelector("#switch-map-dialog")?.open ||
      document
        .querySelector("#editor-status")
        ?.textContent?.includes("live editing"),
  );
  if (await page.locator("#switch-map-dialog").isVisible())
    await page.getByRole("button", { name: "Discard" }).click();
  await page.getByText(/live editing/).waitFor();
  const hostedAfterReload = await page.evaluate(() =>
    window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({}),
  );
  assert.equal(hostedAfterReload.counts.brushes, 1);
  result.checks.push(
    "browser WebMCP authoring survives hosted room persistence",
  );
  const detachedSource = await page.evaluate(async (mapId) => {
    const draftDb = await new Promise((resolve, reject) => {
      const request = indexedDB.open("tea-maps-editor");
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener("error", () => reject(request.error), {
        once: true,
      });
    });
    const draft = await new Promise((resolve, reject) => {
      const request = draftDb
        .transaction("drafts")
        .objectStore("drafts")
        .get("current");
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener("error", () => reject(request.error), {
        once: true,
      });
    });
    draftDb.close();
    if (!draft?.document || !draft.sourceState)
      throw new Error("Expected a saved local recovery draft");
    const collaborationDb = await new Promise((resolve, reject) => {
      const request = indexedDB.open("tea-maps-collaboration");
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener("error", () => reject(request.error), {
        once: true,
      });
    });
    const transaction = collaborationDb.transaction(
      "detached-maps",
      "readwrite",
    );
    await new Promise((resolve, reject) => {
      const request = transaction.objectStore("detached-maps").put({
        version: 1,
        id: "smoke-detached-map",
        originalMapId: mapId,
        documentKey: "smoke-detached-map",
        fileName: "recovered-hosted.map",
        profile: "quake",
        document: draft.document,
        source: draft.sourceState,
        originalMapVersion: 1,
        createdAt: Date.now(),
        reason: "Fixture conflict",
        operationCount: 1,
        encodedBytes: 1,
      });
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener("error", () => reject(request.error), {
        once: true,
      });
    });
    await new Promise((resolve, reject) => {
      transaction.addEventListener("complete", resolve, { once: true });
      transaction.addEventListener("error", () => reject(transaction.error), {
        once: true,
      });
      transaction.addEventListener("abort", () => reject(transaction.error), {
        once: true,
      });
    });
    collaborationDb.close();
    return draft.sourceState.originalText;
  }, hostedAfterReload.hostedMap.id);
  await page.reload();
  await page.waitForFunction(
    () =>
      document.querySelector("#switch-map-dialog")?.open ||
      document
        .querySelector("#editor-status")
        ?.textContent?.includes("live editing"),
  );
  if (await page.locator("#switch-map-dialog").isVisible())
    await page.getByRole("button", { name: "Discard" }).click();
  await page.locator("#detached-editor-open").waitFor({ state: "attached" });
  await page.waitForFunction(
    () => !document.querySelector("#detached-editor-open")?.disabled,
  );
  if (
    !(await page
      .locator("#hosted-editor-picker")
      .evaluate((picker) => picker.open))
  )
    await page.locator("#hosted-editor-picker summary").first().click();
  await page.locator("#detached-editor-map").selectOption("smoke-detached-map");
  await page.locator("#detached-editor-open").click();
  await page.getByText(/Local recovery copy recovered-hosted.map/).waitFor();
  const detachedCopy = await page.evaluate(() => ({
    inspection: window.teaMapsTestTools
      .get("tea_maps_inspect_editor")
      .execute({}),
    source: window.teaMapsTestTools.get("tea_maps_get_map_source").execute({}),
  }));
  assert.equal(detachedCopy.inspection.name, "recovered-hosted.map");
  assert.equal(detachedCopy.inspection.hostedMap, null);
  assert.equal(detachedCopy.inspection.dirty, true);
  assert.equal(detachedCopy.source.text, detachedSource);
  result.checks.push("saved detached hosted edits reopen as a local copy");
  await page.evaluate(() => {
    const tools = window.teaMapsTestTools;
    const before = tools.get("tea_maps_inspect_editor").execute({});
    tools.get("tea_maps_create_box").execute({
      expectedDocumentId: before.documentId,
      expectedRevision: before.revision,
      min: [0, 0, 0],
      max: [48, 48, 48],
      material: "STONE",
    });
  });
  await page.locator("#show-versions").click();
  await page.locator("#versions-dialog").waitFor({ state: "visible" });
  const recoveryRow = page
    .locator("#versions-list .version-row")
    .filter({ hasText: "recovered-hosted.map · Revision 1" });
  await recoveryRow.waitFor();
  await recoveryRow.getByRole("button", { name: "Protect" }).click();
  await recoveryRow.getByRole("button", { name: "Unprotect" }).waitFor();
  await recoveryRow.getByRole("button", { name: "Unprotect" }).click();
  await recoveryRow.getByRole("button", { name: "Protect" }).waitFor();
  await recoveryRow.getByRole("button", { name: "Restore copy" }).click();
  await page.locator("#switch-map-dialog").waitFor({ state: "visible" });
  await page
    .locator("#switch-map-dialog")
    .getByRole("button", { name: "Cancel" })
    .click();
  await page.getByText("Restore cancelled").waitFor();
  assert.equal(
    (
      await page.evaluate(() =>
        window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({}),
      )
    ).counts.brushes,
    1,
  );
  result.checks.push("Remix recovery versions protect and guarded restore");
  await page.locator("#close-versions").click();
  await page.goto(`${mapsOrigin}/projects`);
  const recoveredLink = page
    .locator("#detached-maps-list a")
    .filter({ hasText: "Open copy" });
  await recoveredLink.waitFor();
  assert.match(
    await recoveredLink.getAttribute("href"),
    /detachedMap=smoke-detached-map/,
  );
  await recoveredLink.click();
  await page.waitForFunction(
    () =>
      document.querySelector("#switch-map-dialog")?.open ||
      document
        .querySelector("#editor-status")
        ?.textContent?.includes("Local recovery copy"),
  );
  if (await page.locator("#switch-map-dialog").isVisible())
    await page.getByRole("button", { name: "Discard" }).click();
  await page.getByText(/Local recovery copy recovered-hosted.map/).waitFor();
  const reopenedCopy = await page.evaluate(() =>
    window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({}),
  );
  assert.equal(reopenedCopy.counts.brushes, 1);
  await page.waitForFunction(
    () => !new URL(location.href).searchParams.has("detachedMap"),
  );
  assert.equal(new URL(page.url()).searchParams.has("detachedMap"), false);
  result.checks.push(
    "Projects page reopens the latest local recovery revision",
  );

  const localProjectPage = await browser.newPage();
  await localProjectPage.goto(`${mapsOrigin}/projects`);
  await localProjectPage.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const folder = await root.getDirectoryHandle("smoke-direct-local-project", {
      create: true,
    });
    for (const [name, contents] of [
      [
        "tea.maps.project.json",
        JSON.stringify({
          schemaVersion: 1,
          name: "Direct local project",
          game: "quake",
          mapRoots: ["."],
          resources: { wads: [], spriteRoots: [], entityDefinitions: [] },
          buildProfiles: [],
        }),
      ],
      ["direct.map", '{\n"classname" "worldspawn"\n}\n'],
    ]) {
      const file = await folder.getFileHandle(name, { create: true });
      const writer = await file.createWritable();
      await writer.write(contents);
      await writer.close();
    }
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: async () => folder,
    });
  });
  await localProjectPage.locator("#projects-open-local").click();
  await localProjectPage.waitForURL(/\/editor\?recentProject=/);
  await localProjectPage
    .getByRole("heading", { name: "Direct local project" })
    .waitFor();
  await localProjectPage
    .getByRole("button", { name: "Open direct.map" })
    .click();
  await localProjectPage
    .locator("#project-map-selector")
    .waitFor({ state: "hidden" });
  assert.equal(
    await localProjectPage.locator("#document-name").textContent(),
    "direct.map",
  );
  await localProjectPage.close();
  result.checks.push(
    "Projects page opens a local folder directly through the Remix control",
  );

  await page.evaluate(async () => {
    const request = indexedDB.open("tea-maps-recent-projects", 1);
    const database = await new Promise((resolve, reject) => {
      request.addEventListener("upgradeneeded", () => {
        request.result.createObjectStore("projects", { keyPath: "id" });
      });
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("projects", "readwrite");
      transaction.objectStore("projects").put({
        id: "smoke-recent-project",
        name: "Smoke recent project",
        handle: { kind: "directory", name: "smoke-folder" },
        lastMapPath: "maps/beta.map",
        updatedAt: Date.now(),
      });
      transaction.addEventListener("complete", resolve);
      transaction.addEventListener("error", () => reject(transaction.error));
    });
    database.close();
  });
  await page.goto(`${mapsOrigin}/projects`);
  const recentRow = page
    .locator("#local-projects-list .project-row")
    .filter({ hasText: "Smoke recent project" });
  await recentRow.getByText("maps/beta.map").waitFor();
  await recentRow.getByRole("button", { name: "Open in editor" }).click();
  await page.waitForURL(/recentProject=smoke-recent-project/);
  result.checks.push("Projects page opens a hydrated recent project row");
  await page.locator("#recent-projects summary").click();
  const editorRecentRow = page
    .locator("#recent-project-list button")
    .filter({ hasText: "Smoke recent project" });
  await editorRecentRow.getByText("maps/beta.map").waitFor();
  await editorRecentRow.click();
  const recentError = page.locator("#recent-project-list [role='status']");
  await recentError.waitFor();
  assert.doesNotMatch(
    await recentError.textContent(),
    /editor is still starting/i,
  );
  result.checks.push(
    "Remix editor recent-project menu renders and invokes stored folders",
  );
  await page.goto(
    `${mapsOrigin}/editor?hostedProject=${projectUrl.split("/").at(-1)}`,
  );
  await page.locator("#hosted-project-create summary").click();
  await page.locator("#hosted-project-name").fill("Picker project");
  await page.locator("#hosted-project-create-button").click();
  await page.getByText("Created Picker project").waitFor();
  assert.equal(
    await page.locator("#hosted-editor-project option:checked").textContent(),
    "Picker project",
  );
  await page.locator("#hosted-map-create summary").click();
  await page.locator("#hosted-map-name").fill("picker.map");
  assert.equal(
    await page.locator("#hosted-map-name").inputValue(),
    "picker.map",
  );
  await page.locator("#hosted-map-create-button").click();
  await page.locator("#switch-map-dialog").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Discard" }).click();
  try {
    await page
      .getByText("Picker project / picker.map opened")
      .waitFor({ timeout: 5000 });
  } catch (cause) {
    throw new Error(
      `Picker map did not open: ${JSON.stringify({
        pickerStatus: await page.locator("#hosted-editor-status").textContent(),
        editorStatus: await page.locator("#editor-status").textContent(),
        selectedProject: await page
          .locator("#hosted-editor-project")
          .inputValue(),
        selectedMap: await page.locator("#hosted-editor-map").inputValue(),
        switchOpen: await page
          .locator("#switch-map-dialog")
          .evaluate((dialog) => dialog.open),
        errors,
      })}`,
      { cause },
    );
  }
  assert.equal(
    await page.locator("#hosted-editor-map option:checked").textContent(),
    "picker.map",
  );
  result.checks.push("Remix hosted picker creates and opens a map");
  await page.locator("#hosted-presence-toggle").getByText("Live · 1").waitFor();
  const localCopyMapId = await page.evaluate(
    () => window.teaMapsHostedPresence.mapId,
  );
  const hostedBeforeLocalCopy = (
    await (
      await page.request.get(`${mapsOrigin}/api/maps/${localCopyMapId}`)
    ).json()
  ).map;
  await page.locator("#hosted-local-copy").click();
  await page.waitForFunction(
    () =>
      !new URL(location.href).searchParams.has("hostedMap") &&
      window.teaMapsHostedPresence === null,
  );
  await page.getByText("Local copy of picker.map").waitFor();
  assert.equal(
    await page.locator("#map-source").inputValue(),
    hostedBeforeLocalCopy.source,
  );
  await page.locator("#inspector-tab-entity").click();
  await page.locator("#add-box:not([disabled])").click();
  await page.waitForFunction(
    () => document.querySelector("#brush-count")?.textContent === "1",
  );
  const hostedAfterLocalCopy = (
    await (
      await page.request.get(`${mapsOrigin}/api/maps/${localCopyMapId}`)
    ).json()
  ).map;
  assert.equal(
    hostedAfterLocalCopy.sourceSha256,
    hostedBeforeLocalCopy.sourceSha256,
  );
  result.checks.push("Remix presence panel leaves room as a local copy");
  assert.deepEqual(errors, []);
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
      result.error = `${result.error ?? ""}\nCleanup: ${error}`;
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
