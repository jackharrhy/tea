import {
  applyCollaborationOperation,
  COLLABORATION_SCHEMA_VERSION,
  createBoxBrush,
  createConvexHullBrush,
  createEmptyDocument,
  createSequentialIdFactory,
  createStarterDocument,
  decodeSurfaceFlags,
  developmentTexturePack,
  deriveBrush,
  deriveEditorGroups,
  deriveEditorLayers,
  EditorSession,
  findBrush,
  gameProfileSupportsFaceSyntax,
  isWorldviewGameProfile,
  mapSourceFingerprint,
  parseMapSource,
  planMapSave,
  pointEntityDefinition,
  pointEntityBounds,
  pointEntitiesInDocument,
  selectedBrushIds,
  selectedFaceReferences,
  selectedEditorGroup,
  selectedPointEntityIds,
  selectionForEditorGroup,
  serializeMap,
  rebaseMapSource,
  worldviewGameProfile,
  type EntityId,
  type EditorMaterial,
  type Bounds,
  type BrushBatchClipCandidate,
  type BrushClipCandidate,
  type BrushClipMode,
  type BrushCreationCandidate,
  type FaceTextureAlignmentOperation,
  type FaceTextureAlignmentOptions,
  type FaceTextureProjectionField,
  type MapDocument,
  type MapFace,
  type MapSourceState,
  type SurfaceFlagDefinition,
  type TransformAxis,
  type WorldviewGameProfile,
  type Vec3,
} from "@tea/maps-editor/core";
import {
  EditorSourceRenderer,
  type EditorBrushDragEvent,
  type EditorClipPlaneEvent,
  type EditorHullCreateEvent,
  type EditorPickIntent,
  type EditorPointerPositionEvent,
  type EditorPointEntityPlaceEvent,
  type EditorRemotePresenceOverlay,
  type EditorViewportContextMenuEvent,
} from "@tea/maps-editor/render";
import {
  defineWorldViewElement,
  type WorldViewElement,
} from "@tea/maps-renderer/element";
import type { WorldSource } from "@tea/maps-renderer";
import type {
  CollaborationPresence,
  HostedMapLaunch,
} from "@tea/maps-protocol";
import {
  createEditorCheckpoint,
  latestEditorVersion,
  listEditorVersions,
  loadEditorDraft,
  saveEditorDraft,
  setEditorVersionProtected,
  type EditorDraft,
  type EditorVersion,
} from "./editor-draft.ts";
import { initHostedEditor } from "./editor-hosted.ts";
import { listHostedResources } from "./editor-hosted-resources.ts";
import { loadHostedWorldSource } from "./hosted-world-source.ts";
import {
  loadHostedEditorResources,
  type HostedEditorResources,
} from "./editor-hosted-resource-loader.ts";
import {
  createHostedCheckpoint,
  listHostedCheckpoints,
  readHostedCheckpointSource,
} from "./editor-hosted-checkpoints.ts";
import { createFaceDragController } from "./editor-face-drag.ts";
import { createEditorSweep } from "./editor-sweep.ts";
import { initEditorReferences } from "./editor-references.ts";
import { renderEntityProperties } from "./editor-entity-properties.ts";
import { initEditorFov } from "./editor-fov.ts";
import { initEditorWorkspace } from "./editor-workspace.ts";
import { initEditorMaterialBrowser } from "./editor-material-browser.ts";
import { createTextureUvEditor } from "./editor-uv.ts";
import { initSourceComparison } from "./editor-source-compare.ts";
import { initProjectSyncDialog } from "./editor-project-sync-dialog.ts";
import { initProjectMapSelector } from "./editor-project-map-selector.ts";
import { initEditorPerformance } from "./editor-performance.ts";
import { initHostedPresence } from "./editor-hosted-presence.ts";
import {
  hostedBuildArtifactPath,
  initHostedBuilds,
} from "./editor-hosted-builds.ts";
import { createEditorTopology } from "./editor-topology.ts";
import { createEditorShapes } from "./editor-shapes.ts";
import { createEditorTransform } from "./editor-transform.ts";
import { createIssueBrowser } from "./editor-issues.ts";
import { createEditorVisibility } from "./editor-visibility.ts";
import { handleFaceTransfer } from "./editor-face-transfer.ts";
import {
  IndexedDbCollaborationOutbox,
  type DetachedHostedMap,
} from "./editor-collaboration.ts";
import {
  connectHostedEditor,
  type HostedEditorConnection,
} from "./editor-hosted-collaboration.ts";
import {
  downloadMapCopy,
  pickMapFile,
  pickMapSaveFile,
  supportsMapOpenPicker,
  supportsMapSavePicker,
  writeMapFile,
  type MapFileHandle,
} from "./editor-files.ts";
import {
  openMapProject,
  pickProjectDirectory,
  supportsProjectPicker,
  type MapDirectoryHandle,
  type MapProject,
} from "./editor-project.ts";
import {
  listRecentProjects,
  recentProject,
  rememberRecentProject,
  rememberRecentProjectMap,
} from "./editor-recent-projects.ts";
import {
  openProjectBuildBindings,
  type ProjectBuildBindings,
} from "./editor-project-build-bindings.ts";
import { initHostedSourceDialog } from "./editor-hosted-source-dialog.ts";
import { createEditorClipboard } from "./editor-clipboard.ts";
import {
  createEditorContextMenu,
  type ContextAction,
  type ContextSection,
} from "./editor-context-menu.ts";
import { buildMap, downloadBsp } from "./editor-build.ts";
import {
  downloadBuildFile,
  packageBuildExport,
  prepareBuildExport,
  previewSourceWithExportAssets,
  type BuildExportInput,
} from "./editor-build-export.ts";
import {
  defaultExportSettings,
  directoryExportSupported,
  loadExportSettings,
  pickExportDirectory,
  saveExportSettings,
  writeBuildExport,
  type ExportSettings,
} from "./editor-export-settings.ts";

const status = document.querySelector<HTMLElement>("#editor-status")!;
const performanceDiagnostics = initEditorPerformance();
const hostedPresence = initHostedPresence((message) => {
  status.textContent = message;
});
const source = document.querySelector<HTMLTextAreaElement>("#map-source")!;
const selectionInfo = document.querySelector<HTMLElement>("#selection-info")!;
const pointInspector = document.querySelector<HTMLElement>(
  "#point-entity-inspector",
)!;
const pointClassname = document.querySelector<HTMLInputElement>(
  "#selected-point-classname",
)!;
const pointOrigin = document.querySelector<HTMLInputElement>(
  "#selected-point-origin",
)!;
const updatePointButton = document.querySelector<HTMLButtonElement>(
  "#update-point-entity",
)!;
const entityProperties =
  document.querySelector<HTMLElement>("#entity-properties")!;
const propertyList = document.querySelector<HTMLElement>(
  "#entity-property-list",
)!;
const propertyKey = document.querySelector<HTMLInputElement>(
  "#entity-property-key",
)!;
const propertyValue = document.querySelector<HTMLInputElement>(
  "#entity-property-value",
)!;
const savePropertyButton = document.querySelector<HTMLButtonElement>(
  "#save-entity-property",
)!;
const removePropertyButton = document.querySelector<HTMLButtonElement>(
  "#remove-entity-property",
)!;
const deleteButton =
  document.querySelector<HTMLButtonElement>("#delete-selection")!;
const duplicateButton = document.querySelector<HTMLButtonElement>(
  "#duplicate-selection",
)!;
const hideSelectionButton =
  document.querySelector<HTMLButtonElement>("#hide-selection")!;
const isolateSelectionButton =
  document.querySelector<HTMLButtonElement>("#isolate-selection")!;
const showAllButton = document.querySelector<HTMLButtonElement>("#show-all")!;
const focusSelectionButton =
  document.querySelector<HTMLButtonElement>("#focus-selection")!;
const lockSelectionButton =
  document.querySelector<HTMLButtonElement>("#lock-selection")!;
const unlockAllButton =
  document.querySelector<HTMLButtonElement>("#unlock-all")!;
const repeatCommandsButton =
  document.querySelector<HTMLButtonElement>("#repeat-commands")!;
const clearRepeatCommandsButton = document.querySelector<HTMLButtonElement>(
  "#clear-repeat-commands",
)!;
const nudgeButtons =
  document.querySelectorAll<HTMLButtonElement>("[data-nudge-axis]");
const snapToGridButton =
  document.querySelector<HTMLButtonElement>("#snap-to-grid")!;
const copySelectionButton =
  document.querySelector<HTMLButtonElement>("#copy-selection")!;
const pasteCursorButton =
  document.querySelector<HTMLButtonElement>("#paste-cursor")!;
const pasteOriginalButton =
  document.querySelector<HTMLButtonElement>("#paste-original")!;
const gridSizeInput = document.querySelector<HTMLSelectElement>("#grid-size")!;
const textureLockInput =
  document.querySelector<HTMLInputElement>("#texture-lock")!;
const makeEntityButton =
  document.querySelector<HTMLButtonElement>("#make-brush-entity")!;
const makeStructuralButton =
  document.querySelector<HTMLButtonElement>("#make-structural")!;
const moveButton =
  document.querySelector<HTMLButtonElement>("#move-selection")!;
const rotateButton =
  document.querySelector<HTMLButtonElement>("#rotate-selection")!;
const scaleButton =
  document.querySelector<HTMLButtonElement>("#scale-selection")!;
const shearButton =
  document.querySelector<HTMLButtonElement>("#shear-selection")!;
const shearSourceAxis =
  document.querySelector<HTMLSelectElement>("#shear-source-axis")!;
const shearTargetAxis =
  document.querySelector<HTMLSelectElement>("#shear-target-axis")!;
const shearOffset = document.querySelector<HTMLInputElement>("#shear-offset")!;
const flipButtons = (["x", "y", "z"] as const).map((axis) =>
  document.querySelector<HTMLButtonElement>(`#flip-${axis}`)!,
);
const csgButtons = {
  merge: document.querySelector<HTMLButtonElement>("#csg-merge")!,
  intersect: document.querySelector<HTMLButtonElement>("#csg-intersect")!,
  subtract: document.querySelector<HTMLButtonElement>("#csg-subtract")!,
  hollow: document.querySelector<HTMLButtonElement>("#csg-hollow")!,
};
const csgThickness =
  document.querySelector<HTMLInputElement>("#csg-thickness")!;
const groupName = document.querySelector<HTMLInputElement>("#group-name")!;
const groupButtons = {
  create: document.querySelector<HTMLButtonElement>("#group-selection")!,
  rename: document.querySelector<HTMLButtonElement>("#rename-group")!,
  open: document.querySelector<HTMLButtonElement>("#open-group")!,
  close: document.querySelector<HTMLButtonElement>("#close-group")!,
  linked: document.querySelector<HTMLButtonElement>("#linked-duplicate-group")!,
  unlink: document.querySelector<HTMLButtonElement>("#unlink-group")!,
  ungroup: document.querySelector<HTMLButtonElement>("#ungroup-selection")!,
};
const layerSelect = document.querySelector<HTMLSelectElement>("#layer-select")!;
const layerName = document.querySelector<HTMLInputElement>("#layer-name")!;
const newLayerName =
  document.querySelector<HTMLInputElement>("#new-layer-name")!;
const layerCount = document.querySelector<HTMLElement>("#layer-count")!;
const layerButtons = {
  create: document.querySelector<HTMLButtonElement>("#create-layer")!,
  rename: document.querySelector<HTMLButtonElement>("#rename-layer")!,
  activate: document.querySelector<HTMLButtonElement>("#activate-layer")!,
  move: document.querySelector<HTMLButtonElement>("#move-to-layer")!,
  select: document.querySelector<HTMLButtonElement>("#select-layer-contents")!,
  isolate: document.querySelector<HTMLButtonElement>("#isolate-layer")!,
  remove: document.querySelector<HTMLButtonElement>("#remove-layer")!,
  up: document.querySelector<HTMLButtonElement>("#layer-up")!,
  down: document.querySelector<HTMLButtonElement>("#layer-down")!,
  showAll: document.querySelector<HTMLButtonElement>("#show-all-layers")!,
  hideAll: document.querySelector<HTMLButtonElement>("#hide-all-layers")!,
  unlockAll: document.querySelector<HTMLButtonElement>("#unlock-all-layers")!,
  lockAll: document.querySelector<HTMLButtonElement>("#lock-all-layers")!,
};
const layerFlags = {
  hidden: document.querySelector<HTMLInputElement>("#layer-hidden")!,
  locked: document.querySelector<HTMLInputElement>("#layer-locked")!,
  "omit-from-export": document.querySelector<HTMLInputElement>("#layer-omit")!,
};
const undoButton = document.querySelector<HTMLButtonElement>("#undo")!;
const redoButton = document.querySelector<HTMLButtonElement>("#redo")!;
const fileInput = document.querySelector<HTMLInputElement>("#open-map")!;
const projectMaps = document.querySelector<HTMLSelectElement>("#project-maps")!;
const recentProjects =
  document.querySelector<HTMLDetailsElement>("#recent-projects")!;
const recentProjectList = document.querySelector<HTMLElement>(
  "#recent-project-list",
)!;
const buildProfile =
  document.querySelector<HTMLSelectElement>("#build-profile")!;
const gameProfile = document.querySelector<HTMLSelectElement>("#game-profile")!;
const buildButton = document.querySelector<HTMLButtonElement>("#build-map")!;
const exportBuildButton =
  document.querySelector<HTMLButtonElement>("#export-build")!;
const exportStatus = document.querySelector<HTMLElement>("#export-status")!;
const includeBuildSource = document.querySelector<HTMLInputElement>(
  "#include-build-source",
)!;
const exportAfterBuild = document.querySelector<HTMLInputElement>(
  "#export-after-build",
)!;
const exportDestination = document.querySelector<HTMLElement>(
  "#export-destination",
)!;
const chooseExportDirectory = document.querySelector<HTMLButtonElement>(
  "#choose-export-directory",
)!;
const useExportDownloads = document.querySelector<HTMLButtonElement>(
  "#use-export-downloads",
)!;
const toggleCompiledButton =
  document.querySelector<HTMLButtonElement>("#toggle-compiled")!;
const buildStatus = document.querySelector<HTMLElement>("#build-status")!;
const buildDetails =
  document.querySelector<HTMLDetailsElement>("#build-details")!;
const buildOutput = document.querySelector<HTMLElement>("#build-output")!;
const perspectiveLabel =
  document.querySelector<HTMLElement>("#perspective-label")!;
const projectResourceInfo = document.querySelector<HTMLElement>(
  "#project-resource-info",
)!;
const projectResourceDiagnostics = document.querySelector<HTMLDetailsElement>(
  "#project-resource-diagnostics",
)!;
const projectResourceMessages = document.querySelector<HTMLUListElement>(
  "#project-resource-messages",
)!;
const materialChoices =
  document.querySelector<HTMLDataListElement>("#material-choices")!;
const boxMaterial = document.querySelector<HTMLInputElement>("#box-material")!;
const viewportTool =
  document.querySelector<HTMLSelectElement>("#viewport-tool")!;
const clipTools = document.querySelector<HTMLElement>("#clip-tools")!;
const clipPointsLabel = document.querySelector<HTMLElement>("#clip-points")!;
const applyClipButton =
  document.querySelector<HTMLButtonElement>("#apply-clip")!;
const resetClipButton =
  document.querySelector<HTMLButtonElement>("#reset-clip")!;
const clipModeButtons: Readonly<Record<BrushClipMode, HTMLButtonElement>> = {
  back: document.querySelector<HTMLButtonElement>("#clip-back")!,
  split: document.querySelector<HTMLButtonElement>("#clip-split")!,
  front: document.querySelector<HTMLButtonElement>("#clip-front")!,
};
const hullTools = document.querySelector<HTMLElement>("#hull-tools")!;
const hullPointsLabel = document.querySelector<HTMLElement>("#hull-points")!;
const createHullButton =
  document.querySelector<HTMLButtonElement>("#create-hull")!;
const discardHullButton =
  document.querySelector<HTMLButtonElement>("#discard-hull")!;
const pointEntityClassname = document.querySelector<HTMLInputElement>(
  "#point-entity-classname",
)!;
const faceInspector = document.querySelector<HTMLElement>("#face-inspector")!;
const faceSummary = document.querySelector<HTMLElement>(
  "#face-inspector-summary",
)!;
const faceProjection = document.querySelector<HTMLElement>("#face-projection")!;
const faceGeometry = document.querySelector<HTMLElement>("#face-geometry")!;
const faceDistance =
  document.querySelector<HTMLInputElement>("#face-distance")!;
const faceGeometryButtons = {
  extrude: document.querySelector<HTMLButtonElement>("#extrude-face")!,
  split: document.querySelector<HTMLButtonElement>("#split-face")!,
  stamp: document.querySelector<HTMLButtonElement>("#stamp-face")!,
};
const selectedFace =
  document.querySelector<HTMLSelectElement>("#selected-face")!;
const selectedMaterial =
  document.querySelector<HTMLInputElement>("#selected-material")!;
const applyMaterialButton =
  document.querySelector<HTMLButtonElement>("#apply-material")!;
const projectionInputs: Readonly<
  Record<FaceTextureProjectionField, HTMLInputElement>
> = {
  "offset-u": document.querySelector<HTMLInputElement>("#texture-offset-u")!,
  "offset-v": document.querySelector<HTMLInputElement>("#texture-offset-v")!,
  "scale-u": document.querySelector<HTMLInputElement>("#texture-scale-u")!,
  "scale-v": document.querySelector<HTMLInputElement>("#texture-scale-v")!,
  rotation: document.querySelector<HTMLInputElement>("#texture-rotation")!,
};
const alignmentOperation = document.querySelector<HTMLSelectElement>(
  "#texture-alignment-operation",
)!;
const textureWidth =
  document.querySelector<HTMLInputElement>("#texture-width")!;
const textureHeight =
  document.querySelector<HTMLInputElement>("#texture-height")!;
