import { planOverview, type OverviewCaptureOptions } from "@tea/maps-renderer";
import type { WorldViewElement } from "@tea/maps-renderer/element";
import { clientEntry, on, type Handle } from "remix/component";
import { downloadViewerFile, viewerMapFilename } from "./viewer-download.ts";

export const ViewerOverviewPanel = clientEntry(
  `file:///app/assets/viewer-overview-panel.tsx#ViewerOverviewPanel`,
  function ViewerOverviewPanelComponent(handle: Handle) {
    let element: WorldViewElement | null = null;
    let ready = false;
    let busy = false;
    let generation = 0;
    let size = "1024";
    let lighting = "lightmapped";
    let rotation = "auto";
    let cutaway = true;
    let transparent = true;
    let zMin = "";
    let zMax = "";
    let status = "Load a map to export";

    function mapReady() {
      const world = element?.viewer?.world;
      if (!world) return;
      const layout = planOverview(world);
      generation += 1;
      ready = true;
      busy = false;
      zMin = String(Math.floor(layout.bounds.min[2]));
      zMax = String(Math.ceil(layout.bounds.max[2]));
      status = "Ready to export";
      handle.update();
    }

    function reset() {
      generation += 1;
      ready = false;
      busy = false;
      zMin = "";
      zMax = "";
      status = "Load a map to export";
      handle.update();
    }

    handle.queueTask(() => {
      function attach() {
        if (element) return;
        element = document.querySelector<WorldViewElement>(
          "#viewport world-view",
        );
        if (!element) return;
        element.addEventListener("ready", mapReady, { signal: handle.signal });
        element.addEventListener(
          "error",
          () => {
            if (!element?.viewer?.world) reset();
          },
          { signal: handle.signal },
        );
        if (element.viewer?.world) mapReady();
      }
      window.addEventListener("tea-maps-viewer-element-ready", attach, {
        signal: handle.signal,
      });
      window.addEventListener("tea-maps-viewer-reset", reset, {
        signal: handle.signal,
      });
      attach();
    });

    async function exportOverview() {
      const runtime = element?.viewer;
      if (!runtime?.world || busy) return;
      const minimum = zMin.trim() ? Number(zMin) : NaN;
      const maximum = zMax.trim() ? Number(zMax) : NaN;
      if (
        !Number.isFinite(minimum) ||
        !Number.isFinite(maximum) ||
        minimum > maximum
      ) {
        status = "Lower height must not exceed upper height";
        handle.update();
        return;
      }
      const captureGeneration = generation;
      busy = true;
      status = "Rendering overview";
      handle.update();
      try {
        const [width, height = width] = size.split("x").map(Number);
        const options: OverviewCaptureOptions = {
          width,
          height,
          lighting: lighting === "fullbright" ? "fullbright" : "lightmapped",
          rotation: rotation === "auto" ? "auto" : rotation === "90" ? 90 : 0,
          zMin: minimum,
          zMax: maximum,
          cutaway: cutaway ? "auto" : "none",
          background: transparent ? "transparent" : [0.025, 0.035, 0.03, 1],
        };
        const result = await runtime.captureOverview(options);
        if (generation !== captureGeneration || element?.viewer !== runtime)
          return;
        downloadViewerFile(result.image, `${viewerMapFilename()}-overview.png`);
        status = `${result.layout.width} × ${result.layout.height}, ${result.layout.rotation}°${cutaway && runtime.walkability ? " · cutaway" : ""}`;
      } catch (error) {
        if (generation !== captureGeneration || element?.viewer !== runtime)
          return;
        status = error instanceof Error ? error.message : String(error);
      } finally {
        if (generation === captureGeneration && element?.viewer === runtime) {
          busy = false;
          handle.update();
        }
      }
    }

    return () => (
      <section aria-label="Map overview">
        <h2>Overview</h2>
        <label for="overview-size">Image size</label>
        <select
          id="overview-size"
          value={size}
          mix={on<HTMLSelectElement>("change", (event) => {
            size = event.currentTarget.value;
            handle.update();
          })}
        >
          <option value="512">512 × 512</option>
          <option value="1024">1024 × 1024</option>
          <option value="1024x768">1024 × 768</option>
          <option value="2048">2048 × 2048</option>
        </select>
        <label for="overview-lighting">Lighting</label>
        <select
          id="overview-lighting"
          value={lighting}
          mix={on<HTMLSelectElement>("change", (event) => {
            lighting = event.currentTarget.value;
            handle.update();
          })}
        >
          <option value="lightmapped">Lightmapped</option>
          <option value="fullbright">Fullbright</option>
        </select>
        <label for="overview-rotation">Rotation</label>
        <select
          id="overview-rotation"
          value={rotation}
          mix={on<HTMLSelectElement>("change", (event) => {
            rotation = event.currentTarget.value;
            handle.update();
          })}
        >
          <option value="auto">Auto</option>
          <option value="0">0°</option>
          <option value="90">90°</option>
        </select>
        <label class="toggle" for="overview-cutaway">
          <input
            id="overview-cutaway"
            type="checkbox"
            checked={cutaway}
            mix={on<HTMLInputElement>("change", (event) => {
              cutaway = event.currentTarget.checked;
              handle.update();
            })}
          />
          Auto cutaway with walkability graph
        </label>
        <label for="overview-z-min">Lower height</label>
        <input
          id="overview-z-min"
          type="number"
          step="1"
          value={zMin}
          disabled={!ready}
          mix={on<HTMLInputElement>("input", (event) => {
            zMin = event.currentTarget.value;
            handle.update();
          })}
        />
        <label for="overview-z-max">Upper height</label>
        <input
          id="overview-z-max"
          type="number"
          step="1"
          value={zMax}
          disabled={!ready}
          mix={on<HTMLInputElement>("input", (event) => {
            zMax = event.currentTarget.value;
            handle.update();
          })}
        />
        <label class="toggle" for="overview-transparent">
          <input
            id="overview-transparent"
            type="checkbox"
            checked={transparent}
            mix={on<HTMLInputElement>("change", (event) => {
              transparent = event.currentTarget.checked;
              handle.update();
            })}
          />
          Transparent background
        </label>
        <output id="overview-status" class="hint">
          {status}
        </output>
        <button
          id="download-overview"
          type="button"
          disabled={!ready || busy}
          mix={on("click", () => void exportOverview())}
        >
          Download overview
        </button>
      </section>
    );
  },
);
