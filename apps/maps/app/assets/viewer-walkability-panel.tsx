import type { MapsViewElement } from "@jackharrhy/tea-maps-renderer/element";
import { serializeWalkability } from "@jackharrhy/tea-maps-renderer/walkability";
import { clientEntry, on, type Handle } from "remix/component";
import { downloadViewerFile, viewerMapFilename } from "./viewer-download.ts";

export const ViewerWalkabilityPanel = clientEntry(
  `file:///app/assets/viewer-walkability-panel.tsx#ViewerWalkabilityPanel`,
  function ViewerWalkabilityPanelComponent(handle: Handle) {
    let element: MapsViewElement | null = null;
    let ready = false;
    let busy = false;
    let generation = 0;
    let spacing = "32";
    let probeJumps = true;
    let hasGraph = false;
    let visible = false;
    let details = "No graph loaded";
    let status = "";

    function updateGraph() {
      const runtime = element?.viewer;
      const graph = ready ? runtime?.walkability : null;
      hasGraph = !!graph;
      visible = ready && (element?.walkabilityVisible ?? false);
      details = graph
        ? `${graph.nodes.length.toLocaleString()} nodes · ${graph.edges.length.toLocaleString()} edges`
        : "No graph loaded";
      handle.update();
    }

    function mapReady() {
      if (!element?.viewer?.world) return;
      generation += 1;
      ready = true;
      busy = false;
      status = "";
      updateGraph();
    }

    function reset() {
      generation += 1;
      ready = false;
      busy = false;
      hasGraph = false;
      visible = false;
      details = "No graph loaded";
      status = "";
      handle.update();
    }

    handle.queueTask(() => {
      function attach() {
        if (element) return;
        element = document.querySelector<MapsViewElement>(
          "#viewport tea-map-view",
        );
        if (!element) return;
        element.addEventListener("ready", mapReady, { signal: handle.signal });
        element.addEventListener(
          "walkabilitychange",
          (event) => {
            if (
              event.detail.walkability &&
              status === "Loading walkability sidecar"
            )
              status = "Walkability graph ready";
            updateGraph();
          },
          { signal: handle.signal },
        );
        element.addEventListener(
          "warning",
          (event) => {
            if (
              status === "Loading walkability sidecar" &&
              event.detail.message.startsWith("walkability sidecar")
            ) {
              status = event.detail.message;
              handle.update();
            }
          },
          { signal: handle.signal },
        );
        element.addEventListener(
          "error",
          (event) => {
            if (!element?.viewer?.world) reset();
            else if (busy || status === "Loading walkability sidecar") {
              status = event.detail.error.message;
              handle.update();
            }
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

    async function generateGraph() {
      const runtime = element?.viewer;
      if (!runtime?.world || busy) return;
      const sampleSpacing = spacing.trim() ? Number(spacing) : NaN;
      if (
        !Number.isFinite(sampleSpacing) ||
        sampleSpacing < 8 ||
        sampleSpacing > 128
      ) {
        status = "Spacing must be between 8 and 128";
        handle.update();
        return;
      }
      const currentGeneration = generation;
      busy = true;
      status = "Generating walkability graph";
      handle.update();
      try {
        const graph = await runtime.generateWalkability({
          spacing: sampleSpacing,
          allowJump: probeJumps,
          onProgress(progress) {
            if (
              generation === currentGeneration &&
              element?.viewer === runtime
            ) {
              status = `Sampling ${progress.nodes.toLocaleString()} nodes`;
              handle.update();
            }
          },
        });
        if (generation !== currentGeneration || element?.viewer !== runtime)
          return;
        runtime.setWalkability(graph);
        element.walkabilityVisible = true;
        status = "Walkability graph ready";
        updateGraph();
      } catch (error) {
        if (generation !== currentGeneration || element?.viewer !== runtime)
          return;
        status = error instanceof Error ? error.message : String(error);
      } finally {
        if (generation === currentGeneration && element?.viewer === runtime) {
          busy = false;
          handle.update();
        }
      }
    }

    function downloadGraph() {
      const graph = element?.viewer?.walkability;
      if (!graph) return;
      try {
        downloadViewerFile(
          new Blob([serializeWalkability(graph)], { type: "application/json" }),
          `${viewerMapFilename()}.tea-maps-walkability.json`,
        );
        status = "Walkability sidecar downloaded";
      } catch (error) {
        status = error instanceof Error ? error.message : String(error);
      }
      handle.update();
    }

    return () => (
      <section aria-label="Walkability graph">
        <h2>Walkability</h2>
        <label for="walkability-spacing">Sample spacing</label>
        <input
          id="walkability-spacing"
          type="number"
          min="8"
          max="128"
          step="1"
          value={spacing}
          mix={on<HTMLInputElement>("input", (event) => {
            spacing = event.currentTarget.value;
            handle.update();
          })}
        />
        <label class="toggle" for="walkability-jumps">
          <input
            id="walkability-jumps"
            type="checkbox"
            checked={probeJumps}
            mix={on<HTMLInputElement>("change", (event) => {
              probeJumps = event.currentTarget.checked;
              handle.update();
            })}
          />
          Probe jumps
        </label>
        <button
          id="generate-walkability"
          type="button"
          disabled={!ready || busy}
          mix={on("click", () => void generateGraph())}
        >
          Generate graph
        </button>
        <label class="toggle" for="show-walkability">
          <input
            id="show-walkability"
            type="checkbox"
            checked={visible}
            disabled={!ready || !hasGraph}
            mix={on<HTMLInputElement>("change", (event) => {
              if (element)
                element.walkabilityVisible = event.currentTarget.checked;
              visible =
                element?.walkabilityVisible ?? event.currentTarget.checked;
              handle.update();
            })}
          />
          Show graph
        </label>
        <output id="walkability-details">{details}</output>
        <button
          id="download-walkability"
          type="button"
          disabled={!ready || !hasGraph}
          mix={on("click", downloadGraph)}
        >
          Download sidecar
        </button>
        <label for="walkability-file">Load sidecar</label>
        <input
          id="walkability-file"
          type="file"
          accept=".json,application/json"
          disabled={!ready}
          mix={on<HTMLInputElement>("change", (event) => {
            const file = event.currentTarget.files?.[0];
            if (!file || !element) return;
            element.walkabilitySource = file;
            status = "Loading walkability sidecar";
            handle.update();
          })}
        />
        <button
          id="clear-walkability"
          type="button"
          disabled={!ready || !hasGraph}
          mix={on("click", () => {
            if (!element) return;
            element.walkabilitySource = null;
            element.viewer?.setWalkability(null);
            status = "Walkability graph cleared";
            updateGraph();
          })}
        >
          Clear graph
        </button>
        <output id="walkability-status" role="status">
          {status}
        </output>
      </section>
    );
  },
);