const alignmentReverse = document.querySelector<HTMLInputElement>(
  "#texture-align-reverse",
)!;
const alignmentSubdivide = document.querySelector<HTMLInputElement>(
  "#texture-align-subdivide",
)!;
const alignmentButton = document.querySelector<HTMLButtonElement>(
  "#apply-texture-alignment",
)!;
const surfaceAttributes = document.querySelector<HTMLDetailsElement>(
  "#surface-attributes",
)!;
const surfaceContents =
  document.querySelector<HTMLElement>("#surface-contents")!;
const surfaceFlags = document.querySelector<HTMLElement>("#surface-flags")!;
const unknownContents = document.querySelector<HTMLElement>(
  "#surface-unknown-contents",
)!;
const unknownFlags = document.querySelector<HTMLElement>(
  "#surface-unknown-flags",
)!;
const surfaceValue =
  document.querySelector<HTMLInputElement>("#surface-value")!;
const surfaceValueLabel = document.querySelector<HTMLLabelElement>(
  "#surface-value-label",
)!;
const pointEntityClasses = document.querySelector<HTMLDataListElement>(
  "#point-entity-classes",
)!;
const brushEntityClasses = document.querySelector<HTMLDataListElement>(
  "#brush-entity-classes",
)!;
const switchMapDialog =
  document.querySelector<HTMLDialogElement>("#switch-map-dialog")!;
const versionsDialog =
  document.querySelector<HTMLDialogElement>("#versions-dialog")!;
const versionsList = document.querySelector<HTMLElement>("#versions-list")!;
const versionsStatus = document.querySelector<HTMLElement>("#versions-status")!;
const checkpointLabel =
  document.querySelector<HTMLInputElement>("#checkpoint-label")!;
const checkpointButton =
  document.querySelector<HTMLButtonElement>("#create-checkpoint")!;
const canvases = {
  perspective: document.querySelector<HTMLCanvasElement>("#perspective")!,
  xy: document.querySelector<HTMLCanvasElement>("#xy")!,
  xz: document.querySelector<HTMLCanvasElement>("#xz")!,
  yz: document.querySelector<HTMLCanvasElement>("#yz")!,
};

let session = new EditorSession(createEmptyDocument());
let openGroupId: string | null = null;
let selectedLayerId: string | null = null;
let renderer: EditorSourceRenderer | null = null;
const references = initEditorReferences({
  document: () => session.document,
  renderer: () => renderer,
  status: (message) => {
    status.textContent = message;
  },
});
const fov = initEditorFov({
  renderer: () => renderer,
  status: (message) => {
    status.textContent = message;
  },
});
let rendererFailure: string | null = null;
let rendererViewState = session.objectViewState;
let clipMode: BrushClipMode = "back";
let clipPoints: readonly Vec3[] = [];
let clipPlanePoints: readonly [Vec3, Vec3, Vec3] | null = null;
let clipCandidate: BrushClipCandidate | BrushBatchClipCandidate | null = null;
let hullCandidate: BrushCreationCandidate | null = null;
let hullPointCount = 0;
let hullPrefix: string | null = null;
let framePending = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveQueue = Promise.resolve();
let openedFile: MapFileHandle | null = null;
let openedFingerprint: string | null = null;
let mapName = "tea-map.map";
let documentId: string = crypto.randomUUID();
let projectRecoveryScope: string = crypto.randomUUID();
let project: MapProject | null = null;
let hostedResources: HostedEditorResources | null = null;
let hostedResourceGeneration = 0;
let hostedResourceAbort: AbortController | null = null;
let localGame: WorldviewGameProfile = "quake";
let projectBindings: ProjectBuildBindings | null = null;
let exportSettings = defaultExportSettings("default");
let exportSettingsGeneration = 0;
let exportSettingsSave = Promise.resolve();
let exportBusy = false;
let compiledPreview: WorldViewElement | null = null;
let compiledDocument: MapDocument | null = null;
let compiledSourceText: string | null = null;
let compiledVisible = false;
let buildGeneration = 0;
let hostedBuildBusy = false;
let latestBuildExport: {
  readonly input: BuildExportInput;
  readonly document: MapDocument;
  readonly sourceText: string;
  readonly project: MapProject | null;
  readonly name: string;
  readonly game: WorldviewGameProfile;
} | null = null;
let activeProjectPath: string | null = null;
let activeRecentProjectId: string | null = null;
let hostedMap: HostedMapLaunch | null = null;
let hostedConnection: HostedEditorConnection | null = null;
let hostedGeneration = 0;
let remoteParticipants: readonly CollaborationPresence[] = [];
let hostedControls: ReturnType<typeof initHostedEditor> | null = null;
let hostedBuildControls: ReturnType<typeof initHostedBuilds> | null = null;
let projectSyncControls: ReturnType<typeof initProjectSyncDialog> | null = null;
const projectMapSelector = initProjectMapSelector({
  openMap(path) {
    projectMaps.value = path;
    projectMaps.dispatchEvent(new Event("change"));
  },
  openSync() {
    document.querySelector<HTMLButtonElement>("#project-sync-open")!.click();
  },
});
let hostedSourceControls: ReturnType<typeof initHostedSourceDialog> | null =
  null;
let inspectedEntityId: EntityId | null = null;
let inspectedTextureSelection: string | null = null;
let dragDuplicateBase: ReturnType<
  EditorSession["createObjectDuplicationCandidate"]
> = null;
const emptySource = serializeMap(createEmptyDocument());
let savedSource = emptySource;
let mapSourceState = rebaseMapSource(session.document, emptySource);
const sourceSaveWarning = document.querySelector<HTMLElement>(
  "#source-save-warning",
)!;
let latestPointer: EditorPointerPositionEvent | null = null;
let uvPreviewCandidate: ReturnType<
  EditorSession["createTextureTransformDeltaCandidate"]
> = null;
const uvEditorAbort = new AbortController();
const uvStatus = document.querySelector<HTMLElement>("#uv-editor-status")!;
const uvFrame = document.querySelector<HTMLButtonElement>("#uv-frame")!;
const uvResetPivot =
  document.querySelector<HTMLButtonElement>("#uv-reset-pivot")!;
const uvEditor = createTextureUvEditor({
  svg: document.querySelector<SVGSVGElement>("#uv-editor")!,
  signal: uvEditorAbort.signal,
  onStatus: (message) => {
    uvStatus.textContent = message;
  },
  onAnnounce: (message) => {
    status.textContent = message;
  },
  onTransform: (event) => {
    if (event.phase === "cancel") {
      uvPreviewCandidate = null;
      renderer?.setDocument(
        session.document,
        session.selection,
        rendererViewState,
      );
      status.textContent = "UV transform cancelled";
      return;
    }
    if (!viewportCanEdit()) return;
    try {
      const candidate = session.createTextureTransformDeltaCandidate(
        event.transform,
        event.selection,
        event.pivot,
      );
      if (!candidate) return;
      if (event.phase === "preview") {
        uvPreviewCandidate = candidate;
        const brushIds =
          "edits" in candidate
            ? candidate.edits.map((edit) => edit.brushId)
            : [candidate.brushId];
        renderer?.setPreviewDocument(
          candidate.document,
          session.selection,
          brushIds,
        );
        status.textContent = `${candidate.label} preview · release to commit`;
      } else {
        session.commitCandidate(uvPreviewCandidate ?? candidate);
        uvPreviewCandidate = null;
      }
    } catch (error) {
      uvPreviewCandidate = null;
      renderer?.setDocument(
        session.document,
        session.selection,
        rendererViewState,
      );
      status.textContent =
        error instanceof Error ? error.message : String(error);
    }
  },
});
uvFrame.addEventListener("click", () => uvEditor.frameSelection());
uvResetPivot.addEventListener("click", () => uvEditor.resetPivot());
for (const [axis, id] of [
  [0, "#uv-grid-x"],
  [1, "#uv-grid-y"],
] as const) {
  const input = document.querySelector<HTMLInputElement>(id)!;
  input.addEventListener("change", () => {
    uvEditor.setGridSubdivisions(axis, input.valueAsNumber);
    input.value = String(uvEditor.getGridSubdivisions()[axis]);
  });
}
const standaloneMaterials = new Map<
  WorldviewGameProfile,
  readonly EditorMaterial[]
>();
function currentMaterials(): readonly EditorMaterial[] {
  if (project) return project.materials;
  if (hostedResources) return hostedResources.materials;
  const game = activeGame();
  let materials = standaloneMaterials.get(game);
  if (!materials) {
    materials = developmentTexturePack(game)?.materials ?? [];
    standaloneMaterials.set(game, materials);
  }
  return materials;
}
function currentDefinitions() {
  return project?.definitions ?? hostedResources?.definitions;
}
const materialBrowser = initEditorMaterialBrowser({
  session: () => session,
  prepare: () => {
    if (hostedMap && !hostedConnection) {
      status.textContent = "Join the hosted room before editing";
      return false;
    }
    return applyWorkingSource();
  },
  activate: (name) => {
    boxMaterial.value = name;
    selectedMaterial.value = name;
    applyMaterialButton.disabled = selectedMaterial.disabled || !name.trim();
  },
  tool: activateViewportTool,
  status: (message) => {
    status.textContent = message;
  },
});
const workspace = initEditorWorkspace({
  renderer: () => renderer,
  render: scheduleRender,
});
const clipboard = createEditorClipboard({
  session: () => session,
  pointer: () => latestPointer,
  gridSize: () => Number(gridSizeInput.value),
  textureLock: () => textureLockInput.checked,
  canPaste: () => !hostedMap || !!hostedConnection,
  hosted: () => hostedMap !== null,
  prepare: applyWorkingSource,
  status: (message) => {
    status.textContent = message;
  },
});
const contextMenu = createEditorContextMenu(
  document.querySelector<HTMLElement>("#viewport-context-menu")!,
  (error) => {
    status.textContent = error instanceof Error ? error.message : String(error);
  },
);
const faceDrag = createFaceDragController({
  session: () => session,
  renderer: () => renderer,
  textureLock: () => textureLockInput.checked,
  canEdit: viewportCanEdit,
  status: (message) => {
    status.textContent = message;
  },
});
const issueBrowser = createIssueBrowser({
  root: document.querySelector<HTMLDetailsElement>("#issue-browser")!,
  session: () => session,
  renderer: () => renderer,
  canEdit: () => !hostedMap || hostedConnection !== null,
  prepareEdit: viewportCanEdit,
  status: (message) => {
    status.textContent = message;
  },
});
const visibility = createEditorVisibility({
  root: document.querySelector<HTMLElement>(".source-panel")!,
  session: () => session,
  renderer: () => renderer,
});
const sweepTool = createEditorSweep({
  session: () => session,
  renderer: () => renderer,
  viewState: () => rendererViewState,
  tool: () => viewportTool.value,
  gridSize: () => Number(gridSizeInput.value),
  textureLock: () => textureLockInput.checked,
  canEdit: viewportCanEdit,
  status: (message) => {
    status.textContent = message;
  },
  selectTool: () => activateViewportTool("select"),
});
const topologyTool = createEditorTopology({
  session: () => session,
  renderer: () => renderer,
  viewState: () => rendererViewState,
  tool: () => viewportTool.value,
  viewport: () => latestPointer?.viewport ?? "xy",
  gridSize: () => Number(gridSizeInput.value),
  textureLock: () => textureLockInput.checked,
  canEdit: viewportCanEdit,
  status: (message) => {
    status.textContent = message;
  },
  selectTool: () => activateViewportTool("select"),
});
const shapeTool = createEditorShapes({
  session: () => session,
  renderer: () => renderer,
  viewState: () => rendererViewState,
  tool: () => viewportTool.value,
  material: () => boxMaterial.value.trim() || "DEV/GRID",
  openGroupEntityId: () =>
    deriveEditorGroups(session.document).find(
      (group) => group.id === openGroupId,
    )?.entityId,
  canEdit: viewportCanEdit,
  status: (message) => {
    status.textContent = message;
  },
});
const transformTool = createEditorTransform({
  session: () => session,
  renderer: () => renderer,
  viewState: () => rendererViewState,
  tool: () => viewportTool.value,
  bounds: selectedObjectBounds,
  topology: topologyTool.selection,
  gridSize: () => Number(gridSizeInput.value),
  textureLock: () => textureLockInput.checked,
  canEdit: viewportCanEdit,
  applyNumeric: (tool) =>
    ({ rotate: rotateButton, scale: scaleButton, shear: shearButton })[
      tool
    ].click(),
  status: (message) => {
    status.textContent = message;
  },
});

function activeGame(): WorldviewGameProfile {
  return project?.manifest.game ?? hostedMap?.game ?? localGame;
}

const collaboratorColors: Readonly<
  Record<string, readonly [number, number, number]>
> = {
  red: [0.95, 0.2, 0.18],
  orange: [0.98, 0.45, 0.12],
  yellow: [0.95, 0.78, 0.12],
  green: [0.18, 0.82, 0.35],
  cyan: [0.12, 0.78, 0.88],
  blue: [0.2, 0.42, 1],
  violet: [0.64, 0.3, 1],
  pink: [0.95, 0.32, 0.68],
};

function renderPresence() {
  hostedPresence.update(hostedMap, remoteParticipants);
  const overlays: EditorRemotePresenceOverlay[] = remoteParticipants.map(
    (participant) => {
      const preview = participant.preview;
      let document = session.document;
      if (preview) {
        const operation = {
          schemaVersion: COLLABORATION_SCHEMA_VERSION,
          operationId: `preview:${participant.actorId}:${preview.interactionId}:${preview.sequence}`,
          transactionId: preview.interactionId,
          actorId: participant.actorId,
          baseMapVersion: preview.baseMapVersion,
          label: "Remote preview",
          edits: preview.edits,
        };
        const result = applyCollaborationOperation(document, operation);
        if (result.status === "applied") document = result.document;
      }
      return {
        actorId: participant.actorId,
        color:
          collaboratorColors[participant.color ?? ""] ??
          collaboratorColors.cyan!,
        document,
        selectedObjectIds: participant.selectedObjectIds ?? [],
        previewObjectIds: (preview?.edits ?? []).map((edit) =>
          edit.kind === "insert-entity"
            ? edit.entity.id
            : edit.kind === "insert-brush"
              ? edit.brush.id
              : edit.kind === "replace-entity-properties" ||
                  edit.kind === "delete-entity"
                ? edit.entityId
                : edit.brushId,
        ),
        ...(participant.pointer ? { pointer: participant.pointer } : {}),
      };
    },
  );
  renderer?.setRemotePresence(overlays);
  scheduleRender();
}

function captureDraft(): EditorDraft {
  return {
    documentId,
    fileName: mapName,
    committedSource: serializeMap(session.document),
    workingSource: source.value,
    revision: session.document.revision,
    game: activeGame(),
    document: session.document,
    sourceState: mapSourceState,
  };
}

function persistDraft() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  if (hostedMap) return;
  const draft = captureDraft();
  saveQueue = saveQueue
    .then(() => saveEditorDraft(draft))
    .catch(() => {
      status.textContent = "Local recovery is unavailable; download your map";
    });
}

function scheduleDraftSave() {
  if (hostedMap) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistDraft, 350);
}

function scheduleRender() {
  if (framePending) return;
  framePending = true;
  requestAnimationFrame(() => {
    framePending = false;
    try {
      const activeRenderer = renderer;
      if (!activeRenderer) return;
      if (!performanceDiagnostics.isEnabled()) {
        if (activeRenderer.render()) scheduleRender();
        return;
      }
      const started = performance.now();
      const more = activeRenderer.render();
      performanceDiagnostics.recordRender(performance.now() - started);
      if (more) scheduleRender();
    } catch (error) {
      stopSourceRenderer(
        error instanceof Error ? error.message : String(error),
      );
    }
  });
}

function stopSourceRenderer(message: string) {
  rendererFailure = message;
  const failedRenderer = renderer;
  renderer = null;
  if (failedRenderer) {
    try {
      failedRenderer.dispose();
    } catch {
      // A lost device may reject cleanup of its resources.
    }
  }
  setHostedEditability();
  refreshStatus();
}

function showCompiledPreview(show: boolean) {
  compiledVisible = show && compiledPreview !== null;
  fov.setCompiled(compiledVisible);
  if (compiledPreview) {
    compiledPreview.dataset.active = String(compiledVisible);
    if (compiledVisible) compiledPreview.viewer?.start();
    else compiledPreview.viewer?.stop();
  }
  perspectiveLabel.textContent = compiledVisible
    ? "Compiled preview"
    : "Perspective";
  toggleCompiledButton.textContent = compiledVisible
    ? "Show source"
    : compiledDocument &&
        (compiledDocument !== session.document ||
          compiledSourceText !== source.value)
      ? "Show compiled (stale)"
      : "Show compiled";
}

function refreshCompiledPreview() {
  if (!compiledPreview) return;
  if (
    compiledDocument !== session.document ||
    compiledSourceText !== source.value
  ) {
    showCompiledPreview(false);
  }
}

function clearCompiledPreview() {
  showCompiledPreview(false);
  compiledPreview?.remove();
  compiledPreview = null;
  compiledDocument = null;
  compiledSourceText = null;
  toggleCompiledButton.disabled = true;
  toggleCompiledButton.textContent = "Show compiled";
}

function renderExportSettings() {
  includeBuildSource.checked = exportSettings.includeSource;
  exportAfterBuild.checked = exportSettings.afterBuild;
  exportDestination.textContent = `Destination: ${exportSettings.directory?.name ?? "Downloads"}`;
  chooseExportDirectory.hidden = !directoryExportSupported();
  useExportDownloads.hidden = !exportSettings.directory;
}

function loadCurrentExportSettings() {
  const scopeId = projectBindings?.scopeId ?? "default";
  const generation = ++exportSettingsGeneration;
  exportSettings = defaultExportSettings(scopeId);
  renderExportSettings();
  void loadExportSettings(scopeId)
    .then((settings) => {
      if (generation !== exportSettingsGeneration) return;
      exportSettings = settings;
      renderExportSettings();
    })
    .catch(() => {
      if (generation === exportSettingsGeneration)
        exportStatus.textContent =
          "Export settings will only last for this session";
    });
}

function configureExportSettings(
  update: Partial<
    Pick<ExportSettings, "includeSource" | "afterBuild" | "directory">
  >,
) {
  ++exportSettingsGeneration;
  exportSettings = { ...exportSettings, ...update };
  renderExportSettings();
  const settings = exportSettings;
  exportSettingsSave = exportSettingsSave
    .then(() => saveExportSettings(settings))
    .catch(() => {
      exportStatus.textContent =
        "Export settings will only last for this session";
    });
}

