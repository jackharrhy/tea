import type { WorldViewElement } from "@tea/maps-renderer/element";
import { clientEntry, type Handle } from "remix/component";
import { sourceFromFiles } from "./world-input.ts";

type ChromeState = { name: string; status: string };

async function openLocalFiles(files: Iterable<File>) {
  try {
    const source = await sourceFromFiles(files);
    if (!source) {
      window.dispatchEvent(
        new CustomEvent("tea-maps-viewer-status", {
          detail: "The drop did not include a BSP file",
        }),
      );
      return;
    }
    window.dispatchEvent(
      new CustomEvent("tea-maps-open-source", { detail: { source } }),
    );
    const url = new URL(location.href);
    url.search = "";
    history.replaceState(null, "", url);
  } catch (error) {
    window.dispatchEvent(
      new CustomEvent("tea-maps-viewer-status", {
        detail: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

export const ViewerToolbar = clientEntry(
  `${import.meta.url}#ViewerToolbar`,
  function ViewerToolbarComponent(handle: Handle) {
    let name = "No map open";
    let status = "Choose a map to begin";

    handle.queueTask(() => {
      function syncFromViewer() {
        const viewer = document.querySelector<WorldViewElement>(
          "#viewport world-view",
        );
        if (!viewer) return;
        name = viewer.dataset.mapName ?? name;
        status = viewer.dataset.status ?? status;
        handle.update();
      }
      window.addEventListener(
        "tea-maps-viewer-chrome",
        (event) => {
          const next = (event as CustomEvent<ChromeState>).detail;
          name = next.name;
          status = next.status;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.addEventListener("tea-maps-viewer-element-ready", syncFromViewer, {
        signal: handle.signal,
      });
      syncFromViewer();
    });

    return () => (
      <div class="toolbar">
        <strong id="map-name">{name}</strong>
        <span id="viewer-status" role="status">
          {status}
        </span>
      </div>
    );
  },
);

export const ViewerDropTarget = clientEntry(
  `${import.meta.url}#ViewerDropTarget`,
  function ViewerDropTargetComponent(handle: Handle) {
    let dragDepth = 0;
    let active = false;

    handle.queueTask(() => {
      const shell = document.querySelector<HTMLElement>(".shell");
      if (!shell) return;
      shell.addEventListener(
        "dragenter",
        (event) => {
          if (!event.dataTransfer?.types.includes("Files")) return;
          event.preventDefault();
          dragDepth += 1;
          active = true;
          handle.update();
        },
        { signal: handle.signal },
      );
      shell.addEventListener(
        "dragover",
        (event) => {
          if (!event.dataTransfer?.types.includes("Files")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        },
        { signal: handle.signal },
      );
      shell.addEventListener(
        "dragleave",
        () => {
          dragDepth = Math.max(0, dragDepth - 1);
          if (dragDepth === 0) {
            active = false;
            handle.update();
          }
        },
        { signal: handle.signal },
      );
      shell.addEventListener(
        "drop",
        (event) => {
          dragDepth = 0;
          active = false;
          handle.update();
          if (!event.dataTransfer?.types.includes("Files")) return;
          event.preventDefault();
          void openLocalFiles(event.dataTransfer.files);
        },
        { signal: handle.signal },
      );
    });

    return () => (
      <div id="drop-target" class="drop-target" role="status" hidden={!active}>
        Drop a BSP with its map assets
      </div>
    );
  },
);
