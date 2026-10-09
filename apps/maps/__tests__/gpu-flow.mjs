import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { syntheticQuakeBsp } from "../app/assets/synthetic.ts";

const teaRoot = fileURLToPath(new URL("../../..", import.meta.url));
const testCorpusAll = process.argv.includes("--corpus-all");
const testCorpus = process.argv.includes("--corpus") || testCorpusAll;
const assetReportPath = process.argv
  .find((argument) => argument.startsWith("--asset-report="))
  ?.slice("--asset-report=".length);
if (assetReportPath && !testCorpusAll)
  throw new Error("--asset-report requires --corpus-all");
if (testCorpus && !process.env.TEA_MAPS_LOCAL_FIXTURE_ROOT)
  throw new Error(
    "Set TEA_MAPS_LOCAL_FIXTURE_ROOT to the existing local fixture directory",
  );
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => resolve(address.port));
  });
});
const origin = `http://localhost:${port}`;
const flags = [
  "--enable-features=Vulkan",
  "--use-angle=swiftshader",
  "--use-vulkan=swiftshader",
  "--use-webgpu-adapter=swiftshader",
  "--disable-vulkan-surface",
  "--enable-unsafe-webgpu",
];
const server = spawn("npm", ["run", "dev", "--workspace", "@tea/maps"], {
  cwd: teaRoot,
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, TEA_MAPS_DEV_PORT: String(port) },
});
let serverLogs = "";
for (const stream of [server.stdout, server.stderr])
  stream.on("data", (chunk) => {
    serverLogs = (serverLogs + chunk.toString()).slice(-12_000);
  });

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null)
      throw new Error(`Maps dev server exited\n${serverLogs}`);
    try {
      const response = await fetch(origin, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
    } catch {}
    await delay(200);
  }
  throw new Error(`Maps dev server did not become ready\n${serverLogs}`);
}