function isBuildExportCurrent(
  candidate: NonNullable<typeof latestBuildExport>,
): boolean {
  return (
    latestBuildExport === candidate &&
    candidate.document === session.document &&
    candidate.sourceText === source.value &&
    candidate.project === project &&
    candidate.name === mapName &&
    candidate.game === activeGame()
  );
}

function refreshBuildExport() {
  const current =
    !!latestBuildExport && isBuildExportCurrent(latestBuildExport);
  exportBuildButton.disabled = exportBusy || !current;
  if (latestBuildExport && !current) {
    exportStatus.textContent = "Map changed; rebuild to export";
  } else if (
    latestBuildExport &&
    exportStatus.textContent === "Map changed; rebuild to export"
  ) {
    exportStatus.textContent = "Bundle ready";
  }
}

function installCompiledPreview(
  previewSource: WorldSource,
  documentAtBuild: MapDocument,
  sourceAtBuild: string,
) {
  clearCompiledPreview();
  defineWorldViewElement();
  const preview = document.createElement("world-view") as WorldViewElement;
  preview.setAttribute("controls", "fly");
  preview.setAttribute("autostart", "false");
  preview.setAttribute("audio", "false");
  preview.dataset.active = "false";
  preview.source = previewSource;
  preview.addEventListener("ready", () => {
    if (compiledPreview !== preview) return;
    toggleCompiledButton.disabled = false;
    buildStatus.textContent = "Compiled preview ready";
    if (
      compiledDocument === session.document &&
      compiledSourceText === source.value
    ) {
      showCompiledPreview(true);
    } else {
      showCompiledPreview(false);
    }
  });
  preview.addEventListener("error", (event) => {
    if (compiledPreview !== preview) return;
    clearCompiledPreview();
    buildStatus.textContent = `Compiled preview unavailable: ${event.detail.error.message}`;
  });
  compiledPreview = preview;
  compiledDocument = documentAtBuild;
  compiledSourceText = sourceAtBuild;
  canvases.perspective.parentElement!.append(preview);
}

function refreshResourceCatalog() {
  const resources = project ?? hostedResources;
  renderer?.setEntityDefinitions(resources?.definitions);
  renderer?.setMaterials(currentMaterials());
  materialBrowser.setMaterials(currentMaterials());
  renderer?.setSprites(resources?.sprites ?? []);
  renderer?.setEntityPlacementBounds(
    pointEntityDefinition(
      pointEntityClassname.value.trim(),
      resources?.definitions,
    ).bounds,
  );
  pointEntityClasses.replaceChildren();
  brushEntityClasses.replaceChildren();
  materialChoices.replaceChildren();
  projectResourceMessages.replaceChildren();
  projectResourceDiagnostics.hidden =
    !resources ||
    resources.definitionDiagnostics.length +
      resources.materialDiagnostics.length +
      resources.spriteDiagnostics.length ===
      0;
  for (const material of resources?.materials ?? []) {
    const option = document.createElement("option");
    option.value = material.name;
    materialChoices.append(option);
  }
  for (const definition of resources?.definitions.all() ?? []) {
    const option = document.createElement("option");
    option.value = definition.classname;
    option.label = definition.label;
    if (definition.kind === "point") pointEntityClasses.append(option);
    if (definition.kind === "brush") brushEntityClasses.append(option);
  }
  if (resources) {
    const messages =
      resources.definitionDiagnostics.length +
      resources.materialDiagnostics.length +
      resources.spriteDiagnostics.length;
    projectResourceInfo.textContent = `${resources.definitions.all().length} entity classes · ${resources.materials.length} textures · ${resources.sprites.length} sprites${messages ? ` · ${messages} resource ${messages === 1 ? "message" : "messages"}` : ""}`;
    for (const diagnostic of resources.definitionDiagnostics) {
      const item = document.createElement("li");
      item.textContent = `${diagnostic.severity}: ${diagnostic.sourcePath ?? "Definitions"}: ${diagnostic.message}`;
      projectResourceMessages.append(item);
    }
    for (const diagnostic of resources.materialDiagnostics) {
      const item = document.createElement("li");
      item.textContent = diagnostic;
      projectResourceMessages.append(item);
    }
    for (const diagnostic of resources.spriteDiagnostics) {
      const item = document.createElement("li");
      item.textContent = diagnostic;
      projectResourceMessages.append(item);
    }
  } else {
    projectResourceInfo.textContent = "";
  }
  refreshSelection();
}

function setProject(value: MapProject | null) {
  const previousGame = activeGame();
  latestBuildExport = null;
  exportStatus.textContent = "";
  refreshBuildExport();
  project = value;
  projectSyncControls?.setProject(value);
  if (activeGame() !== previousGame) {
    buildGeneration += 1;
    clearCompiledPreview();
  }
  projectBindings = null;
  loadCurrentExportSettings();
  buildProfile.replaceChildren();
  const profiles = value?.manifest.buildProfiles.length
    ? value.manifest.buildProfiles
    : [
        { id: "preview", label: "Preview", quality: "preview" as const },
        { id: "final", label: "Final", quality: "final" as const },
      ];
  for (const profile of profiles) {
    buildProfile.add(new Option(profile.label, profile.id));
  }
  buildProfile.value = value?.manifest.defaultBuildProfile ?? profiles[0]!.id;
  refreshResourceCatalog();
  if (value) return;
  projectMapSelector.hide();
  activeProjectPath = null;
  activeRecentProjectId = null;
  projectMaps.replaceChildren(new Option("No project open", ""));
  projectMaps.disabled = true;
  projectResourceInfo.textContent = "";
  refreshSelection();
}

function refreshStatus() {
  if (hostedMap) {
    status.textContent = `${hostedMap.projectName} / ${hostedMap.name} · hosted v${hostedMap.mapVersion} · ${hostedConnection ? "live editing" : "read only"}`;
  } else {
    const brushes = session.document.entities.reduce(
      (total, entity) => total + entity.primitives.length,
      0,
    );
    status.textContent =
      source.value === sourcePreview()
        ? `${brushes} brushes · revision ${session.document.revision}`
        : "Source has unapplied edits";
  }
  if (rendererFailure) {
    status.textContent += ` · ${rendererFailure} · source and numeric editing still work`;
  }
}

function sourcePreview(): string {
  if (hostedMap) return hostedMap.source;
  const plan = planMapSave(session.document, mapSourceState);
  return plan.status === "safe" ? plan.text : plan.normalizedText;
}

function refreshSource() {
  if (hostedMap) {
    source.value = hostedMap.source;
    sourceSaveWarning.hidden = true;
  } else {
    const plan = planMapSave(session.document, mapSourceState);
    source.value = plan.status === "safe" ? plan.text : plan.normalizedText;
    sourceSaveWarning.hidden = plan.status === "safe";
    sourceSaveWarning.textContent =
      plan.status === "blocked"
        ? `${plan.diagnostics.map(({ message }) => message).join(" ")} Use Export normalized for a separate copy; Save and Download cannot overwrite this source.`
        : "";
  }
  refreshCompiledPreview();
  refreshBuildExport();
  refreshStatus();
  scheduleDraftSave();
}

function refreshSurfaceInspector(faces: readonly MapFace[], editing: boolean) {
  const semantics = worldviewGameProfile(activeGame()).surfaceSemantics;
  surfaceAttributes.hidden = !semantics || faces.length === 0;
  if (!semantics || faces.length === 0) return;

  function renderFlags(
    container: HTMLElement,
    unknownLabel: HTMLElement,
    field: "contents" | "flags",
    definitions: readonly SurfaceFlagDefinition[],
  ) {
    const values = faces.map((face) => face.surface[field] ?? 0);
    container.replaceChildren();
    for (const definition of definitions) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      const enabled = values.filter(
        (value) => ((value >>> 0) & definition.value) === definition.value,
      ).length;
      checkbox.checked = enabled === values.length;
      checkbox.indeterminate = enabled > 0 && enabled < values.length;
      checkbox.disabled = !editing;
      checkbox.addEventListener("change", () => {
        if (!applyWorkingSource() || (hostedMap && !hostedConnection)) return;
        try {
          session.setSelectedSurfaceFlag(
            field,
            definition.value,
            checkbox.checked,
          );
        } catch (error) {
          status.textContent =
            error instanceof Error ? error.message : String(error);
          refreshSelection();
        }
      });
      label.append(checkbox, document.createTextNode(definition.label));
      container.append(label);
    }
    const unknown = [
      ...new Set(
        values.map(
          (value) => decodeSurfaceFlags(value, definitions).unknownBits,
        ),
      ),
    ];
    unknownLabel.hidden = unknown.length === 1 && unknown[0] === 0;
    unknownLabel.textContent =
      unknown.length > 1
        ? "Unknown bits: mixed"
        : `Unknown bits: 0x${(unknown[0] ?? 0).toString(16)}`;
  }

  renderFlags(surfaceContents, unknownContents, "contents", semantics.contents);
  renderFlags(surfaceFlags, unknownFlags, "flags", semantics.flags);
  const values = faces.map((face) => face.surface.value ?? 0);
  const common = values.every((value) => value === values[0]);
  surfaceValueLabel.textContent = semantics.valueLabel;
  surfaceValue.value = common ? String(values[0] ?? 0) : "";
  surfaceValue.placeholder = common ? "" : "Mixed";
  surfaceValue.disabled = !editing;
}

function refreshLayers() {
  const layers = deriveEditorLayers(session.document);
  if (!layers.some((layer) => layer.id === selectedLayerId)) {
    selectedLayerId = null;
  }
  const selected = layers.find((layer) => layer.id === selectedLayerId);
  const custom = layers.filter((layer) => layer.id !== null);
  const customIndex = custom.findIndex((layer) => layer.id === selectedLayerId);
  const editing = !hostedMap || hostedConnection !== null;
  layerSelect.replaceChildren(
    ...layers.map(
      (layer) =>
        new Option(
          `${layer.name}${layer.id === session.activeLayerId ? " · active" : ""}`,
          layer.id ?? "",
        ),
    ),
  );
  layerSelect.value = selectedLayerId ?? "";
  layerSelect.disabled = layers.length === 0;
  layerCount.textContent = selected
    ? `${selected.brushIds.length} brushes · ${selected.pointEntityIds.length} point entities`
    : "";
  if (document.activeElement !== layerName)
    layerName.value = selected?.name ?? "";
  layerName.disabled = !editing || selectedLayerId === null;
  newLayerName.disabled = !editing;
  layerButtons.create.disabled = !editing;
  layerButtons.rename.disabled = !editing || selectedLayerId === null;
  layerButtons.activate.disabled =
    !editing || selectedLayerId === session.activeLayerId;
  layerButtons.move.disabled =
    !editing || !session.selection || !!session.selection.faceId;
  layerButtons.select.disabled =
    !selected ||
    selected.hidden ||
    selected.locked ||
    selected.brushIds.length + selected.pointEntityIds.length === 0;
  layerButtons.isolate.disabled = !editing || layers.length < 2;
  layerButtons.remove.disabled = !editing || selectedLayerId === null;
  layerButtons.up.disabled = !editing || customIndex <= 0;
  layerButtons.down.disabled =
    !editing || customIndex < 0 || customIndex >= custom.length - 1;
  for (const [flag, checkbox] of Object.entries(layerFlags) as [
    keyof typeof layerFlags,
    HTMLInputElement,
  ][]) {
    checkbox.checked = Boolean(
      selected?.[flag === "omit-from-export" ? "omitFromExport" : flag],
    );
    checkbox.disabled = !editing || !selected;
  }
  for (const button of [
    layerButtons.showAll,
    layerButtons.hideAll,
    layerButtons.unlockAll,
    layerButtons.lockAll,
  ]) {
    button.disabled = !editing || layers.length === 0;
  }
}

