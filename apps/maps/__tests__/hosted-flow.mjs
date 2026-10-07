import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
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

  await page.locator("#projects-login").click();
  await page.getByText("Signed in as Test Mapper").waitFor();
  await page.locator("#projects-create summary").click();
  await page.locator("#projects-create-name").fill("Smoke Project");
  await page.locator("#projects-create-form button").click();
  await page.waitForURL(/\/projects\/[a-z0-9]{12}$/);
  await page.getByText("No maps in this project yet").waitFor();
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
  await observer.close();
  result.checks.push("owner grants viewer access with read-only project pages");

  await page.getByRole("link", { name: "Resources" }).click();
  await page.getByText("No project resources yet").waitFor();
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
  await page.getByText("Smoke Project / smoke.map opened").waitFor();
  const hostedEditorUrl = page.url();
  assert.deepEqual(errors, []);
  result.checks.push(
    "hosted map creation and editor launch through live collaboration service",
  );
  await page.locator("#hosted-builds summary").click();
  await page.getByText("0 builds · hosted compiler available").waitFor();
  await page.locator("#build-map").click();
  const download = page.getByRole("link", { name: "Download BSP" });
  await download.waitFor({ timeout: 30_000 });
  const artifact = await page.request.get(
    `${mapsOrigin}${await download.getAttribute("href")}`,
  );
  assert.equal(artifact.status(), 200);
  assert.deepEqual(await artifact.body(), bsp);
  assert.equal(compileRequests.length, 1);
  assert.match(compileRequests[0].mapText, /worldspawn/);
  assert.equal(compileRequests[0].expectedDocumentRevision, 0);
  result.checks.push(
    "hosted BSP build queue, compiler request, history, and artifact download",
  );
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
  await installSiteToolMock(page);
  await page.goto(`${mapsOrigin}/editor`);
  await page.evaluate(() => {
    const manifest = JSON.stringify({
      schemaVersion: 1,
      name: "Smoke local project",
      game: "quake",
      mapRoots: ["maps"],
      resources: { wads: [], spriteRoots: [], entityDefinitions: [] },
      buildProfiles: [],
    });
    const fixture = {
      file(name, source) {
        return {
          kind: "file",
          name,
          getFile: async () => new File([source], name),
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
        fixture.file(`${name}.map`, '{\n"classname" "worldspawn"\n}\n'),
      ]),
    );
    const root = fixture.directory("smoke", {
      "worldview.project.json": fixture.file(
        "worldview.project.json",
        manifest,
      ),
      maps: fixture.directory("maps", mapFiles),
    });
    window.showDirectoryPicker = async () => root;
  });
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
  await page.locator("#open-project").click();
  await page.locator("#project-map-selector").waitFor({ state: "visible" });
  result.checks.push("local project map chooser and filtered map selection");
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
      document
        .querySelector("#editor-status")
        ?.textContent?.includes("live editing"),
  );
  if (await page.locator("#switch-map-dialog").isVisible())
    await page.getByRole("button", { name: "Discard" }).click();
  await page.getByText(/live editing/).waitFor();
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
      !document.querySelector("#detached-editor-open")?.disabled,
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
  await page
    .locator("#versions-list .version-row")
    .filter({ hasText: "recovered-hosted.map · Revision 1" })
    .waitFor();
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
  assert.equal(new URL(page.url()).searchParams.has("detachedMap"), false);
  result.checks.push(
    "Projects page reopens the latest local recovery revision",
  );
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
