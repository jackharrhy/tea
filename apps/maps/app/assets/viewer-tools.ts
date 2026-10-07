import {
  analyzeEntitySupport,
  type CameraState,
  type MapDiagnostics,
} from "@tea/maps-renderer";
import type { WorldViewElement } from "@tea/maps-renderer/element";

export function formatMapDetails(
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

export function initViewerTools(element: WorldViewElement): {
  reset(): void;
  setInitialCamera(camera: CameraState | undefined): void;
} {
  const details = document.querySelector<HTMLOutputElement>("#map-details")!;
  const warnings = document.querySelector<HTMLOutputElement>("#map-warnings")!;
  const entityCounts =
    document.querySelector<HTMLOutputElement>("#entity-counts")!;
  const entityClasses =
    document.querySelector<HTMLUListElement>("#entity-classes")!;
  const toolStatus =
    document.querySelector<HTMLOutputElement>("#map-tool-status")!;
  let initialCamera: CameraState | undefined;
  let warningMessages: string[] = [];

  function report(error: unknown) {
    toolStatus.textContent =
      error instanceof Error ? error.message : String(error);
  }

  function reset() {
    initialCamera = undefined;
    warningMessages = [];
    details.textContent = "Loading map";
    warnings.textContent = "";
    entityCounts.textContent = "Load a map to inspect entities";
    entityClasses.replaceChildren();
    toolStatus.textContent = "";
    window.dispatchEvent(new Event("tea-maps-viewer-reset"));
  }

  element.addEventListener("ready", (event) => {
    const runtime = element.viewer;
    if (!runtime) return;
    if (initialCamera) runtime.setCamera(initialCamera);
    details.textContent = formatMapDetails(
      event.detail.diagnostics,
      event.detail.world.entities.length,
    );
    const support = analyzeEntitySupport(event.detail.world);
    entityCounts.textContent =
      `${support.counts.supported.toLocaleString()} supported · ` +
      `${support.counts.partial.toLocaleString()} partial · ` +
      `${support.counts.baked.toLocaleString()} baked · ` +
      `${support.counts.skipped.toLocaleString()} skipped`;
    const incomplete = support.classes.filter(
      ({ kind }) => kind === "partial" || kind === "skipped",
    );
    entityClasses.replaceChildren(
      ...incomplete.map(({ classname, count, kind, reason }) => {
        const item = document.createElement("li");
        item.textContent = `${classname} × ${count} (${kind}): ${reason}`;
        return item;
      }),
    );
    if (incomplete.length === 0) {
      const item = document.createElement("li");
      item.textContent = "No partial or skipped entity classes";
      entityClasses.append(item);
    }
    warningMessages = [...event.detail.diagnostics.warnings];
    warnings.textContent = warningMessages.slice(0, 5).join("\n");
  });
  element.addEventListener("warning", (event) => {
    warningMessages.push(event.detail.message);
    warnings.textContent = warningMessages.slice(-5).join("\n");
    if (event.detail.code === "asset-warning")
      toolStatus.textContent = event.detail.message;
  });
  element.addEventListener("error", (event) => {
    if (!element.viewer?.world) reset();
    report(event.detail.error);
  });

  return {
    reset,
    setInitialCamera(camera) {
      initialCamera = camera;
    },
  };
}