function refreshSelection() {
  if (
    openGroupId &&
    !deriveEditorGroups(session.document).some(
      (group) => group.id === openGroupId,
    )
  ) {
    openGroupId = null;
    session.setEditingGroup(null);
    renderer?.setOpenGroupId(null);
  }
  const selection = session.selection;
  const brushIds = selectedBrushIds(selection);
  const faceRefs = selectedFaceReferences(selection);
  const brushId = brushIds[0];
  const pointIds = selectedPointEntityIds(selection);
  const pointEntity =
    pointIds.length === 1
      ? session.document.entities.find((entity) => entity.id === pointIds[0])
      : undefined;
  const owners = brushIds.map((id) =>
    session.document.entities.find((entity) =>
      entity.primitives.some((primitive) => primitive.id === id),
    ),
  );
  const owner = owners[0];
  const ownerLabel =
    deriveEditorLayers(session.document).find(
      (layer) => layer.entityId === owner?.id,
    )?.name ??
    deriveEditorGroups(session.document).find(
      (group) => group.entityId === owner?.id,
    )?.name ??
    owner?.properties.classname ??
    "unknown entity";
  selectionInfo.textContent = brushId
    ? brushIds.length === 1
      ? `Selected brush ${brushId} · ${ownerLabel}`
      : `${brushIds.length} brushes selected`
    : faceRefs.length > 0
      ? `${faceRefs.length} ${faceRefs.length === 1 ? "face" : "faces"} selected`
      : pointEntity
        ? `Selected point entity ${pointEntity.properties.classname ?? pointEntity.id}`
        : pointIds.length > 1
          ? `${pointIds.length} point entities selected`
          : "No selection";
  const editing = !hostedMap || hostedConnection !== null;
  gameProfile.value = activeGame();
  gameProfile.disabled = project !== null || hostedMap !== null;
  const faces = faceRefs.flatMap(({ brushId: ownerId, faceId }) => {
    const face = findBrush(session.document, ownerId)?.faces.find(
      (candidate) => candidate.id === faceId,
    );
    return face ? [face] : [];
  });
  const uvReference = faceRefs.length === 1 ? faceRefs[0] : undefined;
  const uvBrush = uvReference
    ? findBrush(session.document, uvReference.brushId)
    : undefined;
  const uvFace = uvBrush?.faces.find(
    (candidate) => candidate.id === uvReference?.faceId,
  );
  const uvVertices = uvFace
    ? deriveBrush(uvBrush!).faces.find(
        (candidate) => candidate.faceId === uvFace.id,
      )?.vertices
    : undefined;
  uvEditor.setFace(
    uvReference && uvFace && uvVertices && editing
      ? {
          selection: uvReference,
          face: uvFace,
          vertices: uvVertices,
          selectedFaceCount: 1,
          material: currentMaterials().find(
            (material) =>
              material.name.toLowerCase() === uvFace.material.toLowerCase(),
          ),
        }
      : null,
  );
  uvFrame.disabled = !uvVertices || !editing;
  uvResetPivot.disabled = uvFrame.disabled;
  faceInspector.hidden = brushIds.length === 0 && faces.length === 0;
  faceProjection.hidden = faces.length === 0;
  faceGeometry.hidden = faces.length === 0;
  faceDistance.disabled = faces.length === 0 || !editing;
  for (const button of Object.values(faceGeometryButtons))
    button.disabled = !selection?.faceId || !editing;
  faceSummary.textContent = faces.length
    ? `${faces.length} ${faces.length === 1 ? "face" : "faces"} selected`
    : `${brushIds.length} ${brushIds.length === 1 ? "brush" : "brushes"} selected · apply to all faces`;
  const faceBrush =
    brushIds.length === 1
      ? findBrush(session.document, brushIds[0]!)
      : selection?.brushId && selection.faceId
        ? findBrush(session.document, selection.brushId)
        : null;
  selectedFace.replaceChildren(new Option("All brush faces", ""));
  for (const [index, face] of (faceBrush?.faces ?? []).entries()) {
    selectedFace.add(
      new Option(`Face ${index + 1} · ${face.material}`, face.id),
    );
  }
  selectedFace.value = selection?.faceId ?? "";
  selectedFace.disabled = !faceBrush;
  const materials = faces.length
    ? faces.map((face) => face.material)
    : brushIds.flatMap(
        (id) =>
          findBrush(session.document, id)?.faces.map((face) => face.material) ??
          [],
      );
  const sharedMaterial = materials.every((value) => value === materials[0]);
  selectedMaterial.value = sharedMaterial ? (materials[0] ?? "") : "";
  selectedMaterial.placeholder = sharedMaterial
    ? "Material"
    : "Mixed materials";
  selectedMaterial.disabled = faceInspector.hidden || !editing;
  applyMaterialButton.disabled =
    selectedMaterial.disabled || !selectedMaterial.value.trim();
  const textureSelectionKey = `${brushIds.join("|")}/${faces.map((face) => face.id).join("|")}`;
  if (textureSelectionKey !== inspectedTextureSelection) {
    textureWidth.value = "";
    textureHeight.value = "";
    inspectedTextureSelection = textureSelectionKey;
  }
  const catalogMaterial = sharedMaterial
    ? currentMaterials().find(
        (material) =>
          material.name.toLowerCase() === materials[0]?.toLowerCase(),
      )
    : undefined;
  textureWidth.placeholder = catalogMaterial
    ? String(catalogMaterial.logicalWidth ?? catalogMaterial.width)
    : "";
  textureHeight.placeholder = catalogMaterial
    ? String(catalogMaterial.logicalHeight ?? catalogMaterial.height)
    : "";
  for (const control of [
    alignmentOperation,
    textureWidth,
    textureHeight,
    alignmentReverse,
    alignmentSubdivide,
  ]) {
    control.disabled = faceInspector.hidden || !editing;
  }
  alignmentButton.disabled = faceInspector.hidden || !editing;
  for (const [field, input] of Object.entries(projectionInputs) as [
    FaceTextureProjectionField,
    HTMLInputElement,
  ][]) {
    const values = faces.map((face) => {
      const projection = face.projection;
      switch (field) {
        case "offset-u":
          return projection.offset[0];
        case "offset-v":
          return projection.offset[1];
        case "scale-u":
          return projection.scale[0];
        case "scale-v":
          return projection.scale[1];
        case "rotation":
          return projection.rotationDegrees;
      }
    });
    const common = values.every((value) => value === values[0]);
    input.value = common ? String(values[0] ?? "") : "";
    input.placeholder = common ? "" : "Mixed";
    input.disabled = faces.length === 0 || !editing;
  }
  refreshSurfaceInspector(faces, editing);
  const selectedEntity =
    pointEntity ?? (brushIds.length === 1 ? owners[0] : undefined);
  entityProperties.hidden = !selectedEntity;
  if (inspectedEntityId !== (selectedEntity?.id ?? null)) {
    propertyKey.value = "";
    propertyValue.value = "";
    inspectedEntityId = selectedEntity?.id ?? null;
  }
  if (selectedEntity) {
    renderEntityProperties({
      list: propertyList,
      entity: selectedEntity,
      definitions: currentDefinitions(),
      editable: editing,
      commit: commitEntityProperty,
    });
  } else propertyList.replaceChildren();
  propertyKey.disabled = !selectedEntity || !editing;
  propertyValue.disabled = !selectedEntity || !editing;
  refreshPropertyActions();
  pointInspector.hidden = !pointEntity;
  if (pointEntity) {
    pointClassname.value = pointEntity.properties.classname ?? "";
    pointOrigin.value = pointEntity.properties.origin ?? "";
  }
  updatePointButton.disabled = !pointEntity || !editing;
  deleteButton.disabled = (!brushId && pointIds.length === 0) || !editing;
  duplicateButton.disabled = (!brushId && pointIds.length === 0) || !editing;
  copySelectionButton.disabled = !selection;
  snapToGridButton.disabled =
    hostedMap !== null ||
    (brushIds.length === 0 && selectedFaceReferences(selection).length === 0);
  hideSelectionButton.disabled =
    hostedMap !== null || (!brushId && pointIds.length === 0);
  isolateSelectionButton.disabled = hideSelectionButton.disabled;
  showAllButton.disabled = hostedMap !== null || !session.canShowAll;
  focusSelectionButton.disabled = !selection || !renderer;
  lockSelectionButton.disabled = hideSelectionButton.disabled;
  unlockAllButton.disabled = hostedMap !== null || !session.canUnlockAll;
  repeatCommandsButton.disabled = !session.canRepeatCommands || !editing;
  repeatCommandsButton.textContent = session.repeatCommandCount
    ? `Repeat ${session.repeatCommandCount}`
    : "Repeat";
  repeatCommandsButton.title = session.repeatCommandLabels.length
    ? `Repeat ${session.repeatCommandLabels.join(" → ")} (Ctrl/Command+Shift+R)`
    : "Record duplicate, move, rotate, flip, scale, or shear commands first";
  clearRepeatCommandsButton.disabled = session.repeatCommandCount === 0;
  clearRepeatCommandsButton.title = session.repeatCommandCount
    ? `Clear ${session.repeatCommandLabels.join(" → ")}`
    : "No recorded command sequence";
  for (const button of nudgeButtons) {
    button.disabled = (!brushId && pointIds.length === 0) || !editing;
  }
  makeEntityButton.disabled = !brushId || !editing;
  makeStructuralButton.disabled =
    !brushId ||
    !editing ||
    owners.every(
      (entity) => entity?.properties.classname?.toLowerCase() === "worldspawn",
    );
  moveButton.disabled = (!brushId && pointIds.length === 0) || !editing;
  rotateButton.disabled = !brushId || !editing;
  scaleButton.disabled = !brushId || !editing;
  shearButton.disabled = (!brushId && pointIds.length === 0) || !editing;
  for (const button of flipButtons) {
    button.disabled = (!brushId && pointIds.length === 0) || !editing;
  }
  csgButtons.merge.disabled = brushIds.length < 2 || !editing;
  csgButtons.intersect.disabled = brushIds.length < 2 || !editing;
  csgButtons.subtract.disabled = brushIds.length === 0 || !editing;
  csgButtons.hollow.disabled = brushIds.length === 0 || !editing;
  csgThickness.disabled = !editing;
  const selectedGroup = selectedEditorGroup(session.document, selection);
  groupButtons.create.disabled = !selection || !!selection.faceId || !editing;
  groupButtons.rename.disabled = !selectedGroup || !editing;
  groupButtons.open.disabled =
    !selectedGroup || !editing || selectedGroup.id === openGroupId;
  groupButtons.close.disabled = !openGroupId;
  groupButtons.linked.disabled =
    !selectedGroup || !editing || selectedGroup.id === openGroupId;
  groupButtons.unlink.disabled = !selectedGroup?.linkedGroupId || !editing;
  groupButtons.ungroup.disabled = !selectedGroup || !editing;
  groupName.disabled = !editing;
  if (selectedGroup && document.activeElement !== groupName) {
    groupName.value = selectedGroup.name;
  }
  refreshLayers();
  undoButton.disabled = hostedMap
    ? !hostedConnection?.canUndo()
    : !session.canUndo;
  redoButton.disabled = hostedMap
    ? !hostedConnection?.canRedo()
    : !session.canRedo;
  const undoLabel = hostedMap
    ? hostedConnection?.undoLabel()
    : session.undoLabel;
  const redoLabel = hostedMap
    ? hostedConnection?.redoLabel()
    : session.redoLabel;
  undoButton.title = undoLabel ? `Undo ${undoLabel}` : "Undo";
  redoButton.title = redoLabel ? `Redo ${redoLabel}` : "Redo";
  const viewState = session.objectViewState;
  const openGroup = deriveEditorGroups(session.document).find(
    (group) => group.id === openGroupId,
  );
  const visibleBrushes = new Set(openGroup?.brushIds);
  const visibleEntities = new Set(openGroup?.pointEntityIds);
  rendererViewState = openGroup
    ? {
        ...viewState,
        lockedBrushIds: [
          ...new Set([
            ...viewState.lockedBrushIds,
            ...session.document.entities.flatMap((entity) =>
              entity.primitives
                .filter((brush) => !visibleBrushes.has(brush.id))
                .map((brush) => brush.id),
            ),
          ]),
        ],
        lockedEntityIds: [
          ...new Set([
            ...viewState.lockedEntityIds,
            ...pointEntitiesInDocument(session.document)
              .filter((entity) => !visibleEntities.has(entity.id))
              .map((entity) => entity.id),
          ]),
        ],
      }
    : viewState;
  renderer?.setDocument(session.document, selection, rendererViewState);
  if (remoteParticipants.length > 0) renderPresence();
  visibility.refresh();
  refreshClipPreview();
  refreshHullControls();
  sweepTool.refresh();
  topologyTool.refresh();
  shapeTool.refresh();
  transformTool.refresh();
  scheduleRender();
}

function refreshClipPreview() {
  clipCandidate = null;
  const active = viewportTool.value === "clip";
  clipTools.hidden = !active;
  const selection = session.selection;
  if (active && clipPlanePoints && selection) {
    try {
      clipCandidate = session.createBrushSetClipCandidate(
        selectedBrushIds(selection),
        clipPlanePoints,
        clipMode,
        createSequentialIdFactory(`tea-clip-${crypto.randomUUID()}`),
        boxMaterial.value.trim() || undefined,
      );
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : String(error);
    }
  }
  if (clipCandidate) {
    const affected =
      "edits" in clipCandidate
        ? [...clipCandidate.selectionBefore, ...clipCandidate.selectionAfter]
        : [
            clipCandidate.before.id,
            ...clipCandidate.after.map((brush) => brush.id),
          ];
    renderer?.setPreviewDocument(clipCandidate.document, selection, affected);
  } else {
    renderer?.setDocument(session.document, selection, rendererViewState);
  }
  clipPointsLabel.textContent = clipPoints.length
    ? `${clipPoints.length} point${clipPoints.length === 1 ? "" : "s"}: ${clipPoints.map((point) => point.join(", ")).join(" · ")}`
    : "Place two or three points";
  for (const [mode, button] of Object.entries(clipModeButtons) as [
    BrushClipMode,
    HTMLButtonElement,
  ][]) {
    button.setAttribute("aria-pressed", String(mode === clipMode));
  }
  applyClipButton.disabled =
    !clipCandidate || (hostedMap !== null && !hostedConnection);
  resetClipButton.disabled = clipPoints.length === 0;
}

function handleClipPlaneChange(event: EditorClipPlaneEvent) {
  clipPoints = event.points;
  clipPlanePoints = event.planePoints;
  refreshClipPreview();
}

function refreshHullControls() {
  const active = viewportTool.value === "hull";
  hullTools.hidden = !active;
  hullPointsLabel.textContent = `${hullPointCount} point${hullPointCount === 1 ? "" : "s"}`;
  createHullButton.disabled =
    !active || !hullCandidate || (hostedMap !== null && !hostedConnection);
  discardHullButton.disabled =
    !active || (hullPointCount === 0 && !renderer?.hullHistoryActive);
  if (renderer?.hullHistoryActive) {
    undoButton.disabled = !renderer.canUndoHull;
    redoButton.disabled = !renderer.canRedoHull;
    undoButton.title = "Undo hull point";
    redoButton.title = "Redo hull point";
  }
}

function handleHullCreate(event: EditorHullCreateEvent) {
  hullPointCount = event.points.length;
  hullCandidate = null;
  if (event.phase === "cancel") {
    hullPrefix = null;
    renderer?.setDocument(
      session.document,
      session.selection,
      rendererViewState,
    );
    refreshHullControls();
    return;
  }
  if (!viewportCanEdit()) {
    renderer?.setDocument(
      session.document,
      session.selection,
      rendererViewState,
    );
    refreshHullControls();
    return;
  }
  try {
    hullPrefix ??= `tea-hull-${crypto.randomUUID()}`;
    const brush = createConvexHullBrush(
      event.points,
      boxMaterial.value.trim() || "DEV/GRID",
      createSequentialIdFactory(hullPrefix),
    );
    const openGroup = deriveEditorGroups(session.document).find(
      (group) => group.id === openGroupId,
    );
    const candidate = {
      ...session.createBrushCandidate(brush, openGroup?.entityId),
      label: "Create hull brush",
    };
    if (event.phase === "preview") {
      hullCandidate = candidate;
      renderer?.setPreviewDocument(candidate.document, { brushId: brush.id }, [
        brush.id,
      ]);
      status.textContent = `${event.points.length} hull points enclose a valid brush`;
    } else {
      session.commitCreationCandidate(candidate);
      hullPointCount = 0;
      hullPrefix = null;
      status.textContent = candidate.label;
    }
  } catch (error) {
    renderer?.setDocument(
      session.document,
      session.selection,
      rendererViewState,
    );
    if (event.phase === "commit") throw error;
    if (event.points.length >= 4)
      status.textContent =
        error instanceof Error ? error.message : String(error);
  }
  refreshHullControls();
}

function refreshPropertyActions() {
  const key = propertyKey.value.trim();
  const entity = session.document.entities.find(
    (candidate) => candidate.id === inspectedEntityId,
  );
  const editing = !hostedMap || hostedConnection !== null;
  savePropertyButton.disabled =
    !entity || !editing || !key || key.startsWith("_tb_");
  removePropertyButton.disabled =
    !entity ||
    !editing ||
    !key ||
    key === "classname" ||
    key.startsWith("_tb_") ||
    !(key in entity.properties);
}

function handleSessionChange(change: { kind: string }) {
  if (change.kind === "document" || change.kind === "history") {
    refreshSource();
    issueBrowser.refresh();
    materialBrowser.refresh();
  }
  refreshSelection();
}

let unsubscribeSession = session.subscribe(handleSessionChange);

function setMap(value: MapDocument, sourceState?: MapSourceState) {
  uvEditor.cancel();
  uvEditor.setFace(null);
  uvPreviewCandidate = null;
  renderer?.clearClipPlane();
  renderer?.clearHullPoints();
  sweepTool.clear();
  topologyTool.clear();
  shapeTool.reset();
  transformTool.clear();
  clipPoints = [];
  clipPlanePoints = null;
  clipCandidate = null;
  hullCandidate = null;
  hullPointCount = 0;
  hullPrefix = null;
  openGroupId = null;
  selectedLayerId = null;
  renderer?.setOpenGroupId(null);
  dragDuplicateBase = null;
  faceDrag.reset();
  latestPointer = null;
  pasteCursorButton.disabled = true;
  latestBuildExport = null;
  exportStatus.textContent = "";
  refreshBuildExport();
  clearCompiledPreview();
  unsubscribeSession();
  session = new EditorSession(value);
  mapSourceState = sourceState ?? rebaseMapSource(value, serializeMap(value));
  unsubscribeSession = session.subscribe(handleSessionChange);
  issueBrowser.reset();
  renderer?.setMaterials(currentMaterials());
  materialBrowser.setMaterials(currentMaterials());
  refreshSelection();
  renderer?.focusDocument();
  workspace.switchDocument(hostedMap ? `hosted:${hostedMap.id}` : documentId);
  refreshSource();
  scheduleRender();
}

function selectedBrushPivot(): readonly [number, number, number] | null {
  const bounds = selectedBrushIds(session.selection).flatMap((id) => {
    const brush = findBrush(session.document, id);
    const box = brush ? deriveBrush(brush).bounds : null;
    return box ? [box] : [];
  });
  if (bounds.length === 0) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const box of bounds) {
    for (const axis of [0, 1, 2] as const) {
      min[axis] = Math.min(min[axis]!, box.min[axis]);
      max[axis] = Math.max(max[axis]!, box.max[axis]);
    }
  }
  return [
    (min[0]! + max[0]!) / 2,
    (min[1]! + max[1]!) / 2,
    (min[2]! + max[2]!) / 2,
  ];
}

function selectedObjectBounds(): Bounds | null {
  const brushBounds = selectedBrushIds(session.selection).flatMap((id) => {
    const brush = findBrush(session.document, id);
    const bounds = brush ? deriveBrush(brush).bounds : null;
    return bounds ? [bounds] : [];
  });
  const entityIds = new Set(selectedPointEntityIds(session.selection));
  const entityBounds = session.document.entities.flatMap((entity) => {
    if (!entityIds.has(entity.id)) return [];
    const bounds = pointEntityBounds(entity);
    return bounds ? [bounds] : [];
  });
  const boxes = [...brushBounds, ...entityBounds];
  if (boxes.length === 0) return null;
  return {
    min: [0, 1, 2].map((axis) =>
      Math.min(...boxes.map((box) => box.min[axis]!)),
    ) as [number, number, number],
    max: [0, 1, 2].map((axis) =>
      Math.max(...boxes.map((box) => box.max[axis]!)),
    ) as [number, number, number],
  };
}

function applyWorkingSource(): boolean {
  if (hostedMap) return source.value === hostedMap.source;
  if (source.value === sourcePreview()) return true;
  try {
    const parsed = parseMapSource(source.value);
    mapSourceState = parsed.source;
    session.restoreDocument(parsed.document, "Apply source");
    return true;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    return false;
  }
}

function hasUnsavedChanges(): boolean {
  if (hostedMap) return false;
  const committed = serializeMap(session.document);
  if (source.value !== sourcePreview()) return true;
  return committed !== savedSource;
}

function askBeforeReplacing(): Promise<"save" | "discard" | "cancel"> {
  return new Promise((resolve) => {
    switchMapDialog.returnValue = "cancel";
    switchMapDialog.addEventListener(
      "close",
      () => {
        const choice = switchMapDialog.returnValue;
        resolve(choice === "save" || choice === "discard" ? choice : "cancel");
      },
      { once: true },
    );
    switchMapDialog.showModal();
  });
}

async function mayReplaceMap(): Promise<boolean> {
  if (
    hostedMap &&
    (await new IndexedDbCollaborationOutbox().pending(hostedMap.id)).length > 0
  ) {
    status.textContent =
      "Hosted edits are waiting to sync; edit a local copy before switching maps";
    return false;
  }
  if (!hasUnsavedChanges()) return true;
  const choice = await askBeforeReplacing();
  if (choice === "discard") return true;
  if (choice === "save") return saveCurrentMap();
  return false;
}

function setHostedEditability() {
  const readOnly = hostedMap !== null;
  if (readOnly && !hostedConnection) {
    activateViewportTool("select");
  }
  viewportTool.disabled = !renderer || (readOnly && !hostedConnection);
  source.disabled = readOnly;
  document.querySelector<HTMLButtonElement>("#add-box")!.disabled =
    readOnly && !hostedConnection;
  document.querySelector<HTMLButtonElement>("#add-point-entity")!.disabled =
    readOnly && !hostedConnection;
  document.querySelector<HTMLButtonElement>("#apply-source")!.disabled =
    readOnly;
  document.querySelector<HTMLButtonElement>("#save-map")!.disabled = readOnly;
  checkpointButton.disabled =
    readOnly && (hostedMap?.role === "viewer" || !hostedConnection);
  pasteOriginalButton.disabled = readOnly && !hostedConnection;
  pasteCursorButton.disabled =
    (readOnly && !hostedConnection) || latestPointer === null;
  document.querySelector<HTMLButtonElement>("#download-map")!.textContent =
    readOnly ? "Download copy" : "Download .map";
  buildButton.textContent = readOnly ? "Build hosted BSP" : "Build BSP";
  buildButton.disabled =
    readOnly && (hostedMap?.role === "viewer" || hostedBuildBusy);
  hostedSourceControls?.setAvailability();
  refreshSelection();
  issueBrowser.refresh();
}

function setHostedUrl(mapId: string | null) {
  const url = new URL(location.href);
  if (mapId) url.searchParams.set("hostedMap", mapId);
  else url.searchParams.delete("hostedMap");
  history.replaceState(null, "", url);
}

function leaveHostedMap() {
  if (!hostedMap) return;
  ++buildGeneration;
  hostedBuildBusy = false;
  hostedBuildControls?.setMap(null);
  hostedSourceControls?.close();
  hostedGeneration += 1;
  hostedConnection?.close();
  hostedConnection = null;
  hostedMap = null;
  hostedResourceGeneration += 1;
  hostedResourceAbort?.abort();
  hostedResourceAbort = null;
  hostedResources = null;
  refreshResourceCatalog();
  remoteParticipants = [];
  renderPresence();
  hostedControls?.setViewingHosted(false);
  setHostedUrl(null);
  setHostedEditability();
}

