import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  syntheticGoldSrcAudioBsp,
  syntheticGoldSrcWave,
} from "../app/assets/synthetic.ts";

const standalonePath = fileURLToPath(
  new URL(
    "../../../packages/maps-renderer/dist/standalone.js",
    import.meta.url,
  ),
);
const standalone = await readFile(standalonePath);
const bsp = Buffer.from(syntheticGoldSrcAudioBsp());
const wave = [...syntheticGoldSrcWave()];
const server = createServer((request, response) => {
  if (request.url === "/standalone.js") {
    response.writeHead(200, { "Content-Type": "application/javascript" });
    response.end(standalone);
  } else if (request.url === "/") {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end('<body style="margin:0"></body>');
  } else {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const flags = [
  "--enable-features=Vulkan",
  "--use-angle=swiftshader",
  "--use-vulkan=swiftshader",
  "--use-webgpu-adapter=swiftshader",
  "--disable-vulkan-surface",
  "--enable-unsafe-webgpu",
];
let browser;

async function waitFor(page, predicate, label) {
  await page
    .waitForFunction(predicate, undefined, { timeout: 15_000 })
    .catch((cause) => {
      throw new Error(`${label} did not become ready`, { cause });
    });
}

async function checkEmbeddedInput(timing) {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let releaseMap;
  const mapGate = new Promise((resolve) => (releaseMap = resolve));
  if (timing === "after loading") releaseMap();
  await page.route("**/input.bsp", async (route) => {
    await mapGate;
    await route.fulfill({ body: bsp });
  });
  try {
    await page.goto(origin);
    await page.evaluate(async (audioWave) => {
      await import("/standalone.js");
      const element = document.createElement("tea-map-view");
      const probe = {
        element,
        context: null,
        analyser: null,
        resumeGestures: [],
        starts: 0,
        ready: 0,
        looks: [],
      };
      window.teaMapsEmbedProbe = probe;
      const createGain = AudioContext.prototype.createGain;
      AudioContext.prototype.createGain = function () {
        const gain = createGain.call(this);
        if (!probe.context) {
          probe.context = this;
          probe.analyser = this.createAnalyser();
          gain.connect(probe.analyser);
        }
        return gain;
      };
      const resume = AudioContext.prototype.resume;
      AudioContext.prototype.resume = function () {
        probe.resumeGestures.push(navigator.userActivation.isActive);
        return resume.call(this);
      };
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        probe.starts += 1;
        return start.apply(this, args);
      };
      element.style.width = "800px";
      element.style.height = "480px";
      element.setAttribute("controls", "fly");
      element.source = {
        bsp: "/input.bsp",
        sounds: {
          "ambience/tone.wav": new Uint8Array(audioWave),
          "music/tone.wav": new Uint8Array(audioWave),
        },
      };
      element.addEventListener("ready", () => (probe.ready += 1));
      element.addEventListener("mousemove", (event) => {
        if (element.viewer && (event.movementX || event.movementY)) {
          const { yaw, pitch } = element.viewer.camera;
          probe.looks.push({ yaw, pitch, trusted: event.isTrusted });
        }
      });
      document.body.append(element);
    }, wave);
    await waitFor(
      page,
      () => Boolean(window.teaMapsEmbedProbe.element.viewer),
      "Embedded viewer",
    );
    if (timing === "after loading")
      await waitFor(page, () => window.teaMapsEmbedProbe.ready === 1, "Map");
    assert.equal(
      await page.evaluate(() => window.teaMapsEmbedProbe.context),
      null,
    );

    const canvas = page.locator("tea-map-view canvas");
    await canvas.click();
    await waitFor(
      page,
      () => {
        const element = window.teaMapsEmbedProbe.element;
        return (
          document.pointerLockElement === element &&
          element.shadowRoot.pointerLockElement ===
            element.shadowRoot.querySelector("canvas")
        );
      },
      "Embedded pointer lock",
    );
    releaseMap();
    await waitFor(page, () => window.teaMapsEmbedProbe.ready === 1, "Map");
    await waitFor(
      page,
      () => {
        const audio = window.teaMapsEmbedProbe.element.viewer.audio;
        return audio.enabled && !audio.suspended;
      },
      "Embedded audio",
    );
    await waitFor(
      page,
      () => {
        const analyser = window.teaMapsEmbedProbe.analyser;
        if (!analyser) return false;
        const samples = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(samples);
        return Math.max(...samples.map(Math.abs)) > 0.001;
      },
      "Audible output",
    );
    assert.deepEqual(
      await page.evaluate(() => window.teaMapsEmbedProbe.resumeGestures),
      [true],
    );

    const camera = await page.evaluate(() => {
      window.teaMapsEmbedProbe.looks = [];
      return window.teaMapsEmbedProbe.element.viewer.camera;
    });
    await page.mouse.move(600, 200);
    await page.mouse.move(650, 230, { steps: 3 });
    assert.equal(
      await page.evaluate(
        (before) =>
          window.teaMapsEmbedProbe.looks.some(
            (look) =>
              look.trusted &&
              look.yaw !== before.yaw &&
              look.pitch !== before.pitch,
          ),
        camera,
      ),
      true,
    );

    await page.evaluate(async () => {
      document.exitPointerLock();
      await window.teaMapsEmbedProbe.context.suspend();
    });
    await waitFor(
      page,
      () => window.teaMapsEmbedProbe.element.viewer.audio.suspended,
      "Suspended audio",
    );
    await canvas.click();
    await waitFor(
      page,
      () => !window.teaMapsEmbedProbe.element.viewer.audio.suspended,
      "Resumed audio",
    );
    assert.deepEqual(
      await page.evaluate(() => ({
        ready: window.teaMapsEmbedProbe.ready,
        starts: window.teaMapsEmbedProbe.starts,
        resumes: window.teaMapsEmbedProbe.resumeGestures,
      })),
      { ready: 1, starts: 1, resumes: [true, true] },
    );
    assert.deepEqual(errors, []);
  } finally {
    releaseMap();
    await page.close();
  }
}

try {
  browser = await chromium.launch({ headless: true, args: flags });
  for (const timing of ["after loading", "while loading"])
    await checkEmbeddedInput(timing);
  console.log(
    JSON.stringify({
      status: "passed",
      checks: [
        "Packaged element captures pointer lock and renders mouse look",
        "Embedded audio starts from a trusted click and resumes without reloading",
        "Interaction also works while a BSP request is pending",
      ],
    }),
  );
} catch (cause) {
  console.error(
    JSON.stringify({
      status: "failed",
      error: cause instanceof Error ? cause.stack : String(cause),
    }),
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
