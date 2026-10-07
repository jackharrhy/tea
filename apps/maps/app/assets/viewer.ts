import {
  defineWorldViewElement,
  type WorldViewElement,
} from "@tea/maps-renderer/element";
import type {
  BinarySource,
  CameraState,
  WorldSource,
} from "@tea/maps-renderer";
import { exampleSource, examples } from "./examples.ts";
import { initHostedViewer } from "./hosted-viewer.ts";
import {
  fixtureCamera,
  loadLocalFixtures,
  type LocalFixture,
} from "./local-fixtures.ts";
import { localMapMetadata } from "./local-map-metadata.ts";
import { initViewerTools } from "./viewer-tools.ts";
import {
  cameraFromUrlParameters,
  sourceFromUrlParameters,
} from "./remote-input.ts";
import {
  localMapPath,
  localMaps,
  sourceFromFiles,
  sourceName,
} from "./world-input.ts";

defineWorldViewElement();

const viewport = document.querySelector<HTMLElement>("#viewport")!;
const shell = document.querySelector<HTMLElement>(".shell")!;
const dropTarget = document.querySelector<HTMLElement>("#drop-target")!;
const status = document.querySelector<HTMLElement>("#viewer-status")!;
const name = document.querySelector<HTMLElement>("#map-name")!;
const filesForm = document.querySelector<HTMLFormElement>("#files-form")!;
const exampleForm = document.querySelector<HTMLFormElement>("#example-form")!;
const exampleInput = document.querySelector<HTMLSelectElement>("#example")!;
const localExamples =
  document.querySelector<HTMLOptGroupElement>("#local-examples")!;
const localFixturesStatus = document.querySelector<HTMLElement>(
  "#local-fixtures-status",
)!;
let localFixtures: LocalFixture[] = [];
const urlForm = document.querySelector<HTMLFormElement>("#url-form")!;
const filesInput = document.querySelector<HTMLInputElement>("#files")!;
const folderForm = document.querySelector<HTMLFormElement>("#folder-form")!;
const folderInput = document.querySelector<HTMLInputElement>("#folder")!;
folderInput.setAttribute("webkitdirectory", "");
const folderMap = document.querySelector<HTMLSelectElement>("#folder-map")!;
const folderOpen = document.querySelector<HTMLButtonElement>("#folder-open")!;
const folderStatus = document.querySelector<HTMLElement>("#folder-status")!;
const bspInput = document.querySelector<HTMLInputElement>("#bsp-url")!;
const gameBaseInput =
  document.querySelector<HTMLInputElement>("#game-base-url")!;
const remoteFields = [
  ["palette", document.querySelector<HTMLInputElement>("#palette-url")!],
  ["wadBase", document.querySelector<HTMLInputElement>("#wad-base-url")!],
  ["skyboxBase", document.querySelector<HTMLInputElement>("#skybox-base-url")!],
  ["spriteBase", document.querySelector<HTMLInputElement>("#sprite-base-url")!],
  ["soundBase", document.querySelector<HTMLInputElement>("#sound-base-url")!],
] as const;
const viewer = document.createElement("world-view") as WorldViewElement;
viewer.setAttribute("controls", "walk");
viewport.append(viewer);
const viewerTools = initViewerTools(viewer);