async function refreshHostedResources(map: HostedMapLaunch) {
  hostedResourceAbort?.abort();
  const controller = new AbortController();
  hostedResourceAbort = controller;
  const generation = ++hostedResourceGeneration;
  projectResourceInfo.textContent = "Loading hosted project resources";
  try {
    const resources = await loadHostedEditorResources(
      map.projectId,
      map.game,
      fetch,
      controller.signal,
    );
    if (generation !== hostedResourceGeneration || hostedMap?.id !== map.id)
      return;
    hostedResources = resources;
    refreshResourceCatalog();
  } catch (error) {
    if (generation !== hostedResourceGeneration || controller.signal.aborted)
      return;
    projectResourceInfo.textContent = `Could not load hosted resources: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function openHostedMap(map: HostedMapLaunch): Promise<boolean> {
  if (!(await mayReplaceMap())) return false;
  leaveHostedMap();
  persistDraft();
  openedFile = null;
  openedFingerprint = null;
  setProject(null);
  localGame = map.game;
  mapName = `${map.slug}.map`;
  savedSource = map.source;
  hostedMap = map;
  setMap(map.document);
  void refreshHostedResources(map);
  hostedBuildControls?.setMap(map);
  setHostedEditability();
  hostedControls?.setViewingHosted(true);
  setHostedUrl(map.id);
  renderPresence();
  if (map.role === "viewer") return true;
  const generation = ++hostedGeneration;
  try {
    const connection = await connectHostedEditor(map, session, {
      update(document, text, mapVersion) {
        if (generation !== hostedGeneration || !hostedMap) return;
        hostedMap = { ...hostedMap, document, source: text, mapVersion };
        source.value = text;
        refreshStatus();
      },
      status(message) {
        if (generation === hostedGeneration) status.textContent = message;
      },
      presence(participants) {
        if (generation !== hostedGeneration) return;
        remoteParticipants = participants;
        renderPresence();
      },
      history() {
        if (generation === hostedGeneration) refreshSelection();
      },
      detached(copy) {
        if (generation === hostedGeneration) openDetachedCopy(copy);
      },
      failure(error) {
        if (generation !== hostedGeneration) return;
        status.textContent =
          error instanceof Error ? error.message : String(error);
        void makeLocalCopy();
      },
    });
    if (generation !== hostedGeneration) {
      connection?.close();
      return false;
    }
    hostedConnection = connection;
    renderPresence();
    setHostedEditability();
    refreshStatus();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
  return true;
}

function openDetachedCopy(copy: {
  document: MapDocument;
  source: { originalText: string };
  fileName: string;
  profile: WorldviewGameProfile;
}) {
  leaveHostedMap();
  openedFile = null;
  openedFingerprint = null;
  setProject(null);
  localGame = copy.profile;
  documentId = crypto.randomUUID();
  mapName = copy.fileName;
  savedSource = emptySource;
  setMap(copy.document);
  source.value = copy.source.originalText;
  scheduleDraftSave();
  status.textContent = `Local recovery copy ${copy.fileName} · save to a file when ready`;
}

async function makeLocalCopy() {
  const map = hostedMap;
  if (!map) return;
  const detached = await new IndexedDbCollaborationOutbox().detach(
    map.id,
    "Opened an independent local copy",
    Date.now(),
  );
  if (detached) {
    openDetachedCopy(detached);
    return;
  }
  localGame = map.game;
  leaveHostedMap();
  openedFile = null;
  openedFingerprint = null;
  setProject(null);
  documentId = crypto.randomUUID();
  savedSource = emptySource;
  setMap(map.document);
  source.value = map.source;
  scheduleDraftSave();
  status.textContent = `Local copy of ${map.name} · save to a file when ready`;
}

function clearOpenedFile() {
  persistDraft();
  leaveHostedMap();
  openedFile = null;
  openedFingerprint = null;
  mapName = "tea-map.map";
  documentId = crypto.randomUUID();
  setProject(null);
  savedSource = emptySource;
}

function viewportCanEdit(): boolean {
  if (hostedMap && !hostedConnection) {
    status.textContent = "Join the hosted room before editing";
    return false;
  }
  if (source.value !== sourcePreview()) {
    status.textContent = "Apply source edits before using viewport tools";
    return false;
  }
  return true;
}

function handleViewportPick(
  selection: Parameters<EditorSession["select"]>[0],
  intent: EditorPickIntent,
) {
  if (!selection) {
    if (!intent.objectAdditive) session.select(null);
  } else if (selection.faceId && selection.brushId) {
    if (intent.expansion === "brush")
      session.selectBrushFaces(
        selection.brushId,
        intent.additive,
        selection.faceId,
      );
    else if (intent.expansion === "coplanar")
      session.selectConnectedCoplanarFaces(
        { brushId: selection.brushId, faceId: selection.faceId },
        intent.additive,
      );
    else
      session.selectFace(
        { brushId: selection.brushId, faceId: selection.faceId },
        intent.additive,
      );
  } else if (selection.brushId) {
    session.selectBrush(selection.brushId, intent.objectAdditive);
  } else if (selection.entityId) {
    session.selectPointEntity(selection.entityId, intent.objectAdditive);
  } else {
    session.select(selection);
  }
}

function showViewportContextMenu(event: EditorViewportContextMenuEvent) {
  latestPointer = event.pointer;
  const hit = event.hit;
  const underCursor: ContextAction[] = [];
  if (hit?.brushId) {
    underCursor.push({
      label: "Select brush",
      run: () =>
        handleViewportPick(
          { brushId: hit.brushId! },
          { additive: false, expansion: "single" },
        ),
    });
    if (hit.faceId) {
      const face = { brushId: hit.brushId, faceId: hit.faceId };
      underCursor.push(
        {
          label: "Select face",
          run: () => session.selectFace(face),
        },
        {
          label: "Select all brush faces",
          run: () => session.selectBrushFaces(hit.brushId!, false, hit.faceId!),
        },
        {
          label: "Select coplanar faces",
          run: () => session.selectConnectedCoplanarFaces(face),
        },
        {
          label: "Copy face attributes",
          run: async () => {
            session.selectFace(face);
            await clipboard.copy();
          },
        },
        {
          label: "Paste face attributes here",
          disabled: !!hostedMap && !hostedConnection,
          run: async () => {
            session.selectFace(face);
            await clipboard.paste("original");
          },
        },
      );
      const material = findBrush(session.document, hit.brushId)?.faces.find(
        (candidate) => candidate.id === hit.faceId,
      )?.material;
      if (material)
        underCursor.push({
          label: `Show ${material} in materials`,
          run: () => materialBrowser.setCurrent(material),
        });
    }
  } else if (hit?.entityId) {
    underCursor.push({
      label: "Select point entity",
      run: () =>
        handleViewportPick(hit, { additive: false, expansion: "single" }),
    });
  }
  const selectionActions: ContextAction[] = [
    {
      label: "Focus selection",
      disabled: focusSelectionButton.disabled,
      run: () => focusSelectionButton.click(),
    },
    {
      label: "Copy selection",
      disabled: copySelectionButton.disabled,
      run: () => clipboard.copy(),
    },
    {
      label: "Duplicate selection",
      disabled: duplicateButton.disabled,
      run: () => duplicateButton.click(),
    },
    {
      label: "Hide selection",
      disabled: hideSelectionButton.disabled,
      run: () => hideSelectionButton.click(),
    },
    {
      label: "Isolate selection",
      disabled: isolateSelectionButton.disabled,
      run: () => isolateSelectionButton.click(),
    },
    {
      label: "Delete selection",
      disabled: deleteButton.disabled,
      run: () => deleteButton.click(),
    },
    {
      label: "Show all hidden",
      disabled: showAllButton.disabled,
      run: () => showAllButton.click(),
    },
  ];
  const createActions: ContextAction[] = [
    {
      label: "Paste here",
      disabled: !!hostedMap && !hostedConnection,
      run: () => clipboard.paste("pointer"),
    },
    {
      label: `Place ${pointEntityClassname.value.trim() || "point entity"} here`,
      disabled: !event.pointEntityOrigin || !pointEntityClassname.value.trim(),
      run: () =>
        handlePointEntityPlace({
          viewport: event.viewport,
          origin: event.pointEntityOrigin!,
        }),
    },
  ];
  const sections: ContextSection[] = [
    { label: "Under cursor", actions: underCursor },
    { label: "Selection", actions: selectionActions },
    { label: "Create here", actions: createActions },
  ];
  contextMenu.show(
    event.clientX,
    event.clientY,
    sections,
    canvases[event.viewport],
  );
}

function handlePointEntityPlace(event: EditorPointEntityPlaceEvent) {
  if (!viewportCanEdit()) return;
  const classname = pointEntityClassname.value.trim();
  if (!classname || classname.toLowerCase() === "worldspawn") {
    status.textContent = "Enter a point entity classname";
    return;
  }
  try {
    session.createPointEntity(
      classname,
      event.origin,
      createSequentialIdFactory(`tea-place-${crypto.randomUUID()}`),
      pointEntityDefinition(classname, currentDefinitions()).defaults,
    );
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

function handleBrushDrag(event: EditorBrushDragEvent) {
  if (event.phase === "cancel") {
    dragDuplicateBase = null;
    renderer?.setDocument(session.document, session.selection);
    return;
  }
  if (!viewportCanEdit()) return;
  if (event.delta.every((component) => Math.abs(component) <= Number.EPSILON)) {
    if (event.phase === "commit") {
      dragDuplicateBase = null;
      renderer?.setDocument(session.document, session.selection);
    }
    return;
  }
  try {
    if (event.duplicate) {
      dragDuplicateBase ??= session.createObjectDuplicationCandidate(
        event.selection,
        createSequentialIdFactory(`tea-drag-copy-${crypto.randomUUID()}`),
      );
      if (!dragDuplicateBase) return;
      const candidate = session.translateObjectDuplicationCandidate(
        dragDuplicateBase,
        event.delta,
        textureLockInput.checked,
      );
      if (event.phase === "preview") {
        renderer?.setPreviewDocument(
          candidate.document,
          candidate.selectionAfter,
          [
            ...selectedBrushIds(candidate.selectionAfter),
            ...selectedPointEntityIds(candidate.selectionAfter),
          ],
        );
      } else {
        session.commitDocumentCandidate(candidate);
        dragDuplicateBase = null;
      }
      return;
    }
    const candidate = session.createObjectTranslationCandidate(
      event.selection,
      event.delta,
      textureLockInput.checked,
    );
    if (!candidate) return;
    if (event.phase === "preview") {
      renderer?.setPreviewDocument(candidate.document, event.selection, [
        ...selectedBrushIds(event.selection),
        ...selectedPointEntityIds(event.selection),
      ]);
    } else {
      session.commitDocumentCandidate(candidate);
    }
  } catch (error) {
    dragDuplicateBase = null;
    renderer?.setDocument(session.document, session.selection);
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function saveCurrentMap(): Promise<boolean> {
  if (hostedMap) {
    status.textContent = "Hosted inspection is read only; edit a local copy";
    return false;
  }
  if (!applyWorkingSource()) return false;
  const plan = planMapSave(session.document, mapSourceState);
  if (plan.status === "blocked") {
    status.textContent = `${plan.diagnostics.map(({ message }) => message).join(" ")} Use Export normalized to download a separate copy.`;
    return false;
  }
  const text = plan.text;
  if (!openedFile && !supportsMapSavePicker()) {
    downloadMapCopy(mapName, text);
    status.textContent =
      "Downloaded a copy; browser file saving is unavailable";
    return false;
  }
  try {
    const handle = openedFile ?? (await pickMapSaveFile(mapName));
    if (!handle) return false;
    const fingerprint = await writeMapFile(
      handle,
      text,
      openedFile ? (openedFingerprint ?? undefined) : undefined,
    );
    openedFile = handle;
    openedFingerprint = fingerprint;
    mapName = handle.name;
    savedSource = serializeMap(session.document);
    mapSourceState = rebaseMapSource(session.document, text);
    refreshSource();
    status.textContent = `Saved ${handle.name}`;
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return false;
    }
    status.textContent = error instanceof Error ? error.message : String(error);
    return false;
  }
}

try {
  const draft = await loadEditorDraft();
  if (draft) {
    documentId = draft.documentId;
    mapName = draft.fileName;
    localGame = draft.game ?? "quake";
    const parsed = parseMapSource(draft.committedSource);
    setMap(
      draft.document ?? parsed.document,
      draft.sourceState ?? parsed.source,
    );
    source.value = draft.workingSource;
  } else {
    source.value = serializeMap(session.document);
  }
} catch {
  source.value = serializeMap(session.document);
  status.textContent = "Local recovery is unavailable; download your map";
}
workspace.switchDocument(documentId);
materialBrowser.setMaterials(currentMaterials());
refreshStatus();
scheduleDraftSave();

if (!navigator.gpu) {
  status.textContent = "WebGPU is unavailable · source editing still works";
} else {
  status.textContent = "Initializing WebGPU…";
  try {
    renderer = await EditorSourceRenderer.create({
      canvases,
      document: session.document,
      materials: currentMaterials(),
      referenceScenes: references.scenes(),
      onPick: (value, _viewport, intent) => handleViewportPick(value, intent),
      onBrushDrag: handleBrushDrag,
      onBrushCreate: shapeTool.handleCreate,
      onHullCreate: handleHullCreate,
      onClipPlaneChange: handleClipPlaneChange,
      onSweepDrag: sweepTool.handleDrag,
      onTopologyDrag: topologyTool.handleDrag,
      onTopologySelectionChange: (kind, count, vertices) => {
        topologyTool.selectionChanged(kind, count, vertices);
        transformTool.refresh();
      },
      onTransformDrag: transformTool.handleDrag,
      onTransformPivotDrag: transformTool.handlePivotDrag,
      onPointEntityPlace: handlePointEntityPlace,
      onFaceDrag: faceDrag.handle,
      onFaceTransfer: (event) =>
        handleFaceTransfer(event, {
          session,
          renderer,
          canEdit: viewportCanEdit,
          status: (message) => {
            status.textContent = message;
          },
        }),
      onFaceLasso: (faces, _viewport, ensureSelected) =>
        session.selectFacesWithLasso(faces, ensureSelected),
      onPointerPosition: (pointer) => {
        latestPointer = pointer;
        pasteCursorButton.disabled = hostedMap !== null && !hostedConnection;
        hostedConnection?.publishPointer(pointer);
      },
      onContextMenu: showViewportContextMenu,
      onCameraChange: (event) => {
        if (event.viewport === "perspective")
          fov.cameraChanged(event.camera.fieldOfViewDegrees);
        workspace.cameraChanged(event);
      },
      onRenderRequest: scheduleRender,
      onDeviceLost: (message) => stopSourceRenderer(message),
    });
    if (rendererFailure) {
      stopSourceRenderer(rendererFailure);
    } else {
      fov.applyInitial(renderer);
      visibility.applyRenderer();
      renderer.setTool(
        viewportTool.value as
          | "select"
          | "face"
          | "clip"
          | "hull"
          | "sweep"
          | "vertex"
          | "edge"
          | "rotate"
          | "scale"
          | "shear"
          | "create"
          | "entity",
      );
      renderer.setEntityPlacementBounds(
        pointEntityDefinition(pointEntityClassname.value.trim()).bounds,
      );
      setHostedEditability();
      renderer.focusDocument();
      workspace.applyInitial(renderer);
      renderPresence();
      refreshStatus();
      scheduleRender();
    }
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

window.addEventListener("resize", scheduleRender);
window.addEventListener(
  "pagehide",
  () => {
    persistDraft();
    workspace.flush();
    uvEditorAbort.abort();
    renderer?.dispose();
  },
  { once: true },
);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") persistDraft();
});
source.addEventListener("input", () => {
  refreshCompiledPreview();
  refreshBuildExport();
  if (hostedMap) return;
  status.textContent = "Source has unapplied edits";
  session.select(null);
  scheduleDraftSave();
});

let activeViewportTool = viewportTool.value;

function activateViewportTool(next: string) {
  if (hostedMap && !hostedConnection) {
    next = "select";
  }
  const previous = activeViewportTool;
  viewportTool.value = next;
  activeViewportTool = next;
  renderer?.setTool(
    viewportTool.value as
      | "select"
      | "face"
      | "clip"
      | "hull"
      | "sweep"
      | "vertex"
      | "edge"
      | "rotate"
      | "scale"
      | "shear"
      | "create"
      | "entity",
  );
  if (previous === "sweep" && next !== "sweep") sweepTool.leave();
  refreshClipPreview();
  refreshHullControls();
  topologyTool.refresh();
  shapeTool.refresh();
  transformTool.refresh();
  if (next === "sweep" && previous !== "sweep") sweepTool.enter();
}

viewportTool.addEventListener("change", () =>
  activateViewportTool(viewportTool.value),
);
textureLockInput.addEventListener("change", () => sweepTool.refresh());

for (const [mode, button] of Object.entries(clipModeButtons) as [
  BrushClipMode,
  HTMLButtonElement,
][]) {
  button.addEventListener("click", () => {
    clipMode = mode;
    refreshClipPreview();
  });
}
applyClipButton.addEventListener("click", () => {
  if (!clipCandidate || !viewportCanEdit()) return;
  const candidate = clipCandidate;
  clipCandidate = null;
  clipPlanePoints = null;
  clipPoints = [];
  renderer?.clearClipPlane();
  try {
    session.commitClipCandidate(candidate);
    status.textContent = candidate.label;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    refreshClipPreview();
  }
});
resetClipButton.addEventListener("click", () => renderer?.clearClipPlane());
createHullButton.addEventListener("click", () => {
  if (!hullCandidate || !viewportCanEdit()) return;
  try {
    renderer?.commitHullBrush();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});
discardHullButton.addEventListener("click", () => renderer?.clearHullPoints());

pointEntityClassname.addEventListener("input", () => {
  renderer?.setEntityPlacementBounds(
    pointEntityDefinition(
      pointEntityClassname.value.trim(),
      currentDefinitions(),
    ).bounds,
  );
});

gameProfile.addEventListener("change", () => {
  if (project || hostedMap || !isWorldviewGameProfile(gameProfile.value)) {
    gameProfile.value = activeGame();
    return;
  }
  if (gameProfile.value === localGame) return;
  localGame = gameProfile.value;
  renderer?.setMaterials(currentMaterials());
  materialBrowser.setMaterials(currentMaterials());
  buildGeneration += 1;
  latestBuildExport = null;
  exportStatus.textContent = "";
  clearCompiledPreview();
  refreshBuildExport();
  refreshSelection();
  scheduleDraftSave();
});

document
  .querySelector<HTMLButtonElement>("#new-map")!
  .addEventListener("click", async () => {
    if (!(await mayReplaceMap())) return;
    clearOpenedFile();
    setMap(createEmptyDocument());
  });

document
  .querySelector<HTMLButtonElement>("#example-map")!
  .addEventListener("click", async () => {
    if (!(await mayReplaceMap())) return;
    clearOpenedFile();
    setMap(createStarterDocument());
  });

document
  .querySelector<HTMLButtonElement>("#add-box")!
  .addEventListener("click", () => {
    if (!applyWorkingSource()) return;
    try {
      const ids = createSequentialIdFactory(`tea-${crypto.randomUUID()}`);
      const brush = createBoxBrush(
        [-32, -32, 0],
        [32, 32, 64],
        boxMaterial.value.trim() || "DEV/GRID",
        ids,
      );
      session.commitCreationCandidate(session.createBrushCandidate(brush));
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : String(error);
    }
  });

for (const [operation, button] of Object.entries(csgButtons) as [
  keyof typeof csgButtons,
  HTMLButtonElement,
][]) {
  button.addEventListener("click", () => {
    if (!viewportCanEdit()) return;
    const thickness = csgThickness.valueAsNumber;
    if (
      operation === "hollow" &&
      (!Number.isFinite(thickness) || thickness <= 0)
    ) {
      status.textContent = "Hollow wall thickness must be positive";
      return;
    }
    try {
      const ids = createSequentialIdFactory(
        `tea-csg-${operation}-${crypto.randomUUID()}`,
      );
      const changed =
        operation === "merge"
          ? session.csgConvexMergeSelected(
              ids,
              boxMaterial.value.trim() || undefined,
            )
          : operation === "intersect"
            ? session.csgIntersectSelected(ids)
            : operation === "subtract"
              ? session.csgSubtractSelected(ids)
              : session.csgHollowSelected(thickness, ids);
      status.textContent = changed
        ? `${operation === "merge" ? "Convex merge" : operation[0]!.toUpperCase() + operation.slice(1)} applied · Undo restores the previous brushes`
        : operation === "merge" || operation === "intersect"
          ? "Select at least two brushes"
          : "Select one or more brushes";
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : String(error);
    }
  });
}

groupButtons.create.addEventListener("click", () => {
  if (!viewportCanEdit()) return;
  const name = groupName.value.trim();
  if (!name) {
    status.textContent = "Enter a group name";
    return;
  }
  try {
    session.groupSelected(
      name,
      createSequentialIdFactory(`tea-group-${crypto.randomUUID()}`),
      openGroupId,
    );
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});

groupButtons.rename.addEventListener("click", () => {
  if (!viewportCanEdit()) return;
  const group = selectedEditorGroup(session.document, session.selection);
  const name = groupName.value.trim();
  if (!group || !name) {
    status.textContent = "Select a group and enter a name";
    return;
  }
  try {
    session.renameGroup(group.id, name);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});

groupButtons.open.addEventListener("click", () => {
  const group = selectedEditorGroup(session.document, session.selection);
  if (!group) return;
  openGroupId = group.id;
  session.setEditingGroup(group.id);
  renderer?.setOpenGroupId(group.id);
  session.select(null);
  status.textContent = `Opened ${group.name} · objects outside the group are locked`;
});

function closeOpenGroup(selectGroup: boolean) {
  const group = deriveEditorGroups(session.document).find(
    (candidate) => candidate.id === openGroupId,
  );
  openGroupId = null;
  session.setEditingGroup(null);
  renderer?.setOpenGroupId(null);
  session.select(group && selectGroup ? selectionForEditorGroup(group) : null);
  return group;
}

groupButtons.close.addEventListener("click", () => {
  const group = closeOpenGroup(true);
  status.textContent = group ? `Closed ${group.name}` : "Closed group";
});

groupButtons.linked.addEventListener("click", () => {
  if (!viewportCanEdit()) return;
  try {
    const grid = Number(gridSizeInput.value);
    const groupId = session.linkedDuplicateSelected(
      createSequentialIdFactory(`tea-linked-${crypto.randomUUID()}`),
      [grid, grid, 0],
      textureLockInput.checked,
    );
    status.textContent = groupId
      ? "Created linked duplicate · edits to either opened group update both"
      : "Select a closed group to make a linked duplicate";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});

groupButtons.unlink.addEventListener("click", () => {
  if (!viewportCanEdit()) return;
  const group = selectedEditorGroup(session.document, session.selection);
  if (!group) return;
  try {
    if (session.unlinkGroup(group.id)) {
      status.textContent = `Unlinked ${group.name} · its contents are independent`;
    }
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});

groupButtons.ungroup.addEventListener("click", () => {
  if (!viewportCanEdit()) return;
  const group = selectedEditorGroup(session.document, session.selection);
  if (!group) return;
  try {
    session.ungroupSelected(group.id);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});

layerSelect.addEventListener("change", () => {
  selectedLayerId = layerSelect.value || null;
  refreshLayers();
});

function editLayer(action: () => void) {
  if (!viewportCanEdit()) {
    refreshLayers();
    return;
  }
  try {
    action();
    refreshLayers();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    refreshLayers();
  }
}

layerButtons.create.addEventListener("click", () => {
  const name = newLayerName.value.trim();
  if (!name) {
    status.textContent = "Enter a layer name";
    return;
  }
  editLayer(() => {
    if (openGroupId) closeOpenGroup(false);
    selectedLayerId = session.createLayer(
      name,
      createSequentialIdFactory(`tea-layer-${crypto.randomUUID()}`),
    );
  });
});

layerButtons.rename.addEventListener("click", () => {
  const name = layerName.value.trim();
  if (!selectedLayerId || !name) {
    status.textContent = "Select a custom layer and enter a name";
    return;
  }
  editLayer(() => session.renameLayer(selectedLayerId!, name));
});

layerButtons.activate.addEventListener("click", () => {
  if (openGroupId) closeOpenGroup(false);
  try {
    session.setActiveLayer(selectedLayerId);
    refreshLayers();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});

layerButtons.move.addEventListener("click", () => {
  editLayer(() => {
    if (!session.moveSelectedToLayer(selectedLayerId)) {
      status.textContent = "Selection is already in this layer";
    }
  });
});

layerButtons.select.addEventListener("click", () => {
  session.selectAllInLayer(selectedLayerId);
});

layerButtons.isolate.addEventListener("click", () => {
  editLayer(() => session.isolateLayer(selectedLayerId));
});

layerButtons.remove.addEventListener("click", () => {
  if (!selectedLayerId) return;
  editLayer(() => session.removeLayer(selectedLayerId!));
});

for (const [direction, button] of [
  [-1, layerButtons.up],
  [1, layerButtons.down],
] as const) {
  button.addEventListener("click", () => {
    if (!selectedLayerId) return;
    editLayer(() => session.reorderLayer(selectedLayerId!, direction));
  });
}

for (const [flag, checkbox] of Object.entries(layerFlags) as [
  keyof typeof layerFlags,
  HTMLInputElement,
][]) {
  checkbox.addEventListener("change", () => {
    editLayer(() =>
      session.setLayerFlag(selectedLayerId, flag, checkbox.checked),
    );
  });
}

for (const [button, flag, value] of [
  [layerButtons.showAll, "hidden", false],
  [layerButtons.hideAll, "hidden", true],
  [layerButtons.unlockAll, "locked", false],
  [layerButtons.lockAll, "locked", true],
] as const) {
  button.addEventListener("click", () => {
    editLayer(() => session.setAllLayersFlag(flag, value));
  });
}

document
  .querySelector<HTMLButtonElement>("#add-point-entity")!
  .addEventListener("click", () => {
    if (!applyWorkingSource()) return;
    const classname = document
      .querySelector<HTMLInputElement>("#point-entity-classname")!
      .value.trim();
    const coordinates = (["x", "y", "z"] as const).map(
      (axis) =>
        document.querySelector<HTMLInputElement>(`#point-origin-${axis}`)!
          .valueAsNumber,
    );
    if (!classname || classname.toLowerCase() === "worldspawn") {
      status.textContent = "Enter a point entity classname";
      return;
    }
    if (coordinates.some((value) => !Number.isFinite(value))) {
      status.textContent = "Point origin needs three finite coordinates";
      return;
    }
    try {
      session.createPointEntity(
        classname,
        [coordinates[0]!, coordinates[1]!, coordinates[2]!],
        createSequentialIdFactory(`tea-${crypto.randomUUID()}`),
        pointEntityDefinition(classname, currentDefinitions()).defaults,
      );
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : String(error);
    }
  });

