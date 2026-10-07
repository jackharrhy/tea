import {
  defineWorldViewElement,
  type WorldViewElement,
} from "@tea/maps-renderer/element";
import type {
  BinarySource,
  CameraState,
  WorldSource,
} from "@tea/maps-renderer";
import { sourceName } from "./world-input.ts";

defineWorldViewElement();

const viewport = document.querySelector<HTMLElement>("#viewport")!;
const viewer = document.createElement("world-view") as WorldViewElement;
viewer.setAttribute("controls", "walk");
viewport.append(viewer);
let initialCamera: CameraState | undefined;
window.dispatchEvent(new Event("tea-maps-viewer-element-ready"));

function updateChrome(changes: { name?: string; status?: string }) {
  if (changes.name !== undefined) viewer.dataset.mapName = changes.name;
  if (changes.status !== undefined) viewer.dataset.status = changes.status;
  window.dispatchEvent(
    new CustomEvent("tea-maps-viewer-chrome", {
      detail: {
        name: viewer.dataset.mapName ?? "No map open",
        status: viewer.dataset.status ?? "Choose a map to begin",
      },
    }),
  );
}

viewer.addEventListener("progress", (event) => {
  updateChrome({
    status: event.detail.label
      ? `Loading ${event.detail.label}`
      : "Loading map",
  });
});
viewer.addEventListener("ready", () => {
  if (initialCamera) viewer.viewer?.setCamera(initialCamera);
  updateChrome({
    status: "Ready · click the map to look around · V switches walk/fly",
  });
});
viewer.addEventListener("error", (event) => {
  updateChrome({ status: event.detail.error.message });
});

function open(
  source: WorldSource,
  label = sourceName(source),
  options?: {
    readonly camera?: CameraState;
    readonly walkability?: BinarySource;
  },
) {
  updateChrome({ name: label, status: "Loading map" });
  initialCamera = options?.camera;
  window.dispatchEvent(new Event("tea-maps-viewer-reset"));
  viewer.source = source;
  viewer.walkabilitySource = options?.walkability ?? null;
}

window.addEventListener("tea-maps-open-source", (event) => {
  const detail = (
    event as CustomEvent<{
      source: WorldSource;
      label?: string;
      camera?: CameraState;
      walkability?: BinarySource;
    }>
  ).detail;
  open(detail.source, detail.label, detail);
});

window.addEventListener("tea-maps-viewer-status", (event) => {
  updateChrome({ status: (event as CustomEvent<string>).detail });
});
