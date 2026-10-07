import {
  defineWorldViewElement,
  type WorldViewElement,
} from "@tea/maps-renderer/element";
import type {
  BinarySource,
  CameraState,
  WorldSource,
} from "@tea/maps-renderer";
import { sourceFromFiles, sourceName } from "./world-input.ts";

defineWorldViewElement();

const viewport = document.querySelector<HTMLElement>("#viewport")!;
const shell = document.querySelector<HTMLElement>(".shell")!;
const dropTarget = document.querySelector<HTMLElement>("#drop-target")!;
const status = document.querySelector<HTMLElement>("#viewer-status")!;
const name = document.querySelector<HTMLElement>("#map-name")!;
const viewer = document.createElement("world-view") as WorldViewElement;
viewer.setAttribute("controls", "walk");
viewport.append(viewer);
let initialCamera: CameraState | undefined;
window.dispatchEvent(new Event("tea-maps-viewer-element-ready"));

viewer.addEventListener("progress", (event) => {
  status.textContent = event.detail.label
    ? `Loading ${event.detail.label}`
    : "Loading map";
});
viewer.addEventListener("ready", () => {
  if (initialCamera) viewer.viewer?.setCamera(initialCamera);
  status.textContent =
    "Ready · click the map to look around · V switches walk/fly";
});
viewer.addEventListener("error", (event) => {
  status.textContent = event.detail.error.message;
});

function open(
  source: WorldSource,
  label = sourceName(source),
  options?: {
    readonly camera?: CameraState;
    readonly walkability?: BinarySource;
  },
) {
  name.textContent = label;
  status.textContent = "Loading map";
  initialCamera = options?.camera;
  window.dispatchEvent(new Event("tea-maps-viewer-reset"));
  viewer.source = source;
  viewer.walkabilitySource = options?.walkability ?? null;
}

function replaceQuery(parameters: Record<string, string>) {
  const url = new URL(location.href);
  url.search = new URLSearchParams(parameters).toString();
  history.replaceState(null, "", url);
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
  status.textContent = (event as CustomEvent<string>).detail;
});

async function openLocalFiles(files: Iterable<File>, emptyMessage: string) {
  try {
    const source = await sourceFromFiles(files);
    if (!source) {
      status.textContent = emptyMessage;
      return;
    }
    open(source);
    replaceQuery({});
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

let dragDepth = 0;
shell.addEventListener("dragenter", (event) => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  dragDepth += 1;
  dropTarget.hidden = false;
});
shell.addEventListener("dragover", (event) => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});
shell.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropTarget.hidden = true;
});
shell.addEventListener("drop", (event) => {
  dragDepth = 0;
  dropTarget.hidden = true;
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  void openLocalFiles(
    event.dataTransfer.files,
    "The drop did not include a BSP file",
  );
});