updatePointButton.addEventListener("click", () => {
  if (!applyWorkingSource()) return;
  const entityId = selectedPointEntityIds(session.selection)[0];
  if (!entityId) return;
  const classname = pointClassname.value.trim();
  const coordinates = pointOrigin.value.trim().split(/\s+/).map(Number);
  if (!classname || classname.toLowerCase() === "worldspawn") {
    status.textContent = "Enter a point entity classname";
    return;
  }
  if (
    coordinates.length !== 3 ||
    coordinates.some((value) => !Number.isFinite(value))
  ) {
    status.textContent = "Origin needs three finite coordinates";
    return;
  }
  try {
    session.setEntityProperty(entityId, "classname", classname);
    session.setEntityProperty(entityId, "origin", coordinates.join(" "));
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});

selectedMaterial.addEventListener("input", () => {
  applyMaterialButton.disabled =
    selectedMaterial.disabled || !selectedMaterial.value.trim();
});

function applySelectedMaterial() {
  if (!applyWorkingSource() || (hostedMap && !hostedConnection)) return;
  const material = selectedMaterial.value.trim();
  if (!material) return;
  try {
    if (!session.applyMaterial(material)) {
      status.textContent = "Select a brush or face with a different material";
    }
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

selectedFace.addEventListener("change", () => {
  const brushId = session.selection?.brushId;
  if (!brushId || !selectedFace.value) {
    if (brushId) session.select({ brushId });
    return;
  }
  const face = findBrush(session.document, brushId)?.faces.find(
    (candidate) => candidate.id === selectedFace.value,
  );
  if (face) session.select({ brushId, faceId: face.id });
});

for (const [operation, button] of Object.entries(faceGeometryButtons) as [
  keyof typeof faceGeometryButtons,
  HTMLButtonElement,
][]) {
  button.addEventListener("click", () => {
    if (!viewportCanEdit()) return;
    const distance = faceDistance.valueAsNumber;
    if (!Number.isFinite(distance) || Math.abs(distance) <= Number.EPSILON) {
      status.textContent = "Enter a non-zero face distance";
      return;
    }
    try {
      const changed =
        operation === "extrude"
          ? session.extrudeSelectedFace(distance)
          : operation === "split"
            ? session.splitSelectedFace(
                distance,
                createSequentialIdFactory(
                  `tea-face-split-${crypto.randomUUID()}`,
                ),
              )
            : session.stampSelectedFace(
                distance,
                createSequentialIdFactory(
                  `tea-face-stamp-${crypto.randomUUID()}`,
                ),
                textureLockInput.checked,
              );
      if (!changed) status.textContent = "Select a face for this operation";
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : String(error);
    }
  });
}

applyMaterialButton.addEventListener("click", applySelectedMaterial);
selectedMaterial.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  applySelectedMaterial();
});

alignmentButton.addEventListener("click", () => {
  if (!applyWorkingSource() || (hostedMap && !hostedConnection)) return;
  const width = textureWidth.value.trim();
  const height = textureHeight.value.trim();
  if ((width || height) && (!width || !height)) {
    status.textContent = "Enter both texture dimensions";
    return;
  }
  const manualSize =
    width && height
      ? ([textureWidth.valueAsNumber, textureHeight.valueAsNumber] as const)
      : null;
  if (
    manualSize &&
    manualSize.some((value) => !Number.isInteger(value) || value <= 0)
  ) {
    status.textContent = "Texture dimensions must be positive integers";
    return;
  }
  const options: FaceTextureAlignmentOptions = {
    ...(manualSize ? { textureSize: manualSize } : {}),
    textureSizeForMaterial: (token) => {
      const material = currentMaterials().find(
        (candidate) => candidate.name.toLowerCase() === token.toLowerCase(),
      );
      return material
        ? [
            material.logicalWidth ?? material.width,
            material.logicalHeight ?? material.height,
          ]
        : null;
    },
    direction: alignmentReverse.checked ? -1 : 1,
    fitMode: alignmentSubdivide.checked ? "subdivide" : "repeat",
  };
  try {
    if (
      !session.alignTexture(
        alignmentOperation.value as FaceTextureAlignmentOperation,
        options,
      )
    ) {
      status.textContent = "Select a brush or face to align its texture";
    }
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});

for (const [field, input] of Object.entries(projectionInputs) as [
  FaceTextureProjectionField,
  HTMLInputElement,
][]) {
  input.addEventListener("change", () => {
    if (!applyWorkingSource() || (hostedMap && !hostedConnection)) return;
    const value = input.valueAsNumber;
    if (!Number.isFinite(value)) {
      status.textContent = "Enter a finite projection value";
      return;
    }
    try {
      session.setSelectedTextureProjectionField(field, value);
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : String(error);
      refreshSelection();
    }
  });
}

surfaceValue.addEventListener("change", () => {
  if (!applyWorkingSource() || (hostedMap && !hostedConnection)) return;
  try {
    session.setSelectedSurfaceValue(surfaceValue.valueAsNumber);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    refreshSelection();
  }
});

propertyKey.addEventListener("input", refreshPropertyActions);

function commitEntityProperty(key: string, next: string | null) {
  let value = next;
  if (!inspectedEntityId || !key || key.startsWith("_tb_")) return;
  if (key === "classname" && value === null) return;
  if (!applyWorkingSource()) return;
  const entity = session.document.entities.find(
    (candidate) => candidate.id === inspectedEntityId,
  );
  if (!entity) return;
  const isPointEntity =
    entity.primitives.length === 0 &&
    entity.properties.classname?.toLowerCase() !== "worldspawn";
  if (key === "classname" && value !== null) {
    value = value.trim();
    if (!value || (isPointEntity && value.toLowerCase() === "worldspawn")) {
      status.textContent = "Enter a valid entity classname";
      return;
    }
  }
  if (key === "origin" && isPointEntity && value !== null) {
    const coordinates = value.trim().split(/\s+/).map(Number);
    if (
      coordinates.length !== 3 ||
      coordinates.some((coordinate) => !Number.isFinite(coordinate))
    ) {
      status.textContent = "Origin needs three finite coordinates";
      return;
    }
    value = coordinates.join(" ");
  }
  try {
    session.setEntityProperty(inspectedEntityId, key, value);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

savePropertyButton.addEventListener("click", () => {
  commitEntityProperty(propertyKey.value.trim(), propertyValue.value);
});

removePropertyButton.addEventListener("click", () => {
  const key = propertyKey.value.trim();
  if (
    !inspectedEntityId ||
    !key ||
    key === "classname" ||
    key.startsWith("_tb_")
  )
    return;
  commitEntityProperty(key, null);
  propertyKey.value = "";
  propertyValue.value = "";
  refreshPropertyActions();
});

deleteButton.addEventListener("click", () => {
  if (!applyWorkingSource()) return;
  try {
    session.deleteSelected();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});

duplicateButton.addEventListener("click", () => {
  if (!applyWorkingSource()) return;
  try {
    session.duplicateSelected(
      createSequentialIdFactory(`tea-${crypto.randomUUID()}`),
      [16, 16, 0],
    );
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});

function selectObjects(mode: "all" | "invert") {
  if (!applyWorkingSource()) return;
  const selection =
    mode === "all"
      ? session.selectAllEditable()
      : session.invertObjectSelection();
  const count =
    selectedBrushIds(selection).length +
    selectedPointEntityIds(selection).length;
  status.textContent =
    mode === "all"
      ? count > 0
        ? `Selected ${count} visible, unlocked objects`
        : "No editable objects to select"
      : count > 0
        ? `Selection inverted · ${count} objects selected`
        : "Selection cleared";
}

document
  .querySelector<HTMLButtonElement>("#select-all")!
  .addEventListener("click", () => selectObjects("all"));
document
  .querySelector<HTMLButtonElement>("#invert-selection")!
  .addEventListener("click", () => selectObjects("invert"));
hideSelectionButton.addEventListener("click", () => {
  if (!hostedMap && applyWorkingSource()) session.hideSelected();
});
isolateSelectionButton.addEventListener("click", () => {
  if (!hostedMap && applyWorkingSource()) session.isolateSelected();
});
showAllButton.addEventListener("click", () => {
  if (!hostedMap && applyWorkingSource()) session.showAll();
});
focusSelectionButton.addEventListener("click", () => {
  if (!renderer?.focusSelection())
    status.textContent = "Select an object to focus";
  else scheduleRender();
});
lockSelectionButton.addEventListener("click", () => {
  if (!hostedMap && applyWorkingSource()) session.lockSelected();
});
unlockAllButton.addEventListener("click", () => {
  if (!hostedMap && applyWorkingSource()) session.unlockAll();
});
function repeatRecordedCommands() {
  if (!viewportCanEdit()) return;
  try {
    if (!session.repeatLastCommands()) {
      status.textContent = "Record object commands before repeating them";
    }
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}
repeatCommandsButton.addEventListener("click", repeatRecordedCommands);
clearRepeatCommandsButton.addEventListener("click", () => {
  session.clearRepeatableCommands();
  refreshSelection();
});
for (const button of nudgeButtons) {
  button.addEventListener("click", () => {
    if (!viewportCanEdit()) return;
    const axis = button.dataset.nudgeAxis;
    const index = axis === "X" ? 0 : axis === "Y" ? 1 : 2;
    const grid = Number(gridSizeInput.value);
    const direction = Number(button.dataset.nudgeDirection);
    const delta: [number, number, number] = [0, 0, 0];
    delta[index] = grid * direction;
    try {
      if (!session.translateSelected(delta, textureLockInput.checked)) {
        status.textContent = "Select an object to nudge";
      }
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : String(error);
    }
  });
}
snapToGridButton.addEventListener("click", () => {
  if (hostedMap || !applyWorkingSource()) return;
  try {
    if (
      !session.snapSelectionToGrid(
        Number(gridSizeInput.value),
        createSequentialIdFactory(`tea-grid-${crypto.randomUUID()}`),
        textureLockInput.checked,
      )
    ) {
      status.textContent = "Selection is already on the grid";
    }
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});
copySelectionButton.addEventListener("click", () => {
  void clipboard.copy();
});
pasteCursorButton.addEventListener("click", () => {
  void clipboard.paste("pointer");
});
pasteOriginalButton.addEventListener("click", () => {
  void clipboard.paste("original");
});

function textEditingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

window.addEventListener("copy", (event) => {
  if (textEditingTarget(event.target) || !session.selection) return;
  const text = clipboard.copyText();
  if (!text) return;
  event.preventDefault();
  event.clipboardData?.setData("text/plain", text);
});
window.addEventListener("paste", (event) => {
  if (textEditingTarget(event.target) || (hostedMap && !hostedConnection))
    return;
  const text = event.clipboardData?.getData("text/plain");
  if (!text?.trim()) return;
  event.preventDefault();
  clipboard.pasteText(text, latestPointer ? "pointer" : "original");
});

makeEntityButton.addEventListener("click", () => {
  if (!applyWorkingSource()) return;
  const classname = document
    .querySelector<HTMLInputElement>("#brush-entity-classname")!
    .value.trim();
  if (!classname) {
    status.textContent = "Enter a brush entity classname";
    return;
  }
  if (classname.toLowerCase() === "worldspawn") {
    status.textContent = "Use Make structural for world geometry";
    return;
  }
  try {
    const defaults = Object.fromEntries(
      currentDefinitions()
        ?.find(classname)
        ?.properties.flatMap((property) =>
          property.defaultValue === undefined
            ? []
            : [[property.key, property.defaultValue]],
        ) ?? [],
    );
    session.createBrushEntity(
      classname,
      createSequentialIdFactory(`tea-${crypto.randomUUID()}`),
      defaults,
    );
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});

makeStructuralButton.addEventListener("click", () => {
  if (!applyWorkingSource()) return;
  try {
    session.makeSelectedStructural();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});

moveButton.addEventListener("click", () => {
  if (!applyWorkingSource()) return;
  const axes = ["x", "y", "z"] as const;
  const delta = axes.map((axis) =>
    Number(document.querySelector<HTMLInputElement>(`#move-${axis}`)!.value),
  );
  if (delta.some((value) => !Number.isFinite(value))) {
    status.textContent = "Move coordinates must be finite numbers";
    return;
  }
  try {
    session.translateSelected(
      [delta[0]!, delta[1]!, delta[2]!],
      textureLockInput.checked,
    );
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});

rotateButton.addEventListener("click", () => {
  if (!applyWorkingSource()) return;
  const pivot = transformTool.pivot() ?? selectedBrushPivot();
  const axis = Number(
    document.querySelector<HTMLSelectElement>("#rotate-axis")!.value,
  ) as TransformAxis;
  const input = document.querySelector<HTMLInputElement>("#rotate-degrees")!;
  if (
    !pivot ||
    !input.checkValidity() ||
    !Number.isFinite(input.valueAsNumber)
  ) {
    status.textContent = "Select objects and enter a finite rotation";
    return;
  }
  try {
    const candidate = session.createObjectRotationCandidate(
      session.selection!,
      [...pivot],
      axis,
      input.valueAsNumber,
      textureLockInput.checked,
      transformTool.updateAngles(),
    );
    if (candidate) session.commitDocumentCandidate(candidate);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});

scaleButton.addEventListener("click", () => {
  if (!applyWorkingSource()) return;
  const pivot = transformTool.pivot() ?? selectedBrushPivot();
  const axes = ["x", "y", "z"] as const;
  const inputs = axes.map((axis) =>
    document.querySelector<HTMLInputElement>(`#scale-${axis}`)!,
  );
  const factors = inputs.map((input) => input.valueAsNumber);
  if (
    !pivot ||
    inputs.some((input) => !input.checkValidity()) ||
    factors.some((value) => !Number.isFinite(value) || value <= 0)
  ) {
    status.textContent = "Select objects and enter positive scale factors";
    return;
  }
  try {
    const candidate = session.createObjectScaleCandidate(
      session.selection!,
      [...pivot],
      [factors[0]!, factors[1]!, factors[2]!],
      textureLockInput.checked,
      transformTool.updateAngles(),
    );
    if (candidate) session.commitDocumentCandidate(candidate);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});

shearButton.addEventListener("click", () => {
  if (!viewportCanEdit()) return;
  const bounds = selectedObjectBounds();
  const sourceAxis = Number(shearSourceAxis.value) as TransformAxis;
  const targetAxis = Number(shearTargetAxis.value) as TransformAxis;
  const offset = shearOffset.valueAsNumber;
  const span = bounds ? bounds.max[sourceAxis] - bounds.min[sourceAxis] : 0;
  if (
    !bounds ||
    sourceAxis === targetAxis ||
    !shearOffset.checkValidity() ||
    !Number.isFinite(offset) ||
    span <= 1e-6
  ) {
    status.textContent =
      "Select objects and enter distinct axes with a finite offset";
    return;
  }
  try {
    const candidate = session.createObjectShearCandidate(
      session.selection!,
      transformTool.pivot() ?? bounds.min,
      sourceAxis,
      targetAxis,
      offset / span,
      textureLockInput.checked,
      transformTool.updateAngles(),
    );
    if (candidate) session.commitDocumentCandidate(candidate);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});

for (const [axis, button] of flipButtons.entries()) {
  button.addEventListener("click", () => {
    if (!viewportCanEdit()) return;
    const bounds = selectedObjectBounds();
    if (!bounds) {
      status.textContent = "Select objects to mirror";
      return;
    }
    const grid = Number(gridSizeInput.value);
    const pivot = ([0, 1, 2] as const).map(
      (component) =>
        Math.round(
          (bounds.min[component] + bounds.max[component]) / (2 * grid),
        ) * grid,
    ) as [number, number, number];
    try {
      session.flipSelected(
        pivot,
        axis as TransformAxis,
        textureLockInput.checked,
      );
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : String(error);
    }
  });
}

async function runHistoryAction(action: "undo" | "redo") {
  if (renderer?.hullHistoryActive) {
    if (action === "undo") renderer.undoHull();
    else renderer.redoHull();
    refreshHullControls();
    return;
  }
  if (hostedMap) {
    try {
      await hostedConnection?.[action]();
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : String(error);
    }
    return;
  }
  if (applyWorkingSource()) session[action]();
}

undoButton.addEventListener("click", () => {
  void runHistoryAction("undo");
});
redoButton.addEventListener("click", () => {
  void runHistoryAction("redo");
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && uvEditor.cancel()) {
    event.preventDefault();
    return;
  }
  if (
    (viewportTool.value === "vertex" || viewportTool.value === "edge") &&
    !textEditingTarget(event.target)
  ) {
    if (event.key === "Escape") {
      event.preventDefault();
      topologyTool.escape();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      topologyTool.deleteHandles();
      return;
    }
    if (
      event.key.startsWith("Arrow") &&
      topologyTool.nudge(event.key, event.altKey)
    ) {
      event.preventDefault();
      return;
    }
  }
  if (viewportTool.value === "sweep" && !textEditingTarget(event.target)) {
    if (event.key === "Escape") {
      event.preventDefault();
      sweepTool.escape();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      sweepTool.apply();
      return;
    }
  }
  if (viewportTool.value === "hull" && !textEditingTarget(event.target)) {
    if (event.key === "Escape" && renderer?.clearHullPoints()) {
      event.preventDefault();
      return;
    }
    if (event.key === "Enter" && hullCandidate) {
      event.preventDefault();
      createHullButton.click();
      return;
    }
  }
  if (!textEditingTarget(event.target) && event.key === "Home") {
    event.preventDefault();
    focusSelectionButton.click();
    return;
  }
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  if (textEditingTarget(event.target)) return;
  if (event.shiftKey && event.key.toLowerCase() === "r") {
    event.preventDefault();
    repeatRecordedCommands();
    return;
  }
  if (event.key.toLowerCase() === "a") {
    event.preventDefault();
    selectObjects(event.shiftKey ? "invert" : "all");
    return;
  }
  const undo = event.key.toLowerCase() === "z" && !event.shiftKey;
  const redo =
    (event.key.toLowerCase() === "z" && event.shiftKey) ||
    event.key.toLowerCase() === "y";
  if (!undo && !redo) return;
  event.preventDefault();
  void runHistoryAction(undo ? "undo" : "redo");
});

async function newerLocalRecovery(
  identity: string,
  file: File,
  diskSource: string,
): Promise<EditorVersion | null> {
  const recovery = await latestEditorVersion(identity).catch(() => null);
  if (
    !recovery ||
    recovery.createdAt <= file.lastModified ||
    (recovery.committedSource === diskSource &&
      recovery.workingSource === diskSource)
  ) {
    return null;
  }
  return window.confirm(
    `A newer recovery version exists for ${file.name}. Open it as a local copy? The disk file will stay unchanged.`,
  )
    ? recovery
    : null;
}

function openRecoveredLocalCopy(recovery: EditorVersion, fileName: string) {
  setProject(null);
  localGame = recovery.game ?? "quake";
  openedFile = null;
  openedFingerprint = null;
  mapName = fileName;
  documentId = crypto.randomUUID();
  savedSource = emptySource;
  const parsed = parseMapSource(recovery.committedSource);
  setMap(
    recovery.document ?? parsed.document,
    recovery.sourceState ?? parsed.source,
  );
  source.value = recovery.workingSource;
  scheduleDraftSave();
  status.textContent = `Restored a local copy of ${fileName} · save to a file when ready`;
}

async function openMapFile(file: File, handle: MapFileHandle | null) {
  try {
    const text = await file.text();
    const parsed = parseMapSource(text);
    const document = parsed.document;
    if (!(await mayReplaceMap())) return;
    persistDraft();
    leaveHostedMap();
    const identity = `file:${file.name.toLowerCase()}:${mapSourceFingerprint(text)}`;
    const diskSource = serializeMap(document);
    const recovery = await newerLocalRecovery(identity, file, diskSource);
    if (recovery) {
      openRecoveredLocalCopy(recovery, file.name);
      return;
    }
    setProject(null);
    openedFile = handle;
    openedFingerprint = handle ? mapSourceFingerprint(text) : null;
    mapName = file.name;
    documentId = identity;
    savedSource = diskSource;
    setMap(document, parsed.source);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

document
  .querySelector<HTMLButtonElement>("#open-map-button")!
  .addEventListener("click", async () => {
    if (!supportsMapOpenPicker()) {
      fileInput.click();
      return;
    }
    try {
      const handle = await pickMapFile();
      if (handle) await openMapFile(await handle.getFile(), handle);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      status.textContent =
        error instanceof Error ? error.message : String(error);
    }
  });

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (file) await openMapFile(file, null);
});

async function openProjectDirectory(
  directory: MapDirectoryHandle,
  recentId?: string,
  lastMapPath?: string,
) {
  const opened = await openMapProject(directory);
  const bindings = await openProjectBuildBindings(directory).catch(() => null);
  if (!(await mayReplaceMap())) return;
  persistDraft();
  leaveHostedMap();
  openedFile = null;
  openedFingerprint = null;
  mapName = "tea-map.map";
  documentId = crypto.randomUUID();
  savedSource = emptySource;
  setProject(opened);
  setMap(createEmptyDocument());
  projectBindings = bindings;
  projectRecoveryScope = bindings?.scopeId ?? crypto.randomUUID();
  loadCurrentExportSettings();
  activeProjectPath = null;
  projectMaps.replaceChildren();
  projectMaps.add(new Option(`${opened.manifest.name} · choose a map`, ""));
  for (const entry of opened.maps) {
    projectMaps.add(new Option(entry.path, entry.path));
  }
  projectMaps.disabled = opened.maps.length === 0;
  activeRecentProjectId =
    (
      await rememberRecentProject(directory, opened.manifest.name).catch(
        () => null,
      )
    )?.id ??
    recentId ??
    null;
  status.textContent = `${opened.manifest.name}: ${opened.maps.length} maps${bindings ? "" : " · build profile choices will not be remembered"}`;
  projectMapSelector.show(opened.manifest.name, opened.maps, lastMapPath);
}

async function openRecentProject(id: string, requestPermission: boolean) {
  const current = await recentProject(id);
  if (!current) throw new Error("This recent project is unavailable");
  const permission =
    (await current.handle.queryPermission?.({ mode: "readwrite" })) ??
    "granted";
  if (permission !== "granted") {
    if (!requestPermission)
      throw new Error("Choose Recent projects to grant folder permission");
    const granted = await current.handle.requestPermission?.({
      mode: "readwrite",
    });
    if (granted !== "granted")
      throw new Error("Project folder permission was not granted");
  }
  await openProjectDirectory(current.handle, current.id, current.lastMapPath);
}

async function renderRecentProjects() {
  const recents = await listRecentProjects();
  recentProjectList.replaceChildren();
  if (!recents.length) {
    recentProjectList.textContent = "No recent project folders";
    return;
  }
  for (const record of recents) {
    const button = document.createElement("button");
    button.type = "button";
    const name = document.createElement("strong");
    name.textContent = record.name;
    const detail = document.createElement("small");
    detail.textContent = record.lastMapPath ?? record.handle.name;
    button.append(name, detail);
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await openRecentProject(record.id, true);
        recentProjects.open = false;
      } catch (error) {
        status.textContent =
          error instanceof Error ? error.message : String(error);
      } finally {
        button.disabled = false;
      }
    });
    recentProjectList.append(button);
  }
}

recentProjects.addEventListener("toggle", () => {
  if (recentProjects.open)
    void renderRecentProjects().catch((error: unknown) => {
      recentProjectList.textContent =
        error instanceof Error ? error.message : String(error);
    });
});

document
  .querySelector<HTMLButtonElement>("#open-project")!
  .addEventListener("click", async () => {
    if (!supportsProjectPicker()) {
      status.textContent =
        "This browser cannot open project folders; open a .map file instead";
      return;
    }
    try {
      const directory = await pickProjectDirectory();
      if (directory) await openProjectDirectory(directory);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      status.textContent =
        error instanceof Error ? error.message : String(error);
    }
  });

projectMaps.addEventListener("change", async () => {
  const path = projectMaps.value;
  const previous = activeProjectPath ?? "";
  const entry = project?.maps.find((projectMap) => projectMap.path === path);
  if (!entry) {
    projectMaps.value = previous;
    return;
  }
  if (path === activeProjectPath) return;
  try {
    const file = await entry.handle.getFile();
    const text = await file.text();
    const parsed = parseMapSource(text);
    const document = parsed.document;
    if (!(await mayReplaceMap())) {
      projectMaps.value = previous;
      return;
    }
    persistDraft();
    leaveHostedMap();
    const identity = `project:${projectRecoveryScope}:${path}`;
    const diskSource = serializeMap(document);
    const recovery = await newerLocalRecovery(identity, file, diskSource);
    if (recovery) {
      openRecoveredLocalCopy(recovery, entry.handle.name);
      return;
    }
    openedFile = entry.handle;
    openedFingerprint = mapSourceFingerprint(text);
    mapName = entry.handle.name;
    savedSource = diskSource;
    activeProjectPath = path;
    documentId = identity;
    setMap(document, parsed.source);
    projectMapSelector.hide();
    if (activeRecentProjectId)
      void rememberRecentProjectMap(activeRecentProjectId, path).catch(
        () => {},
      );
  } catch (error) {
    projectMaps.value = previous;
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});

document
  .querySelector<HTMLButtonElement>("#apply-source")!
  .addEventListener("click", () => {
    applyWorkingSource();
  });

document
  .querySelector<HTMLButtonElement>("#save-map")!
  .addEventListener("click", saveCurrentMap);

includeBuildSource.addEventListener("change", () => {
  configureExportSettings({ includeSource: includeBuildSource.checked });
});
exportAfterBuild.addEventListener("change", () => {
  configureExportSettings({ afterBuild: exportAfterBuild.checked });
});
chooseExportDirectory.addEventListener("click", async () => {
  const scopeId = exportSettings.scopeId;
  try {
    const directory = await pickExportDirectory();
    if (scopeId === exportSettings.scopeId)
      configureExportSettings({ directory });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    exportStatus.textContent =
      error instanceof Error ? error.message : String(error);
  }
});
useExportDownloads.addEventListener("click", () => {
  configureExportSettings({ directory: null });
});

async function exportLatestBuild(settings: ExportSettings): Promise<void> {
  const latest = latestBuildExport;
  if (!latest || !isBuildExportCurrent(latest)) {
    throw new Error("The map changed; build it again before exporting");
  }
  if (exportBusy) return;
  exportBusy = true;
  refreshBuildExport();
  try {
    exportStatus.textContent = "Packaging build…";
    const file = await packageBuildExport(latest.input, settings.includeSource);
    if (!isBuildExportCurrent(latest)) {
      throw new Error("The map changed while packaging the export");
    }
    if (settings.directory) await writeBuildExport(settings.directory, file);
    else downloadBuildFile(file);
    exportStatus.textContent = settings.directory
      ? `Exported ${settings.directory.name}/${file.name}`
      : `Downloaded ${file.name}`;
  } finally {
    exportBusy = false;
    refreshBuildExport();
  }
}

buildButton.addEventListener("click", async () => {
  if (!applyWorkingSource()) return;
  const selected = project?.manifest.buildProfiles.find(
    (profile) => profile.id === buildProfile.value,
  );
  const quality =
    selected?.quality ?? (buildProfile.value === "final" ? "final" : "preview");
  if (hostedMap) {
    const map = hostedMap;
    const document = session.document;
    const sourceAtStart = source.value;
    const generation = ++buildGeneration;
    hostedBuildBusy = true;
    buildButton.disabled = true;
    buildDetails.hidden = true;
    buildStatus.textContent = `Checking hosted ${quality} build…`;
    try {
      if ((await new IndexedDbCollaborationOutbox().pending(map.id)).length > 0)
        throw new Error("Wait for hosted edits to sync before building");
      const result = await hostedBuildControls!.build(quality);
      if (generation !== buildGeneration || hostedMap?.id !== map.id) return;
      buildOutput.textContent = [
        ...(result.result?.diagnostics ?? []).map(
          (entry) => `${entry.severity}: ${entry.stage}: ${entry.message}`,
        ),
        ...(result.result?.logs ?? []).map(
          (entry) => `${entry.stage}:\n${entry.text}`,
        ),
        ...(result.result?.error ? [result.result.error] : []),
      ].join("\n\n");
      buildDetails.hidden = buildOutput.textContent.length === 0;
      const bsp = result.result?.artifacts?.find(
        (artifact) => artifact.kind === "bsp",
      );
      if (result.status !== "succeeded" || !bsp) {
        buildStatus.textContent = "Hosted build failed; see build messages";
      } else if (
        result.mapVersion === hostedMap.mapVersion &&
        session.document === document &&
        source.value === sourceAtStart
      ) {
        buildStatus.textContent = "Hosted build succeeded · loading preview";
        installCompiledPreview(
          { bsp: hostedBuildArtifactPath(map.id, result.id, bsp.sha256) },
          document,
          sourceAtStart,
        );
      } else {
        buildStatus.textContent =
          "Hosted build succeeded for an earlier map version; use build history to download it";
      }
    } catch (error) {
      if (generation === buildGeneration && hostedMap?.id === map.id)
        buildStatus.textContent =
          error instanceof Error ? error.message : String(error);
    } finally {
      if (generation === buildGeneration) {
        hostedBuildBusy = false;
        setHostedEditability();
      }
    }
    return;
  }
  const document = session.document;
  const sourceAtStart = source.value;
  const projectAtStart = project;
  const gameAtStart = activeGame();
  const bindingsAtStart = projectBindings;
  const preferredProfileId =
    selected && bindingsAtStart?.preferred(selected.id);
  const nameAtStart = mapName;
  const settingsAtStart = exportSettings;
  const autoExport = settingsAtStart.afterBuild;
  const generation = ++buildGeneration;
  latestBuildExport = null;
  exportStatus.textContent = "";
  refreshBuildExport();
  buildButton.disabled = true;
  buildStatus.textContent = `Building ${quality}…`;
  buildDetails.hidden = true;
  try {
    const { result, profileId, previewSource, exportInput } = await buildMap({
      document,
      mapName: nameAtStart,
      project: projectAtStart,
      quality,
      game: gameAtStart,
      ...(preferredProfileId ? { preferredProfileId } : {}),
    });
    buildOutput.textContent = [
      ...result.diagnostics.map(
        (entry) => `${entry.severity}: ${entry.stage}: ${entry.message}`,
      ),
      ...result.logs.map((entry) => `${entry.stage}:\n${entry.text}`),
    ].join("\n\n");
    buildDetails.hidden = buildOutput.textContent.length === 0;
    if (selected && bindingsAtStart && project === projectAtStart) {
      try {
        await bindingsAtStart.remember(selected.id, profileId);
      } catch {
        buildOutput.textContent +=
          "\n\nBuild profile choice could not be saved in this browser";
        buildDetails.hidden = false;
      }
    }
    if (
      session.document !== document ||
      project !== projectAtStart ||
      activeGame() !== gameAtStart ||
      mapName !== nameAtStart ||
      source.value !== sourceAtStart
    ) {
      buildStatus.textContent =
        "Build finished; map changed, so result was not downloaded";
    } else if (
      result.status === "succeeded" &&
      result.artifacts.some((artifact) => artifact.kind === "bsp")
    ) {
      if (!autoExport) downloadBsp(result);
      const buildOutcome = autoExport ? "Build succeeded" : "BSP downloaded";
      buildStatus.textContent = `${buildOutcome} · ${Math.round(result.elapsedMilliseconds / 1000)}s`;
      if (exportInput) {
        exportStatus.textContent = "Preparing bundle…";
        if (previewSource) {
          buildStatus.textContent += " · preparing preview resources";
        }
        void prepareBuildExport(exportInput)
          .then(async (prepared) => {
            if (
              generation !== buildGeneration ||
              session.document !== document ||
              source.value !== sourceAtStart ||
              project !== projectAtStart ||
              activeGame() !== gameAtStart ||
              mapName !== nameAtStart
            ) {
              return;
            }
            latestBuildExport = {
              input: prepared,
              document,
              sourceText: sourceAtStart,
              project: projectAtStart,
              name: nameAtStart,
              game: gameAtStart,
            };
            const preparedBuild = latestBuildExport;
            exportStatus.textContent = "Bundle ready";
            refreshBuildExport();
            if (previewSource) {
              buildStatus.textContent = `${buildOutcome} · loading compiled preview`;
              installCompiledPreview(
                previewSourceWithExportAssets(previewSource, prepared),
                document,
                sourceAtStart,
              );
            }
            if (autoExport) {
              try {
                await exportLatestBuild(settingsAtStart);
              } catch (error) {
                if (!isBuildExportCurrent(preparedBuild)) return;
                downloadBsp(result);
                buildStatus.textContent =
                  "BSP downloaded · automatic export unavailable";
                exportStatus.textContent =
                  error instanceof Error ? error.message : String(error);
              }
            }
          })
          .catch((error: unknown) => {
            if (
              generation !== buildGeneration ||
              session.document !== document ||
              source.value !== sourceAtStart ||
              project !== projectAtStart ||
              activeGame() !== gameAtStart ||
              mapName !== nameAtStart
            )
              return;
            exportStatus.textContent =
              error instanceof Error ? error.message : String(error);
            if (autoExport) downloadBsp(result);
            if (previewSource) {
              buildStatus.textContent = `${autoExport ? "BSP downloaded" : buildOutcome} · loading compiled preview without companion assets`;
              installCompiledPreview(previewSource, document, sourceAtStart);
            } else if (autoExport) {
              buildStatus.textContent =
                "BSP downloaded · automatic export unavailable";
            }
          });
      } else if (previewSource) {
        buildStatus.textContent += " · loading compiled preview";
        installCompiledPreview(previewSource, document, sourceAtStart);
      } else {
        clearCompiledPreview();
        buildStatus.textContent +=
          " · compiled preview unavailable for this format";
      }
    } else {
      buildStatus.textContent = "Build failed; see build messages";
    }
  } catch (error) {
    buildStatus.textContent =
      error instanceof Error ? error.message : String(error);
  } finally {
    buildButton.disabled = false;
  }
});

exportBuildButton.addEventListener("click", async () => {
  refreshBuildExport();
  const latest = latestBuildExport;
  if (!latest || exportBuildButton.disabled) return;
  try {
    await exportLatestBuild(exportSettings);
  } catch (error) {
    exportStatus.textContent =
      error instanceof Error ? error.message : String(error);
  }
});

toggleCompiledButton.addEventListener("click", () => {
  showCompiledPreview(!compiledVisible);
});

document
  .querySelector<HTMLButtonElement>("#download-map")!
  .addEventListener("click", () => {
    if (hostedMap) {
      downloadMapCopy(mapName, hostedMap.source);
      return;
    }
    if (!applyWorkingSource()) return;
    const plan = planMapSave(session.document, mapSourceState);
    if (plan.status === "blocked") {
      status.textContent = `${plan.diagnostics.map(({ message }) => message).join(" ")} Use Export normalized to download a separate copy.`;
      return;
    }
    downloadMapCopy(mapName, plan.text);
  });
document
  .querySelector<HTMLButtonElement>("#export-normalized")!
  .addEventListener("click", () => {
    if (hostedMap) {
      status.textContent =
        "Open a local copy before exporting normalized source";
      return;
    }
    if (!applyWorkingSource()) return;
    const normalizedName = mapName.replace(/\.map$/i, "") + ".normalized.map";
    downloadMapCopy(normalizedName, serializeMap(session.document));
    status.textContent = `Exported ${normalizedName} as a separate copy`;
  });

function showVersionError(error: unknown) {
  versionsStatus.textContent =
    error instanceof Error ? error.message : String(error);
}

async function renderVersions() {
  if (hostedMap) {
    const mapId = hostedMap.id;
    const checkpoints = await listHostedCheckpoints(mapId);
    if (hostedMap?.id !== mapId) return;
    versionsList.replaceChildren();
    versionsStatus.textContent = checkpoints.length
      ? "Restoring opens a detached local copy; the hosted map stays unchanged."
      : "No hosted checkpoints for this map yet";
    for (const checkpoint of checkpoints) {
      const row = document.createElement("div");
      row.className = "version-row";
      const description = document.createElement("span");
      description.textContent = `${checkpoint.name} · hosted v${checkpoint.mapVersion} · ${new Date(checkpoint.createdAt).toLocaleString()}`;
      const restore = document.createElement("button");
      restore.type = "button";
      restore.textContent = "Restore copy";
      restore.addEventListener("click", async () => {
        restore.disabled = true;
        try {
          const current = hostedMap;
          if (!current || current.id !== mapId) return;
          const snapshot = await readHostedCheckpointSource(
            mapId,
            checkpoint.id,
          );
          const parsed = parseMapSource(snapshot.source);
          if (hostedMap?.id !== mapId || !(await mayReplaceMap())) return;
          clearOpenedFile();
          localGame = current.game;
          mapName = `${current.slug}.map`;
          setMap(parsed.document, parsed.source);
          source.value = snapshot.source;
          scheduleDraftSave();
          versionsDialog.close();
          status.textContent = `Restored hosted checkpoint “${snapshot.checkpoint.name}” as a local copy · save to a file when ready`;
        } catch (error) {
          showVersionError(error);
        } finally {
          restore.disabled = false;
        }
      });
      row.append(description, restore);
      versionsList.append(row);
    }
    return;
  }
  const versions = await listEditorVersions();
  versionsList.replaceChildren();
  versionsStatus.textContent = versions.length
    ? ""
    : "No recovery versions on this device yet";
  for (const version of versions) {
    const row = document.createElement("div");
    row.className = "version-row";
    const description = document.createElement("span");
    description.textContent = `${version.protected ? "★ " : ""}${version.fileName} · ${version.label} · ${new Date(version.createdAt).toLocaleString()}`;
    const actions = document.createElement("div");
    actions.className = "version-actions";
    const restore = document.createElement("button");
    restore.type = "button";
    restore.textContent = "Restore copy";
    restore.addEventListener("click", async () => {
      try {
        const parsed = parseMapSource(version.committedSource);
        if (!(await mayReplaceMap())) return;
        clearOpenedFile();
        localGame = version.game ?? "quake";
        mapName = version.fileName;
        setMap(
          version.document ?? parsed.document,
          version.sourceState ?? parsed.source,
        );
        source.value = version.workingSource;
        scheduleDraftSave();
        versionsDialog.close();
        status.textContent = `Restored ${version.label} as a local copy · save to a file when ready`;
      } catch (error) {
        showVersionError(error);
      }
    });
    const protect = document.createElement("button");
    protect.type = "button";
    protect.textContent = version.protected ? "Unprotect" : "Protect";
    protect.addEventListener("click", async () => {
      try {
        await setEditorVersionProtected(version.id, !version.protected);
        await renderVersions();
      } catch (error) {
        showVersionError(error);
      }
    });
    actions.append(restore, protect);
    row.append(description, actions);
    versionsList.append(row);
  }
}

checkpointButton.addEventListener("click", async () => {
  if (hostedMap) {
    const map = hostedMap;
    if (!hostedConnection || map.role === "viewer") return;
    checkpointButton.disabled = true;
    try {
      if (await hostedConnection.pending()) {
        throw new Error("Wait for live brush edits to finish syncing");
      }
      const checkpoint = await createHostedCheckpoint(
        map.id,
        checkpointLabel.value.trim() || `Checkpoint v${map.mapVersion}`,
      );
      if (hostedMap?.id !== map.id) return;
      checkpointLabel.value = "";
      status.textContent = `Hosted checkpoint “${checkpoint.name}” saved at v${checkpoint.mapVersion}`;
      if (versionsDialog.open) await renderVersions();
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : String(error);
    } finally {
      setHostedEditability();
    }
    return;
  }
  try {
    persistDraft();
    await saveQueue;
    const version = await createEditorCheckpoint(
      captureDraft(),
      checkpointLabel.value,
    );
    checkpointLabel.value = "";
    status.textContent = `Protected checkpoint “${version.label}” saved on this device`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});
document
  .querySelector<HTMLButtonElement>("#show-versions")!
  .addEventListener("click", async () => {
    versionsDialog.showModal();
    try {
      if (!hostedMap) persistDraft();
      await saveQueue;
      await renderVersions();
    } catch (error) {
      showVersionError(error);
    }
  });
document
  .querySelector<HTMLButtonElement>("#close-versions")!
  .addEventListener("click", () => versionsDialog.close());

for (const button of document.querySelectorAll<HTMLButtonElement>(
  ".editor-toolbar button:not(#delete-selection, #duplicate-selection, #hide-selection, #isolate-selection, #show-all, #snap-to-grid, #copy-selection, #paste-cursor, #make-brush-entity, #make-structural, #move-selection, #rotate-selection, #scale-selection, #undo, #redo, #toggle-compiled, #export-build), #apply-source",
)) {
  button.disabled = false;
}
source.disabled = false;
buildProfile.disabled = false;
loadCurrentExportSettings();
refreshSelection();
issueBrowser.refresh();
const sourceComparison = initSourceComparison();
projectSyncControls = initProjectSyncDialog({
  linked(updated) {
    project = updated;
    status.textContent = `Linked ${updated.manifest.hosted?.maps.length ?? 0} project maps`;
  },
  canSync(path) {
    return path === activeProjectPath && hasUnsavedChanges()
      ? "Save or discard open editor changes before syncing this map"
      : null;
  },
  pulled(path, text) {
    if (path !== activeProjectPath) return;
    const parsed = parseMapSource(text);
    const document = parsed.document;
    openedFingerprint = mapSourceFingerprint(text);
    savedSource = serializeMap(document);
    setMap(document, parsed.source);
    status.textContent = `Pulled ${path} from the hosted map`;
  },
});
projectSyncControls.setProject(project);
hostedBuildControls = initHostedBuilds({
  map: () => hostedMap,
  onUpdate(build) {
    buildStatus.textContent = `Hosted ${build.quality} build · ${build.status} · v${build.mapVersion}`;
  },
  preview(build, artifactPath) {
    void (async () => {
      const map = hostedMap;
      if (!map || map.mapVersion !== build.mapVersion) {
        buildStatus.textContent = "This build is from an earlier map version";
        return;
      }
      if (
        (await new IndexedDbCollaborationOutbox().pending(map.id)).length > 0
      ) {
        buildStatus.textContent =
          "Wait for hosted edits to sync before previewing";
        return;
      }
      if (hostedMap?.id !== map.id || hostedMap.mapVersion !== build.mapVersion)
        return;
      buildStatus.textContent = "Loading hosted preview resources";
      const mounts = await listHostedResources(map.projectId);
      if (hostedMap?.id !== map.id || hostedMap.mapVersion !== build.mapVersion)
        return;
      const previewSource = await loadHostedWorldSource(
        artifactPath,
        map.projectId,
        mounts,
      );
      if (hostedMap?.id !== map.id || hostedMap.mapVersion !== build.mapVersion)
        return;
      buildStatus.textContent = "Loading hosted compiled preview";
      installCompiledPreview(previewSource, session.document, source.value);
    })().catch((error: unknown) => {
      buildStatus.textContent =
        error instanceof Error ? error.message : String(error);
    });
  },
});
hostedControls = initHostedEditor({
  open: openHostedMap,
  compare(map) {
    if (hostedMap) throw new Error("Open a local map to compare sources");
    sourceComparison.show({
      localName: mapName,
      localSource: source.value,
      hostedName: `${map.projectName} / ${map.name}`,
      hostedSource: map.source,
      hostedVersion: map.mapVersion,
    });
  },
  makeCopy: makeLocalCopy,
  async openDetached(copy: DetachedHostedMap) {
    if (!(await mayReplaceMap())) return false;
    openDetachedCopy(copy);
    return true;
  },
  resourcesChanged(projectId) {
    if (hostedMap?.projectId === projectId)
      void refreshHostedResources(hostedMap);
  },
});
hostedSourceControls = initHostedSourceDialog({
  current() {
    return hostedMap ? { map: hostedMap, connection: hostedConnection } : null;
  },
  saved(mapVersion) {
    status.textContent = `Hosted source saved · v${mapVersion}. Refreshing live room…`;
  },
  status(message) {
    status.textContent = message;
  },
});

const launchRecentProject = new URL(location.href).searchParams.get(
  "recentProject",
);
if (launchRecentProject)
  void openRecentProject(launchRecentProject, false).catch((error: unknown) => {
    status.textContent = error instanceof Error ? error.message : String(error);
  });

const newMapUrl = new URL(location.href);
if (newMapUrl.searchParams.get("newMap") === "1") {
  const name = (newMapUrl.searchParams.get("name") ?? "").trim();
  const game = newMapUrl.searchParams.get("game");
  const format = newMapUrl.searchParams.get("format");
  if (
    !name ||
    name.length > 120 ||
    /[\\/:*?"<>|]/.test(name) ||
    [...name].some((character) => character.charCodeAt(0) < 32) ||
    !isWorldviewGameProfile(game) ||
    !gameProfileSupportsFaceSyntax(worldviewGameProfile(game), format)
  ) {
    status.textContent = "Choose a valid map name, game, and format";
  } else {
    void (async () => {
      if (!(await mayReplaceMap())) return;
      clearOpenedFile();
      localGame = game;
      mapName = name.toLowerCase().endsWith(".map") ? name : `${name}.map`;
      const document = { ...createEmptyDocument(), faceSyntax: format };
      savedSource = serializeMap(document);
      setMap(document);
      newMapUrl.search = "";
      history.replaceState(null, "", newMapUrl);
      status.textContent = `Created ${mapName} · save to a file when ready`;
    })().catch((error: unknown) => {
      status.textContent =
        error instanceof Error ? error.message : String(error);
    });
  }
}
