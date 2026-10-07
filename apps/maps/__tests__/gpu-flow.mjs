import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const teaRoot = fileURLToPath(new URL("../../..", import.meta.url));
const origin = "http://localhost:8790";
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
  await page.goto(`${origin}/?example=quake`);
  await page
    .locator("#viewer-status")
    .getByText(/^Ready/)
    .waitFor();
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
  assert.deepEqual(pageErrors, []);
  console.log(
    JSON.stringify({
      status: "passed",
      checks: [
        "WebGPU editor initializes four viewports",
        "Top viewport selects and drags a brush",
        "Undo restores the pre-drag source",
        "WebGPU viewer loads a generated Quake BSP",
      ],
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
}
