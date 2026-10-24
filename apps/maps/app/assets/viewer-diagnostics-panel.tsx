import {
  analyzeEntitySupport,
  type EntityClassSupport,
  type MapDiagnostics,
  type WorldviewViewer,
} from "@jackharrhy/tea-maps-renderer";
import type { WorldViewElement } from "@jackharrhy/tea-maps-renderer/element";
import { clientEntry, type Handle } from "remix/component";

function formatMapDetails(
  diagnostics: MapDiagnostics,
  entityCount: number,
): string {
  return [
    `${diagnostics.format.toUpperCase()} ${diagnostics.version}`,
    `${diagnostics.triangles.toLocaleString()} triangles · ${diagnostics.faces.toLocaleString()} faces`,
    `${diagnostics.batches.toLocaleString()} batches · ${diagnostics.materials.toLocaleString()} materials · ${diagnostics.lightmapPages.toLocaleString()} lightmaps`,
    `${diagnostics.sprites.toLocaleString()} sprites · ${diagnostics.loadedSounds.toLocaleString()} ambient / ${diagnostics.loadedMusic.toLocaleString()} music / ${diagnostics.playerSounds.toLocaleString()} player sounds · ${entityCount.toLocaleString()} entities`,
    `Loaded in ${Math.round(diagnostics.loadMilliseconds)} ms`,
  ].join("\n");
}

export const ViewerDiagnosticsPanel = clientEntry(
  `file:///app/assets/viewer-diagnostics-panel.tsx#ViewerDiagnosticsPanel`,
  function ViewerDiagnosticsPanelComponent(handle: Handle) {
    let element: WorldViewElement | null = null;
    let details = "Load a map to inspect it";
    let warningMessages: string[] = [];
    let entityCounts = "Load a map to inspect entities";
    let incompleteClasses: readonly EntityClassSupport[] = [];
    let inspected = false;
    let toolStatus = "";

    function showWorld(
      diagnostics: MapDiagnostics,
      world: NonNullable<WorldviewViewer["world"]>,
    ) {
      details = formatMapDetails(diagnostics, world.entities.length);
      const support = analyzeEntitySupport(world);
      entityCounts =
        `${support.counts.supported.toLocaleString()} supported · ` +
        `${support.counts.partial.toLocaleString()} partial · ` +
        `${support.counts.baked.toLocaleString()} baked · ` +
        `${support.counts.skipped.toLocaleString()} skipped`;
      incompleteClasses = support.classes.filter(
        ({ kind }) => kind === "partial" || kind === "skipped",
      );
      inspected = true;
      warningMessages = [...diagnostics.warnings];
      handle.update();
    }

    function reset() {
      details = "Loading map";
      warningMessages = [];
      entityCounts = "Load a map to inspect entities";
      incompleteClasses = [];
      inspected = false;
      toolStatus = "";
      handle.update();
    }

    handle.queueTask(() => {
      function attach() {
        if (element) return;
        element = document.querySelector<WorldViewElement>(
          "#viewport world-view",
        );
        if (!element) return;
        element.addEventListener(
          "ready",
          (event) => showWorld(event.detail.diagnostics, event.detail.world),
          { signal: handle.signal },
        );
        element.addEventListener(
          "warning",
          (event) => {
            warningMessages.push(event.detail.message);
            if (event.detail.code === "asset-warning")
              toolStatus = event.detail.message;
            handle.update();
          },
          { signal: handle.signal },
        );
        element.addEventListener(
          "error",
          (event) => {
            if (!element?.viewer?.world)
              window.dispatchEvent(new Event("tea-maps-viewer-reset"));
            toolStatus = event.detail.error.message;
            handle.update();
          },
          { signal: handle.signal },
        );
        const runtime = element.viewer;
        if (runtime?.world && runtime.diagnostics)
          showWorld(runtime.diagnostics, runtime.world);
      }
      window.addEventListener("tea-maps-viewer-element-ready", attach, {
        signal: handle.signal,
      });
      window.addEventListener("tea-maps-viewer-reset", reset, {
        signal: handle.signal,
      });
      attach();
    });

    return () => (
      <div class="viewer-diagnostics">
        <section aria-label="Map details">
          <h2>Map details</h2>
          <output id="map-details">{details}</output>
          <output id="map-warnings" class="hint">
            {warningMessages.slice(-5).join("\n")}
          </output>
        </section>
        <section aria-label="Entity support">
          <details class="entity-support">
            <summary>Entity support</summary>
            <output id="entity-counts">{entityCounts}</output>
            <ul id="entity-classes">
              {!inspected ? null : incompleteClasses.length === 0 ? (
                <li>No partial or skipped entity classes</li>
              ) : (
                incompleteClasses.map(({ classname, count, kind, reason }) => (
                  <li>{`${classname} × ${count} (${kind}): ${reason}`}</li>
                ))
              )}
            </ul>
          </details>
        </section>
        <output id="map-tool-status" role="status">
          {toolStatus}
        </output>
      </div>
    );
  },
);
