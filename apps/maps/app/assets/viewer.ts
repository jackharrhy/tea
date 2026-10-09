import { defineWorldViewElement, type WorldViewElement } from "@tea/maps-renderer/element";
import type { BinarySource, CameraState, WorldSource } from "@tea/maps-renderer";
import { sourceName } from "./world-input.ts";

defineWorldViewElement();

const viewer = document.querySelector<WorldViewElement>("#viewport world-view")!;
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
    status: event.detail.label ? `Loading ${event.detail.label}` : "Loading map",
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

const dockScroll = document.querySelector<HTMLElement>(".dock-scroll");
const dockTabs = document.querySelectorAll<HTMLButtonElement>(
  ".dock-tabs button[data-dock-target]",
);
for (const tab of dockTabs) {
  tab.addEventListener("click", () => {
    const target = tab.dataset.dockTarget;
    for (const other of dockTabs) {
      const active = other.dataset.dockTarget === target;
      other.setAttribute("aria-pressed", String(active));
      const section = document.getElementById(other.dataset.dockTarget ?? "");
      if (section instanceof HTMLDetailsElement) section.open = active;
    }
    if (dockScroll) dockScroll.scrollTop = 0;
  });
  document.getElementById(tab.dataset.dockTarget ?? "")?.addEventListener("toggle", (event) => {
    if (!(event.currentTarget instanceof HTMLDetailsElement)) return;
    if (!event.currentTarget.open) return;
    for (const other of dockTabs) other.setAttribute("aria-pressed", String(other === tab));
  });
}