viewer.addEventListener("progress", (event) => {
  status.textContent = event.detail.label
    ? `Loading ${event.detail.label}`
    : "Loading map";
});
viewer.addEventListener("ready", () => {
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
  viewerTools.reset();
  viewerTools.setInitialCamera(options?.camera);
  viewer.source = source;
  viewer.walkabilitySource = options?.walkability ?? null;
}

function replaceQuery(parameters: Record<string, string>) {
  const url = new URL(location.href);
  url.search = new URLSearchParams(parameters).toString();
  history.replaceState(null, "", url);
}

initHostedViewer(
  (source, label, camera) => open(source, label, { camera }),
  replaceQuery,
);

function openExample(id: string, camera?: CameraState) {
  const local = localFixtures.find(
    (fixture) => fixture.id === id || fixture.aliases.includes(id),
  );
  if (local) {
    exampleInput.value = local.id;
    open(local.source, local.label, {
      camera: camera ?? fixtureCamera(local),
      walkability: local.walkability,
    });
    return;
  }
  const source = exampleSource(id);
  if (!source) {
    status.textContent = `Example ${id} was not found`;
    return;
  }
  const label = examples.find((example) => example.id === id)?.label ?? id;
  exampleInput.value = id;
  open(source, label, { camera });
}

exampleForm.addEventListener("submit", (event) => {
  event.preventDefault();
  openExample(exampleInput.value);
  replaceQuery(
    localFixtures.some((fixture) => fixture.id === exampleInput.value)
      ? { fixture: exampleInput.value }
      : { example: exampleInput.value },
  );
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

filesForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void openLocalFiles(filesInput.files ?? [], "Choose at least one .bsp file");
});

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

folderInput.addEventListener("change", () => {
  const maps = localMaps(folderInput.files ?? []);
  folderMap.replaceChildren(
    ...maps.map((file, index) => new Option(localMapPath(file), String(index))),
  );
  folderMap.disabled = maps.length === 0;
  folderOpen.disabled = maps.length === 0;
  folderStatus.textContent =
    maps.length === 0
      ? "No .bsp maps found in that folder"
      : `${maps.length} map${maps.length === 1 ? "" : "s"} found`;
});

folderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const files = [...(folderInput.files ?? [])];
  const selected = localMaps(files)[Number(folderMap.value)];
  if (!selected) return;
  try {
    const [source, metadata] = await Promise.all([
      sourceFromFiles(files, selected),
      localMapMetadata(files, selected),
    ]);
    if (!source) return;
    open(source, metadata.label, metadata);
    replaceQuery({});
    folderStatus.textContent = `Opened ${localMapPath(selected)}`;
  } catch (error) {
    folderStatus.textContent =
      error instanceof Error ? error.message : String(error);
  }
});

urlForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const parameters = new URLSearchParams();
  parameters.set("bsp", bspInput.value.trim());
  if (gameBaseInput.value.trim())
    parameters.set("gameBase", gameBaseInput.value.trim());
  for (const [key, input] of remoteFields) {
    if (input.value.trim()) parameters.set(key, input.value.trim());
  }
  const source = sourceFromUrlParameters(parameters);
  if (!source) return;
  open(source);
  replaceQuery(Object.fromEntries(parameters));
});

const initial = new URL(location.href);
const localFixturesReady = loadLocalFixtures()
  .then((fixtures) => {
    localFixtures = fixtures;
    localExamples.replaceChildren(
      ...fixtures.map(
        (fixture) =>
          new Option(
            fixture.namespace
              ? `${fixture.namespace} · ${fixture.label}`
              : fixture.label,
            fixture.id,
          ),
      ),
    );
    localExamples.hidden = fixtures.length === 0;
    localFixturesStatus.textContent =
      fixtures.length > 0
        ? `${fixtures.length} local fixture${fixtures.length === 1 ? "" : "s"} available`
        : "";
  })
  .catch((error) => {
    localFixturesStatus.textContent =
      error instanceof Error ? error.message : String(error);
  });
const initialRemoteSource = sourceFromUrlParameters(initial.searchParams);
if (initialRemoteSource) {
  bspInput.value = initial.searchParams.get("bsp") ?? "";
  gameBaseInput.value =
    initial.searchParams.get("gameBase") ??
    initial.searchParams.get("root") ??
    "";
  for (const [key, input] of remoteFields) {
    input.value = initial.searchParams.get(key) ?? "";
  }
  open(initialRemoteSource, undefined, {
    camera: cameraFromUrlParameters(initial.searchParams),
  });
} else if (!initial.searchParams.has("hostedBuild")) {
  void localFixturesReady.then(() => {
    openExample(
      initial.searchParams.get("example") ??
        initial.searchParams.get("fixture") ??
        "goldsrc",
      cameraFromUrlParameters(initial.searchParams),
    );
  });
}