let browser;
let corpusFixtures = 0;
const assetReport = [];
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true, args: flags });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const tools = new Map();
    Object.defineProperty(document, "modelContext", {
      value: { registerTool: (tool) => tools.set(tool.name, tool) },
    });
    window.teaMapsTestTools = tools;
  });
  await page.addInitScript((bspBase64) => {
    const originalFetch = window.fetch.bind(window);
    let releaseCompile;
    const compileReleased = new Promise((resolve) => {
      releaseCompile = resolve;
    });
    window.teaMapsReleaseGpuCompile = () => releaseCompile();
    window.teaMapsGpuCompilerRequests = [];
    window.fetch = async (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : input,
        location.href,
      );
      if (url.origin !== "http://127.0.0.1:8788")
        return originalFetch(input, init);
      if (url.pathname === "/capabilities")
        return Response.json({
          protocolVersion: 1,
          compileProfiles: [
            {
              id: "gpu-smoke-quake",
              label: "GPU smoke Quake",
              game: "quake",
              qualities: ["preview"],
            },
          ],
          launchProfiles: [],
        });
      if (url.pathname === "/compile") {
        const request = JSON.parse(init.body);
        window.teaMapsGpuCompilerRequests.push(request);
        await compileReleased;
        return Response.json({
          status: "succeeded",
          buildId: "gpu-smoke-build",
          sourceDocumentRevision: request.expectedDocumentRevision,
          diagnostics: [],
          logs: [
            { stage: "qbsp", text: "GPU smoke artifact", truncated: false },
          ],
          elapsedMilliseconds: 7,
          artifacts: [
            {
              name: "gpu-smoke.bsp",
              kind: "bsp",
              mediaType: "application/octet-stream",
              base64: bspBase64,
            },
          ],
        });
      }
      return new Response(null, { status: 404 });
    };
  }, Buffer.from(syntheticQuakeBsp()).toString("base64"));
  await page.goto(`${origin}/editor`);
  const gpu = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) return false;
    const device = await adapter.requestDevice();
    const lost = await Promise.race([
      device.lost.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 1_000)),
    ]);
    device.destroy();
    return !lost;
  });
  assert.equal(gpu, true, "WebGPU software adapter is unavailable");
  await page.locator("#xy[data-face-alignment-count]").waitFor();
  await page.locator("#inspector-tab-entity").click();
  await page.locator("#add-box:enabled").click();
  await page.waitForFunction(
    () => document.querySelector("#brush-count")?.textContent === "1",
  );
  const before = await page.evaluate(() => ({
    revision: window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
      .revision,
    source: window.teaMapsTestTools.get("tea_maps_get_map_source").execute({})
      .text,
  }));
  const bounds = await page.locator("#xy").boundingBox();
  assert.ok(bounds, "Top viewport has no bounds");
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.click(x, y);
  await page
    .locator("#selection-info")
    .getByText(/Selected brush/)
    .waitFor();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 45, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(
    (revision) =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
        .revision > revision,
    before.revision,
  );
  const afterDrag = await page.evaluate(
    () =>
      window.teaMapsTestTools.get("tea_maps_get_map_source").execute({}).text,
  );
  assert.notEqual(afterDrag, before.source, "Viewport drag did not move brush");
  await page.locator("#undo").click();
  await page.waitForFunction(
    (source) =>
      window.teaMapsTestTools.get("tea_maps_get_map_source").execute({})
        .text === source,
    before.source,
  );
  await page.locator("#toggle-inspector").click();
  assert.equal(await page.locator("#editor-inspector").isVisible(), false);
  await page.reload();
  await page.waitForFunction(
    () =>
      document.querySelector(".editor-workspace")?.dataset.inspectorOpen ===
      "false",
  );
  await page.waitForFunction(
    () => document.documentElement.dataset.teaMapsSiteTools === "ready",
  );
  assert.equal(await page.locator("#editor-inspector").isVisible(), false);
  await page.locator("#toggle-inspector").click();
  assert.equal(await page.locator("#editor-inspector").isVisible(), true);
  const cameraAtBuild = await page.evaluate(
    () =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
        .perspectiveCamera,
  );
  await page
    .locator('.editor-menu[data-menu="build"]')
    .evaluate((menu) => (menu.open = true));
  await page.locator("#build-map:enabled").click();
  await page.waitForFunction(
    () => window.teaMapsGpuCompilerRequests.length === 1,
  );
  const perspectiveBounds = await page.locator("#perspective").boundingBox();
  assert.ok(perspectiveBounds, "Perspective viewport has no bounds");
  const centerX = perspectiveBounds.x + perspectiveBounds.width / 2;
  const centerY = perspectiveBounds.y + perspectiveBounds.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(centerX + 90, centerY - 45, { steps: 5 });
  await page.mouse.up({ button: "right" });
  const cameraWhileCompiling = await page.evaluate(
    () =>
      window.teaMapsTestTools.get("tea_maps_inspect_editor").execute({})
        .perspectiveCamera,
  );
  assert.notEqual(cameraWhileCompiling.yaw, cameraAtBuild.yaw);
  await page.evaluate(() => window.teaMapsReleaseGpuCompile());
  await page.waitForFunction(() =>
    document
      .querySelector("#build-status")
      ?.textContent?.includes("Compiled preview ready"),
  );
  const compiled = page.locator(".perspective-header ~ world-view");
  const compiledDiagnostics = await compiled.evaluate(
    (element) => element.viewer?.diagnostics,
  );
  assert.equal(compiledDiagnostics?.format, "quake-bsp29");
  assert.ok(
    compiledDiagnostics.triangles > 0,
    "Compiled preview has no rendered faces",
  );
  const compiledCamera = await compiled.evaluate(
    (element) => element.viewer?.camera,
  );
  assert.deepEqual(compiledCamera.position, cameraAtBuild.position);
  assert.equal(compiledCamera.yaw, cameraAtBuild.yaw);
  assert.equal(compiledCamera.pitch, cameraAtBuild.pitch);
  assert.equal(compiledCamera.fieldOfView, cameraAtBuild.fieldOfViewDegrees);
  assert.equal(await compiled.getAttribute("data-active"), "true");
  await page
    .locator('.editor-menu[data-menu="build"]')
    .evaluate((menu) => (menu.open = true));
  await page.locator("#toggle-compiled").click();
  assert.equal(await compiled.getAttribute("data-active"), "false");
  await page.locator("#toggle-compiled").click();
  assert.equal(await compiled.getAttribute("data-active"), "true");
  assert.equal(
    await page.evaluate(() => window.teaMapsGpuCompilerRequests.length),
    1,
  );
  await page.goto(`${origin}/?example=quake`);
  await page
    .locator("#viewer-status")
    .getByText(/^Ready/)
    .waitFor();
  await page.locator('[data-dock-target="dock-tools"]').click();
  await page
    .locator("#map-details")
    .getByText(/QUAKE-BSP29 29/)
    .waitFor();
  assert.equal(
    await page
      .locator("#viewport world-view")
      .evaluate((element) => Boolean(element.viewer?.world)),
    true,
  );
  await page.locator('[data-dock-target="dock-open"]').click();
  await page.locator("#example").selectOption("goldsrc");
  await page.getByRole("button", { name: "Open example" }).click();
  await page.locator('[data-dock-target="dock-tools"]').click();
  await page
    .locator("#map-details")
    .getByText(/GOLDSRC-BSP30 30/)
    .waitFor();
  assert.equal(
    await page
      .locator("#viewport world-view")
      .evaluate((element) => element.viewer?.diagnostics?.format),
    "goldsrc-bsp30",
  );
  await page.locator("#download-overview:enabled").waitFor();
  const overviewDownload = page.waitForEvent("download");
  await page.locator("#download-overview").click();
  const overview = await overviewDownload;
  assert.match(overview.suggestedFilename(), /-overview\.png$/);
  const overviewPath = await overview.path();
  assert.ok(overviewPath, "Overview download has no file");
  const png = await readFile(overviewPath);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.byteLength > 1_000, "Overview image is unexpectedly small");
  await page.locator('[data-dock-target="dock-tools"]').click();
  await page.locator("#walkability-spacing").fill("32");
  await page.locator("#generate-walkability:enabled").click();
  await page.locator("#download-walkability:enabled").waitFor();
  const graphDownload = page.waitForEvent("download");
  await page.locator("#download-walkability").click();
  const graph = await graphDownload;
  assert.match(graph.suggestedFilename(), /\.tea-maps-walkability\.json$/);
  const graphPath = await graph.path();
  assert.ok(graphPath, "Walkability download has no file");
  const sidecar = JSON.parse(await readFile(graphPath, "utf8"));
  assert.equal(sidecar.format, "tea-maps-walkability");
  assert.ok(sidecar.nodes.length > 0, "Walkability graph has no nodes");
  await page.locator("#clear-walkability").click();
  assert.equal(await page.locator("#download-walkability").isDisabled(), true);
  await page.locator("#walkability-file").setInputFiles(graphPath);
  await page.locator("#download-walkability:enabled").waitFor();
  await page.goto(`${origin}/?example=quake-bsp2`);
  await page
    .locator("#viewer-status")
    .getByText(/^Ready/)
    .waitFor();
  assert.equal(
    await page
      .locator("#viewport world-view")
      .evaluate((element) => element.viewer?.diagnostics?.format),
    "quake-bsp2",
  );
  await page.goto(`${origin}/?example=quake2`);
  await page
    .locator("#viewer-status")
    .getByText(/^Ready/)
    .waitFor();
  const quake2 = await page
    .locator("#viewport world-view")
    .evaluate((element) => element.viewer?.diagnostics);
  assert.equal(quake2?.format, "quake2-bsp38");
  assert.ok(quake2.triangles > 0, "Quake II example has no rendered faces");
  assert.doesNotMatch(
    await page.locator("#map-warnings").textContent(),
    /missing.*(texture|palette)/i,
  );
  if (testCorpus) {
    page.setDefaultTimeout(90_000);
    const catalog = await (await fetch(`${origin}/local-fixtures.json`)).json();
    const localResponses = [];
    page.on("response", (response) => {
      if (new URL(response.url()).pathname.startsWith("/local/"))
        localResponses.push({ url: response.url(), status: response.status() });
    });
    const cases = [
      ["steam-corpus/thirty-flights-of-loving/bar1", "quake2-bsp38"],
      ["steam-corpus/ricochet/rc_arena", "goldsrc-bsp30"],
      ["steam-corpus/fleshcancer/dm1", "quake-bsp29"],
      ["steam-corpus/quake/map2b", "quake-bsp2"],
      ["steam-corpus/quake-ii/mgu1m1", "quake2-bsp38"],
    ];
    const knownIds = new Set(cases.map(([id]) => id));
    const allCases = testCorpusAll
      ? [
          ...cases,
          ...catalog
            .filter(
              (fixture) =>
                fixture.id.startsWith("steam-corpus/") &&
                !knownIds.has(fixture.id),
            )
            .map((fixture) => [fixture.id, null]),
        ]
      : cases;
    for (const [id, format] of allCases) {
      console.log(`Corpus ${corpusFixtures + 1}/${allCases.length}: ${id}`);
      localResponses.length = 0;
      assert.ok(
        catalog.some((fixture) => fixture.id === id),
        `${id} is absent from the local fixture catalog`,
      );
      await page.goto(`${origin}/?fixture=${encodeURIComponent(id)}`);
      try {
        await page
          .locator("#viewer-status")
          .getByText(/^Ready/)
          .waitFor();
      } catch (error) {
        throw new Error(
          `${id}: ${await page.locator("#viewer-status").textContent()}\n${JSON.stringify(localResponses.slice(-12))}`,
          { cause: error },
        );
      }
      const diagnostics = await page
        .locator("#viewport world-view")
        .evaluate((element) => element.viewer?.diagnostics);
      if (format) assert.equal(diagnostics?.format, format, `${id} format`);
      else
        assert.ok(
          [
            "quake-bsp29",
            "quake-bsp2",
            "goldsrc-bsp30",
            "quake2-bsp38",
          ].includes(diagnostics?.format),
          `${id} has an unexpected BSP format`,
        );
      assert.ok(diagnostics.triangles > 0, `${id} has no rendered faces`);
      const fetched = localResponses
        .filter((response) => response.status === 200)
        .map((response) => new URL(response.url).pathname);
      assert.ok(
        fetched.some((path) => path.endsWith(".bsp")),
        `${id} did not fetch its BSP`,
      );
      assetReport.push({
        id,
        format: diagnostics.format,
        warnings:
          (await page.locator("#map-warnings").textContent())?.trim() ?? "",
        failedFetches: localResponses
          .filter((response) => response.status >= 400)
          .map((response) => ({
            path: new URL(response.url).pathname,
            status: response.status,
          })),
      });
      if (!format) {
        corpusFixtures += 1;
        continue;
      }
      assert.doesNotMatch(
        await page.locator("#map-warnings").textContent(),
        /missing.*(texture|palette)/i,
        `${id} has missing assets`,
      );
      assert.ok(
        fetched.some((path) => /\.(?:lmp|pcx)$/u.test(path)),
        `${id} did not fetch its palette`,
      );
      if (format === "quake2-bsp38")
        assert.ok(
          fetched.some((path) => path.endsWith(".wal")),
          `${id} did not fetch a WAL texture`,
        );
      if (format === "quake-bsp2")
        assert.ok(
          fetched.some((path) => path.endsWith(".wad")),
          `${id} did not fetch a WAD`,
        );
      corpusFixtures += 1;
    }
  }
  assert.deepEqual(pageErrors, []);
  console.log(
    JSON.stringify({
      status: "passed",
      checks: [
        "WebGPU editor initializes four viewports",
        "Top viewport selects and drags a brush",
        "Undo restores the pre-drag source",
        "Inspector collapses and stays closed after reload",
        "Compiled BSP preview keeps the camera captured before build and toggles with source",
        "WebGPU viewer switches from Quake to GoldSrc BSP",
        "Overview exports a PNG and walkability sidecar round-trips",
        "WebGPU viewer opens a generated BSP2 map",
        "WebGPU viewer loads a generated Quake II map with its assets",
        ...(testCorpus
          ? [
              `WebGPU viewer loads ${corpusFixtures} owned-game corpus fixtures in place`,
            ]
          : []),
      ],
      ...(testCorpus ? { corpusFixtures } : {}),
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      status: "failed",
      error: error instanceof Error ? error.stack : String(error),
      serverLogs,
    }),
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server.pid && server.exitCode === null && server.signalCode === null)
    process.kill(-server.pid, "SIGKILL");
  if (assetReportPath)
    await writeFile(assetReportPath, JSON.stringify(assetReport, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
}
