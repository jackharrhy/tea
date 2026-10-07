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
  isEditorGroupEntity,
  isEditorLayerEntity,
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
import { editorRenderTheme, editorThemeEvent } from "./editor-theme.ts";
import {
  defineWorldViewElement,
  type WorldViewElement,
} from "@tea/maps-renderer/element";
import type { CameraUpdate, WorldSource } from "@tea/maps-renderer";
import type {
  CollaborationPresence,
  HostedMapLaunch,
} from "@tea/maps-protocol";
import {
  createEditorCheckpoint,
  latestEditorVersion,
  loadEditorDraft,
  saveEditorDraft,
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
  readHostedCheckpointSource,
} from "./editor-hosted-checkpoints.ts";
import type {
  VersionsRefreshRequest,
  VersionsRestoreRequest,
} from "./editor-versions-panel.tsx";
import { createFaceDragController } from "./editor-face-drag.ts";
import { applyViewportPick } from "./editor-picking.ts";
import { createEditorSweep } from "./editor-sweep.ts";
import { initEditorReferences } from "./editor-references.ts";
import {
  canProtectEntityProperties,
  renderEntityProperties,
} from "./editor-entity-properties.ts";
import { initEditorFov } from "./editor-fov.ts";
import { initEditorWorkspace } from "./editor-workspace.ts";
import { initEditorMaterialBrowser } from "./editor-material-browser.ts";
import { createTextureUvEditor } from "./editor-uv.ts";
import { initSourceComparison } from "./editor-source-compare.ts";
import { initProjectSyncDialog } from "./editor-project-sync-dialog.ts";
import { initProjectMapSelector } from "./editor-project-map-selector.ts";
import { registerEditorWebMcpTools } from "./editor-webmcp.ts";
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
  recentProject,
  rememberRecentProject,
  rememberRecentProjectMap,
} from "./editor-recent-projects.ts";
import type { OpenRecentProjectRequest } from "./editor-recent-projects-panel.tsx";
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
  loadExportSettings,
  pickExportDirectory,
  saveExportSettings,
  writeBuildExport,
  type ExportSettings,
} from "./editor-export-settings.ts";
import { initEditorExportSettingsPanel } from "./editor-export-settings-bridge.ts";
import {
  initEditorLayersPanel,
  type EditorLayerCommand,
} from "./editor-layers-bridge.ts";
import {
  initEditorGroupsPanel,
  type EditorGroupCommand,
} from "./editor-groups-bridge.ts";
import { initEditorBuildControls } from "./editor-build-controls-bridge.ts";
import { initEditorDocumentControls } from "./editor-document-controls-bridge.ts";
import { initEditorSourcePanel } from "./editor-source-bridge.ts";
import { initEditorProjectContext } from "./editor-project-context-bridge.ts";
import {
  initEditorSelectionBrushes,
  type SelectionBrushMode,
  type SelectionBrushProjection,
} from "./editor-selection-brushes-bridge.ts";
import { initEditorSelectionCommands } from "./editor-selection-commands-bridge.ts";
import { initEditorEditActions } from "./editor-edit-actions-bridge.ts";
import { initEditorToolSettings } from "./editor-tool-settings-bridge.ts";
import { initEditorHistory } from "./editor-history-bridge.ts";
import { initEditorEntityCreation } from "./editor-entity-creation-bridge.ts";
import { initEditorTransforms } from "./editor-transforms-bridge.ts";

const status = document.querySelector<HTMLElement>("#editor-status")!;
const performanceDiagnostics = initEditorPerformance();
const hostedPresence = initHostedPresence((message) => {
  status.textContent = message;
});
const source = initEditorSourcePanel({
  input: onSourceInput,
  apply: applyWorkingSource,
});
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
const propertyProtectionOption = document.querySelector<HTMLElement>(
  "#entity-property-protection-option",
)!;
const propertyProtected = document.querySelector<HTMLInputElement>(
  "#entity-property-protected",
)!;
const savePropertyButton = document.querySelector<HTMLButtonElement>(
  "#save-entity-property",
)!;
const removePropertyButton = document.querySelector<HTMLButtonElement>(
  "#remove-entity-property",
)!;
const selectionCommands = initEditorSelectionCommands({
  delete: deleteSelection,
  duplicate: duplicateSelection,
  selectAll: () => selectObjects("all"),
  invert: () => selectObjects("invert"),
  focus: focusSelection,
  hide: hideSelection,
  isolate: isolateSelection,
  showAll: showAllSelection,
  lock: lockSelection,
  unlockAll: unlockAllSelection,
});
const editActions = initEditorEditActions({
  snap: snapSelectionToGrid,
  repeat: repeatRecordedCommands,
  clearRepeat: clearRecordedCommands,
  copy: copySelection,
  pastePointer: pasteAtPointer,
  pasteOriginal: pasteInPlace,
});
const selectionBrushes = initEditorSelectionBrushes(runSelectionBrushQuery);
const toolSettings = initEditorToolSettings({
  selectTool: activateViewportTool,
  textureLockChanged: () => sweepTool.refresh(),
});
const entityCreation = initEditorEntityCreation({
  pointClassnameChanged: refreshPointEntityPlacementBounds,
  makeBrushEntity,
  makeStructural,
  addPoint: addPointEntity,
});
const transforms = initEditorTransforms({
  move: moveSelection,
  nudge: nudgeSelection,
  rotate: rotateSelection,
  scale: scaleSelection,
  shear: shearSelection,
  flip: flipSelection,
});
const csgButtons = {
  merge: document.querySelector<HTMLButtonElement>("#csg-merge")!,
  intersect: document.querySelector<HTMLButtonElement>("#csg-intersect")!,
  subtract: document.querySelector<HTMLButtonElement>("#csg-subtract")!,
  hollow: document.querySelector<HTMLButtonElement>("#csg-hollow")!,
};
const csgThickness =
  document.querySelector<HTMLInputElement>("#csg-thickness")!;
const historyControls = initEditorHistory({
  undo: () => void runHistoryAction("undo"),
  redo: () => void runHistoryAction("redo"),
});
const projectContext = initEditorProjectContext(openProjectMap);
const perspectiveLabel =
  document.querySelector<HTMLElement>("#perspective-label")!;
const materialChoices =
  document.querySelector<HTMLDataListElement>("#material-choices")!;
const boxMaterial = document.querySelector<HTMLInputElement>("#box-material")!;
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
const switchMapDialog =
  document.querySelector<HTMLDialogElement>("#switch-map-dialog")!;
const versionsDialog =
  document.querySelector<HTMLDialogElement>("#versions-dialog")!;
const canvases = {
  perspective: document.querySelector<HTMLCanvasElement>("#perspective")!,
  xy: document.querySelector<HTMLCanvasElement>("#xy")!,
  xz: document.querySelector<HTMLCanvasElement>("#xz")!,
  yz: document.querySelector<HTMLCanvasElement>("#yz")!,
};

let session = new EditorSession(createEmptyDocument());
let openGroupId: string | null = null;
let selectedLayerId: string | null = null;
const layersPanel = initEditorLayersPanel(runLayerCommand);
const groupsPanel = initEditorGroupsPanel(runGroupCommand);
const buildControls = initEditorBuildControls({
  selectGame: selectGameProfile,
  selectProfile(id) {
    if (buildControls.state.profiles.some((profile) => profile.id === id))
      buildControls.update({ profileId: id });
  },
  build: () => void runBuild(false),
  buildExportOnce: () => void runBuild(true),
  exportLatest: () => void exportCurrentBuild(),
  togglePreview: () => showCompiledPreview(!compiledVisible),
});
const documentControls = initEditorDocumentControls({
  newMap: newMapFromControls,
  exampleMap: exampleMapFromControls,
  openPicker: openPickerFromControls,
  openFile: (file) => openMapFile(file, null),
  openProject: openProjectFromControls,
  save: saveCurrentMap,
  exportNormalized: exportNormalizedMap,
  checkpoint: createCheckpointFromControls,
  showVersions: showVersionsFromControls,
  download: downloadCurrentMap,
});
let renderer: EditorSourceRenderer | null = null;
window.addEventListener(editorThemeEvent, () => {
  renderer?.setTheme(editorRenderTheme());
});
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
const exportSettingsPanel = initEditorExportSettingsPanel({
  configure: configureExportSettings,
  async chooseDirectory() {
    const scopeId = exportSettings.scopeId;
    try {
      const directory = await pickExportDirectory();
      if (scopeId === exportSettings.scopeId)
        configureExportSettings({ directory });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      buildControls.exportStatus =
        error instanceof Error ? error.message : String(error);
    }
  },
});
let exportBusy = false;
let compiledPreview: WorldViewElement | null = null;
let compiledDocument: MapDocument | null = null;
let compiledSourceText: string | null = null;
let compiledVisible = false;
let buildGeneration = 0;
let hostedBuildBusy = false;
let localBuildBusy = false;
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
    void openProjectMap(path);
  },
  openSync() {
    projectSyncControls?.open();
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
  gridSize: () => toolSettings.state.gridSize,
  textureLock: () => toolSettings.state.textureLock,
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
  textureLock: () => toolSettings.state.textureLock,
  canEdit: viewportCanEdit,
  status: (message) => {
    status.textContent = message;
  },
});
const issueBrowser = createIssueBrowser({
  session: () => session,
  renderer: () => renderer,
  canEdit: () => !hostedMap || hostedConnection !== null,
  prepareEdit: viewportCanEdit,
  status: (message) => {
    status.textContent = message;
  },
});
const visibility = createEditorVisibility({
  session: () => session,
  renderer: () => renderer,
});
const sweepTool = createEditorSweep({
  session: () => session,
  renderer: () => renderer,
  viewState: () => rendererViewState,
  tool: () => toolSettings.state.tool,
  gridSize: () => toolSettings.state.gridSize,
  textureLock: () => toolSettings.state.textureLock,
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
  tool: () => toolSettings.state.tool,
  viewport: () => latestPointer?.viewport ?? "xy",
  gridSize: () => toolSettings.state.gridSize,
  textureLock: () => toolSettings.state.textureLock,
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
  tool: () => toolSettings.state.tool,
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
  tool: () => toolSettings.state.tool,
  bounds: selectedObjectBounds,
  topology: topologyTool.selection,
  gridSize: () => toolSettings.state.gridSize,
  textureLock: () => toolSettings.state.textureLock,
  canEdit: viewportCanEdit,
  applyNumeric: (tool) =>
    ({ rotate: rotateSelection, scale: scaleSelection, shear: shearSelection })[
      tool
    ](),
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
    savedSource,
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
  buildControls.update({
    previewLabel: compiledVisible
      ? "Show source"
      : compiledDocument &&
          (compiledDocument !== session.document ||
            compiledSourceText !== source.value)
        ? "Show compiled (stale)"
        : "Show compiled",
  });
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
  buildControls.update({
    previewDisabled: true,
    previewLabel: "Show compiled",
  });
}

function renderExportSettings() {
  exportSettingsPanel.setSettings(exportSettings);
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
        buildControls.exportStatus =
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
      buildControls.exportStatus =
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
  buildControls.update({ exportDisabled: exportBusy || !current });
  if (latestBuildExport && !current) {
    buildControls.exportStatus = "Map changed; rebuild to export";
  } else if (
    latestBuildExport &&
    buildControls.exportStatus === "Map changed; rebuild to export"
  ) {
    buildControls.exportStatus = "Bundle ready";
  }
}

function compiledPreviewCamera(): CameraUpdate | null {
  const camera = renderer?.viewportCamera("perspective");
  return camera
    ? {
        position: [...camera.position],
        yaw: camera.yaw,
        pitch: camera.pitch,
        fieldOfView: camera.fieldOfViewDegrees,
      }
    : null;
}

function installCompiledPreview(
  previewSource: WorldSource,
  documentAtBuild: MapDocument,
  sourceAtBuild: string,
  camera: CameraUpdate | null,
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
    if (camera) preview.viewer?.setCamera(camera);
    buildControls.update({ previewDisabled: false });
    buildControls.buildStatus = "Compiled preview ready";
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
    buildControls.buildStatus = `Compiled preview unavailable: ${event.detail.error.message}`;
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
      entityCreation.state.pointClassname.trim(),
      resources?.definitions,
    ).bounds,
  );
  materialChoices.replaceChildren();
  for (const material of resources?.materials ?? []) {
    const option = document.createElement("option");
    option.value = material.name;
    materialChoices.append(option);
  }
  const definitions = resources?.definitions.all() ?? [];
  entityCreation.update({
    pointClasses: definitions
      .filter((definition) => definition.kind === "point")
      .map(({ classname, label }) => ({ classname, label })),
    brushClasses: definitions
      .filter((definition) => definition.kind === "brush")
      .map(({ classname, label }) => ({ classname, label })),
  });
  if (resources) {
    const messages =
      resources.definitionDiagnostics.length +
      resources.materialDiagnostics.length +
      resources.spriteDiagnostics.length;
    projectContext.update({
      resourceInfo: `${resources.definitions.all().length} entity classes · ${resources.materials.length} textures · ${resources.sprites.length} sprites${messages ? ` · ${messages} resource ${messages === 1 ? "message" : "messages"}` : ""}`,
      diagnostics: [
        ...resources.definitionDiagnostics.map(
          (diagnostic) =>
            `${diagnostic.severity}: ${diagnostic.sourcePath ?? "Definitions"}: ${diagnostic.message}`,
        ),
        ...resources.materialDiagnostics,
        ...resources.spriteDiagnostics,
      ],
    });
  } else {
    projectContext.update({ resourceInfo: "", diagnostics: [] });
  }
  refreshSelection();
}

function setProject(value: MapProject | null) {
  const previousGame = activeGame();
  latestBuildExport = null;
  buildControls.exportStatus = "";
  refreshBuildExport();
  project = value;
  projectSyncControls?.setProject(value);
  if (activeGame() !== previousGame) {
    buildGeneration += 1;
    clearCompiledPreview();
  }
  projectBindings = null;
  loadCurrentExportSettings();
  const profiles = value?.manifest.buildProfiles.length
    ? value.manifest.buildProfiles
    : [
        { id: "preview", label: "Preview", quality: "preview" as const },
        { id: "final", label: "Final", quality: "final" as const },
      ];
  buildControls.update({
    profiles: profiles.map(({ id, label }) => ({ id, label })),
    profileId: value?.manifest.defaultBuildProfile ?? profiles[0]!.id,
  });
  refreshResourceCatalog();
  if (value) return;
  projectMapSelector.hide();
  activeProjectPath = null;
  activeRecentProjectId = null;
  projectContext.update({
    projectName: null,
    paths: [],
    selectedPath: "",
    resourceInfo: "",
    diagnostics: [],
  });
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
    source.setWarning(null);
  } else {
    const plan = planMapSave(session.document, mapSourceState);
    source.value = plan.status === "safe" ? plan.text : plan.normalizedText;
    source.setWarning(
      plan.status === "blocked"
        ? `${plan.diagnostics.map(({ message }) => message).join(" ")} Use Export normalized for a separate copy; Save and Download cannot overwrite this source.`
        : null,
    );
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
  layersPanel.publish({
    layers,
    selectedLayerId,
    activeLayerId: session.activeLayerId,
    editing: !hostedMap || hostedConnection !== null,
    hasObjectSelection: !!session.selection && !session.selection.faceId,
  });
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
  const selectionBrushReady =
    editing &&
    brushIds.length > 0 &&
    pointIds.length === 0 &&
    !selection?.faceId &&
    !selection?.groupId &&
    owners.every(
      (entity) =>
        entity &&
        (entity.properties.classname === "worldspawn" ||
          isEditorGroupEntity(entity) ||
          isEditorLayerEntity(entity)),
    );
  selectionBrushes.setEnabled(selectionBrushReady);
  buildControls.update({
    game: activeGame(),
    gameDisabled: project !== null || hostedMap !== null,
  });
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
    const canProtect = canProtectEntityProperties(
      session.document,
      selectedEntity,
      openGroupId,
    );
    propertyProtectionOption.hidden = !canProtect;
    propertyProtected.disabled = !editing || !canProtect;
    if (!canProtect) propertyProtected.checked = false;
    renderEntityProperties({
      list: propertyList,
      entity: selectedEntity,
      definitions: currentDefinitions(),
      editable: editing,
      canProtect,
      commit: commitEntityProperty,
      protect: setEntityPropertyProtection,
    });
  } else {
    propertyList.replaceChildren();
    propertyProtectionOption.hidden = true;
    propertyProtected.checked = false;
  }
  propertyKey.disabled = !selectedEntity || !editing;
  propertyValue.disabled = !selectedEntity || !editing;
  refreshPropertyActions();
  pointInspector.hidden = !pointEntity;
  if (pointEntity) {
    pointClassname.value = pointEntity.properties.classname ?? "";
    pointOrigin.value = pointEntity.properties.origin ?? "";
  }
  updatePointButton.disabled = !pointEntity || !editing;
  const objectCommandDisabled = (!brushId && pointIds.length === 0) || !editing;
  editActions.update({
    copyDisabled: !selection,
    snapDisabled:
      hostedMap !== null ||
      (brushIds.length === 0 && selectedFaceReferences(selection).length === 0),
    repeatDisabled: !session.canRepeatCommands || !editing,
    repeatLabel: session.repeatCommandCount
      ? `Repeat ${session.repeatCommandCount}`
      : "Repeat",
    repeatTitle: session.repeatCommandLabels.length
      ? `Repeat ${session.repeatCommandLabels.join(" → ")} (Ctrl/Command+Shift+R)`
      : "Record duplicate, move, rotate, flip, scale, or shear commands first",
    clearRepeatDisabled: session.repeatCommandCount === 0,
    clearRepeatTitle: session.repeatCommandCount
      ? `Clear ${session.repeatCommandLabels.join(" → ")}`
      : "No recorded command sequence",
  });
  selectionCommands.update({
    deleteDisabled: objectCommandDisabled,
    duplicateDisabled: objectCommandDisabled,
    hideDisabled: hostedMap !== null || (!brushId && pointIds.length === 0),
    showAllDisabled: hostedMap !== null || !session.canShowAll,
    focusDisabled: !selection || !renderer,
    unlockAllDisabled: hostedMap !== null || !session.canUnlockAll,
  });
  transforms.update({
    nudgeDisabled: (!brushId && pointIds.length === 0) || !editing,
    moveDisabled: (!brushId && pointIds.length === 0) || !editing,
    rotateDisabled: !brushId || !editing,
    scaleDisabled: !brushId || !editing,
    shearDisabled: (!brushId && pointIds.length === 0) || !editing,
    flipDisabled: (!brushId && pointIds.length === 0) || !editing,
  });
  entityCreation.update({
    makeBrushDisabled: !brushId || !editing,
    makeStructuralDisabled:
      !brushId ||
      !editing ||
      owners.every(
        (entity) =>
          entity?.properties.classname?.toLowerCase() === "worldspawn",
      ),
  });
  csgButtons.merge.disabled = brushIds.length < 2 || !editing;
  csgButtons.intersect.disabled = brushIds.length < 2 || !editing;
  csgButtons.subtract.disabled = brushIds.length === 0 || !editing;
  csgButtons.hollow.disabled = brushIds.length === 0 || !editing;
  csgThickness.disabled = !editing;
  const selectedGroup = selectedEditorGroup(session.document, selection);
  groupsPanel.publish({
    editing,
    canGroupSelection: !!selection && !selection.faceId,
    selectedGroup: selectedGroup
      ? {
          id: selectedGroup.id,
          name: selectedGroup.name,
          linked: !!selectedGroup.linkedGroupId,
        }
      : null,
    openGroupId,
  });
  refreshLayers();
  const undoLabel = hostedMap
    ? hostedConnection?.undoLabel()
    : session.undoLabel;
  const redoLabel = hostedMap
    ? hostedConnection?.redoLabel()
    : session.redoLabel;
  historyControls.update({
    undoDisabled: hostedMap ? !hostedConnection?.canUndo() : !session.canUndo,
    redoDisabled: hostedMap ? !hostedConnection?.canRedo() : !session.canRedo,
    undoTitle: undoLabel ? `Undo ${undoLabel}` : "Undo",
    redoTitle: redoLabel ? `Redo ${redoLabel}` : "Redo",
  });
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
  const active = toolSettings.state.tool === "clip";
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
  const active = toolSettings.state.tool === "hull";
  hullTools.hidden = !active;
  hullPointsLabel.textContent = `${hullPointCount} point${hullPointCount === 1 ? "" : "s"}`;
  createHullButton.disabled =
    !active || !hullCandidate || (hostedMap !== null && !hostedConnection);
  discardHullButton.disabled =
    !active || (hullPointCount === 0 && !renderer?.hullHistoryActive);
  if (renderer?.hullHistoryActive) {
    historyControls.update({
      undoDisabled: !renderer.canUndoHull,
      redoDisabled: !renderer.canRedoHull,
      undoTitle: "Undo hull point",
      redoTitle: "Redo hull point",
    });
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
  editActions.update({ pastePointerDisabled: true });
  latestBuildExport = null;
  buildControls.exportStatus = "";
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

function assertSiteToolDocument(id: string, revision: number) {
  if (session.document.id !== id)
    throw new Error(
      `Stale document identity: current ID is ${session.document.id}`,
    );
  if (session.document.revision !== revision)
    throw new Error(
      `Stale document revision: current revision is ${session.document.revision}`,
    );
}

async function checkSiteToolReplacement(
  id: string,
  revision: number,
  discardUnsavedChanges: boolean,
) {
  assertSiteToolDocument(id, revision);
  if (
    hostedMap &&
    (await new IndexedDbCollaborationOutbox().pending(hostedMap.id)).length > 0
  )
    throw new Error("Hosted edits are waiting to sync");
  assertSiteToolDocument(id, revision);
  if (hasUnsavedChanges() && !discardUnsavedChanges)
    throw new Error(
      "The current map has unsaved changes; set discardUnsavedChanges to true",
    );
}

function setHostedEditability() {
  const readOnly = hostedMap !== null;
  if (readOnly && !hostedConnection) {
    activateViewportTool("select");
  }
  toolSettings.update({
    toolDisabled: !renderer || (readOnly && !hostedConnection),
  });
  source.disabled = readOnly;
  document.querySelector<HTMLButtonElement>("#add-box")!.disabled =
    readOnly && !hostedConnection;
  entityCreation.update({ addPointDisabled: readOnly && !hostedConnection });
  documentControls.update({
    saveDisabled: readOnly,
    checkpointDisabled:
      readOnly && (hostedMap?.role === "viewer" || !hostedConnection),
    downloadLabel: readOnly ? "Download copy" : "Download .map",
  });
  editActions.update({
    pasteOriginalDisabled: readOnly && !hostedConnection,
    pastePointerDisabled:
      (readOnly && !hostedConnection) || latestPointer === null,
  });
  const buildDisabled =
    localBuildBusy ||
    (readOnly && (hostedMap?.role === "viewer" || hostedBuildBusy));
  buildControls.update({
    buildLabel: readOnly ? "Build hosted BSP" : "Build BSP",
    buildDisabled,
    buildExportOnceDisabled: readOnly || buildDisabled,
  });
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
  projectContext.update({ resourceInfo: "Loading hosted project resources" });
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
    projectContext.update({
      resourceInfo: `Could not load hosted resources: ${error instanceof Error ? error.message : String(error)}`,
    });
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

function openDetachedCopy(
  copy: {
    documentKey: string;
    document: MapDocument;
    source: MapSourceState;
    fileName: string;
    profile: WorldviewGameProfile;
  },
  recovery?: EditorVersion | null,
) {
  const parsed = recovery ? parseMapSource(recovery.committedSource) : null;
  leaveHostedMap();
  openedFile = null;
  openedFingerprint = null;
  setProject(null);
  localGame = recovery?.game ?? copy.profile;
  documentId = copy.documentKey;
  mapName = recovery?.fileName ?? copy.fileName;
  savedSource = "";
  setMap(
    recovery?.document ?? copy.document,
    recovery?.sourceState ?? parsed?.source ?? copy.source,
  );
  source.value = recovery?.workingSource ?? copy.source.originalText;
  persistDraft();
  status.textContent = `Local recovery copy ${mapName} · save to a file when ready`;
}

async function openDetachedCopyAfterConfirmation(
  copy: DetachedHostedMap,
): Promise<boolean> {
  const recovery = await latestEditorVersion(copy.documentKey).catch(
    () => null,
  );
  if (!(await mayReplaceMap())) return false;
  persistDraft();
  openDetachedCopy(copy, recovery);
  await saveQueue;
  return true;
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
  const result = applyViewportPick({
    session,
    selection,
    intent,
    openGroupId,
    activeTool: toolSettings.state.tool,
  });
  if (result.kind === "close-group") {
    closeOpenGroup(true);
  } else if (result.kind === "open-group") {
    openGroupId = result.group.id;
    session.setEditingGroup(result.group.id);
    renderer?.setOpenGroupId(result.group.id);
    session.select(selection);
    status.textContent = `Opened ${result.group.name} · objects outside the group are locked`;
  } else if (result.status) status.textContent = result.status;
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
      disabled: selectionCommands.state.focusDisabled,
      run: focusSelection,
    },
    {
      label: "Copy selection",
      disabled: editActions.state.copyDisabled,
      run: copySelection,
    },
    {
      label: "Duplicate selection",
      disabled: selectionCommands.state.duplicateDisabled,
      run: duplicateSelection,
    },
    {
      label: "Hide selection",
      disabled: selectionCommands.state.hideDisabled,
      run: hideSelection,
    },
    {
      label: "Isolate selection",
      disabled: selectionCommands.state.hideDisabled,
      run: isolateSelection,
    },
    {
      label: "Delete selection",
      disabled: selectionCommands.state.deleteDisabled,
      run: deleteSelection,
    },
    {
      label: "Show all hidden",
      disabled: selectionCommands.state.showAllDisabled,
      run: showAllSelection,
    },
  ];
  const createActions: ContextAction[] = [
    {
      label: "Paste here",
      disabled: !!hostedMap && !hostedConnection,
      run: () => clipboard.paste("pointer"),
    },
    {
      label: `Place ${entityCreation.state.pointClassname.trim() || "point entity"} here`,
      disabled:
        !event.pointEntityOrigin || !entityCreation.state.pointClassname.trim(),
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
  const classname = entityCreation.state.pointClassname.trim();
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
        toolSettings.state.textureLock,
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
      toolSettings.state.textureLock,
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
    savedSource = draft.savedSource ?? emptySource;
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
      theme: editorRenderTheme(),
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
        editActions.update({
          pastePointerDisabled: hostedMap !== null && !hostedConnection,
        });
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
        toolSettings.state.tool as
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
        pointEntityDefinition(entityCreation.state.pointClassname.trim())
          .bounds,
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
function onSourceInput() {
  refreshCompiledPreview();
  refreshBuildExport();
  if (hostedMap) return;
  status.textContent = "Source has unapplied edits";
  session.select(null);
  scheduleDraftSave();
}

let activeViewportTool = toolSettings.state.tool;

function activateViewportTool(next: string) {
  if (hostedMap && !hostedConnection) {
    next = "select";
  }
  const previous = activeViewportTool;
  toolSettings.update({ tool: next });
  activeViewportTool = next;
  renderer?.setTool(
    next as
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

function refreshPointEntityPlacementBounds() {
  renderer?.setEntityPlacementBounds(
    pointEntityDefinition(
      entityCreation.state.pointClassname.trim(),
      currentDefinitions(),
    ).bounds,
  );
}

function selectGameProfile(value: string) {
  if (project || hostedMap || !isWorldviewGameProfile(value)) {
    buildControls.update({ game: activeGame() });
    return;
  }
  if (value === localGame) return;
  localGame = value;
  renderer?.setMaterials(currentMaterials());
  materialBrowser.setMaterials(currentMaterials());
  buildGeneration += 1;
  latestBuildExport = null;
  buildControls.exportStatus = "";
  clearCompiledPreview();
  refreshBuildExport();
  refreshSelection();
  scheduleDraftSave();
}

async function newMapFromControls() {
  if (!(await mayReplaceMap())) return;
  clearOpenedFile();
  setMap(createEmptyDocument());
}

async function exampleMapFromControls() {
  if (!(await mayReplaceMap())) return;
  clearOpenedFile();
  setMap(createStarterDocument());
}

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

function runGroupCommand(command: EditorGroupCommand) {
  const group = selectedEditorGroup(session.document, session.selection);
  if (command.type === "open") {
    if (!group) return;
    openGroupId = group.id;
    session.setEditingGroup(group.id);
    renderer?.setOpenGroupId(group.id);
    session.select(null);
    status.textContent = `Opened ${group.name} · objects outside the group are locked`;
    return;
  }
  if (command.type === "close") {
    const closed = closeOpenGroup(true);
    status.textContent = closed ? `Closed ${closed.name}` : "Closed group";
    return;
  }
  if (!viewportCanEdit()) return;
  try {
    switch (command.type) {
      case "create": {
        const name = command.name.trim();
        if (!name) {
          status.textContent = "Enter a group name";
          return;
        }
        session.groupSelected(
          name,
          createSequentialIdFactory(`tea-group-${crypto.randomUUID()}`),
          openGroupId,
        );
        return;
      }
      case "rename": {
        const name = command.name.trim();
        if (!group || !name) {
          status.textContent = "Select a group and enter a name";
          return;
        }
        session.renameGroup(group.id, name);
        return;
      }
      case "linked": {
        const grid = toolSettings.state.gridSize;
        const groupId = session.linkedDuplicateSelected(
          createSequentialIdFactory(`tea-linked-${crypto.randomUUID()}`),
          [grid, grid, 0],
          toolSettings.state.textureLock,
        );
        status.textContent = groupId
          ? "Created linked duplicate · edits to either opened group update both"
          : "Select a closed group to make a linked duplicate";
        return;
      }
      case "unlink":
        if (group && session.unlinkGroup(group.id)) {
          status.textContent = `Unlinked ${group.name} · its contents are independent`;
        }
        return;
      case "ungroup":
        if (group) session.ungroupSelected(group.id);
        return;
    }
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

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

function runLayerCommand(command: EditorLayerCommand) {
  switch (command.type) {
    case "choose":
      selectedLayerId = command.id;
      refreshLayers();
      return;
    case "create": {
      const name = command.name.trim();
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
      return;
    }
    case "rename": {
      const name = command.name.trim();
      if (!selectedLayerId || !name) {
        status.textContent = "Select a custom layer and enter a name";
        return;
      }
      editLayer(() => session.renameLayer(selectedLayerId!, name));
      return;
    }
    case "activate":
      if (openGroupId) closeOpenGroup(false);
      try {
        session.setActiveLayer(selectedLayerId);
        refreshLayers();
      } catch (error) {
        status.textContent =
          error instanceof Error ? error.message : String(error);
      }
      return;
    case "move":
      editLayer(() => {
        if (!session.moveSelectedToLayer(selectedLayerId)) {
          status.textContent = "Selection is already in this layer";
        }
      });
      return;
    case "select":
      session.selectAllInLayer(selectedLayerId);
      refreshLayers();
      return;
    case "isolate":
      editLayer(() => session.isolateLayer(selectedLayerId));
      return;
    case "remove":
      if (selectedLayerId)
        editLayer(() => session.removeLayer(selectedLayerId!));
      return;
    case "up":
    case "down":
      if (selectedLayerId)
        editLayer(() =>
          session.reorderLayer(
            selectedLayerId!,
            command.type === "up" ? -1 : 1,
          ),
        );
      return;
    case "flag":
      editLayer(() =>
        session.setLayerFlag(selectedLayerId, command.flag, command.value),
      );
      return;
    case "all":
      editLayer(() => session.setAllLayersFlag(command.flag, command.value));
      return;
  }
}

function addPointEntity() {
  if (entityCreation.state.addPointDisabled || !applyWorkingSource()) return;
  const classname = entityCreation.state.pointClassname.trim();
  const coordinates = entityCreation.state.pointOrigin.map((value) =>
    value.trim() ? Number(value) : Number.NaN,
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
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

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
                toolSettings.state.textureLock,
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

function commitEntityProperty(
  key: string,
  next: string | null,
  protect = false,
) {
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
    session.setEntityProperty(inspectedEntityId, key, value, protect);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

function setEntityPropertyProtection(key: string, protect: boolean) {
  if (!inspectedEntityId || !applyWorkingSource()) return;
  try {
    session.setEntityPropertyProtected(inspectedEntityId, key, protect);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    refreshSelection();
  }
}

savePropertyButton.addEventListener("click", () => {
  commitEntityProperty(
    propertyKey.value.trim(),
    propertyValue.value,
    propertyProtected.checked,
  );
  propertyProtected.checked = false;
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

function deleteSelection() {
  if (selectionCommands.state.deleteDisabled) return;
  if (!applyWorkingSource()) return;
  try {
    session.deleteSelected();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

function duplicateSelection() {
  if (selectionCommands.state.duplicateDisabled) return;
  if (!applyWorkingSource()) return;
  try {
    session.duplicateSelected(
      createSequentialIdFactory(`tea-${crypto.randomUUID()}`),
      [16, 16, 0],
    );
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

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

function runSelectionBrushQuery(
  mode: SelectionBrushMode,
  projection?: SelectionBrushProjection,
) {
  if (!viewportCanEdit()) return;
  try {
    const result = session.selectWithSelectionBrushes(mode, projection);
    if (!result) {
      status.textContent = "Select one or more structural brushes first";
      return;
    }
    const count = result.selectedBrushCount + result.selectedEntityCount;
    const relationship =
      mode === "touching"
        ? "touching"
        : mode === "inside"
          ? "enclosed"
          : `${projection} enclosed`;
    status.textContent = `Consumed ${result.removedBrushCount} selection ${result.removedBrushCount === 1 ? "brush" : "brushes"} · selected ${count} ${relationship} ${count === 1 ? "object" : "objects"}`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}
function hideSelection() {
  if (selectionCommands.state.hideDisabled) return;
  if (!hostedMap && applyWorkingSource()) session.hideSelected();
}
function isolateSelection() {
  if (selectionCommands.state.hideDisabled) return;
  if (!hostedMap && applyWorkingSource()) session.isolateSelected();
}
function showAllSelection() {
  if (selectionCommands.state.showAllDisabled) return;
  if (!hostedMap && applyWorkingSource()) session.showAll();
}
function focusSelection() {
  if (selectionCommands.state.focusDisabled) return;
  if (!renderer?.focusSelection())
    status.textContent = "Select an object to focus";
  else scheduleRender();
}
function lockSelection() {
  if (selectionCommands.state.hideDisabled) return;
  if (!hostedMap && applyWorkingSource()) session.lockSelected();
}
function unlockAllSelection() {
  if (selectionCommands.state.unlockAllDisabled) return;
  if (!hostedMap && applyWorkingSource()) session.unlockAll();
}
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
function clearRecordedCommands() {
  if (editActions.state.clearRepeatDisabled) return;
  session.clearRepeatableCommands();
  refreshSelection();
}
function nudgeSelection(axis: TransformAxis, direction: -1 | 1) {
  if (transforms.state.nudgeDisabled || !viewportCanEdit()) return;
  const delta: [number, number, number] = [0, 0, 0];
  delta[axis] = toolSettings.state.gridSize * direction;
  try {
    if (!session.translateSelected(delta, toolSettings.state.textureLock)) {
      status.textContent = "Select an object to nudge";
    }
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}
function snapSelectionToGrid() {
  if (editActions.state.snapDisabled) return;
  if (hostedMap || !applyWorkingSource()) return;
  try {
    if (
      !session.snapSelectionToGrid(
        toolSettings.state.gridSize,
        createSequentialIdFactory(`tea-grid-${crypto.randomUUID()}`),
        toolSettings.state.textureLock,
      )
    ) {
      status.textContent = "Selection is already on the grid";
    }
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}
function copySelection() {
  if (editActions.state.copyDisabled) return;
  void clipboard.copy();
}
function pasteAtPointer() {
  if (editActions.state.pastePointerDisabled) return;
  void clipboard.paste("pointer");
}
function pasteInPlace() {
  if (editActions.state.pasteOriginalDisabled) return;
  void clipboard.paste("original");
}

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

function makeBrushEntity() {
  if (entityCreation.state.makeBrushDisabled) return;
  if (!applyWorkingSource()) return;
  const classname = entityCreation.state.brushClassname.trim();
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
}

function makeStructural() {
  if (entityCreation.state.makeStructuralDisabled) return;
  if (!applyWorkingSource()) return;
  try {
    session.makeSelectedStructural();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

function moveSelection() {
  if (transforms.state.moveDisabled) return;
  if (!applyWorkingSource()) return;
  const delta = transforms.state.move.map(Number);
  if (delta.some((value) => !Number.isFinite(value))) {
    status.textContent = "Move coordinates must be finite numbers";
    return;
  }
  try {
    session.translateSelected(
      [delta[0]!, delta[1]!, delta[2]!],
      toolSettings.state.textureLock,
    );
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

function rotateSelection() {
  if (transforms.state.rotateDisabled) return;
  if (!applyWorkingSource()) return;
  const pivot = transformTool.pivot() ?? selectedBrushPivot();
  const { rotateAxis, rotateDegrees, rotateValid } = transforms.state;
  const degrees = rotateDegrees.trim() ? Number(rotateDegrees) : Number.NaN;
  if (!pivot || !rotateValid || !Number.isFinite(degrees)) {
    status.textContent = "Select objects and enter a finite rotation";
    return;
  }
  try {
    const candidate = session.createObjectRotationCandidate(
      session.selection!,
      [...pivot],
      rotateAxis,
      degrees,
      toolSettings.state.textureLock,
      transformTool.updateAngles(),
    );
    if (candidate) session.commitDocumentCandidate(candidate);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

function scaleSelection() {
  if (transforms.state.scaleDisabled) return;
  if (!applyWorkingSource()) return;
  const pivot = transformTool.pivot() ?? selectedBrushPivot();
  const factors = transforms.state.scale.map((value) =>
    value.trim() ? Number(value) : Number.NaN,
  );
  if (
    !pivot ||
    transforms.state.scaleValid.some((valid) => !valid) ||
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
      toolSettings.state.textureLock,
      transformTool.updateAngles(),
    );
    if (candidate) session.commitDocumentCandidate(candidate);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

function shearSelection() {
  if (transforms.state.shearDisabled) return;
  if (!viewportCanEdit()) return;
  const bounds = selectedObjectBounds();
  const { shearSourceAxis: sourceAxis, shearTargetAxis: targetAxis } =
    transforms.state;
  const offset = transforms.state.shearOffset.trim()
    ? Number(transforms.state.shearOffset)
    : Number.NaN;
  const span = bounds ? bounds.max[sourceAxis] - bounds.min[sourceAxis] : 0;
  if (
    !bounds ||
    sourceAxis === targetAxis ||
    !transforms.state.shearValid ||
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
      toolSettings.state.textureLock,
      transformTool.updateAngles(),
    );
    if (candidate) session.commitDocumentCandidate(candidate);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

function flipSelection(axis: TransformAxis) {
  if (transforms.state.flipDisabled || !viewportCanEdit()) return;
  const bounds = selectedObjectBounds();
  if (!bounds) {
    status.textContent = "Select objects to mirror";
    return;
  }
  const grid = toolSettings.state.gridSize;
  const pivot = ([0, 1, 2] as const).map(
    (component) =>
      Math.round((bounds.min[component] + bounds.max[component]) / (2 * grid)) *
      grid,
  ) as [number, number, number];
  try {
    session.flipSelected(pivot, axis, toolSettings.state.textureLock);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
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

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && uvEditor.cancel()) {
    event.preventDefault();
    return;
  }
  if (
    (toolSettings.state.tool === "vertex" ||
      toolSettings.state.tool === "edge") &&
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
  if (toolSettings.state.tool === "sweep" && !textEditingTarget(event.target)) {
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
  if (toolSettings.state.tool === "hull" && !textEditingTarget(event.target)) {
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
    if (!selectionCommands.state.focusDisabled) focusSelection();
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

async function openPickerFromControls() {
  try {
    const handle = await pickMapFile();
    if (handle) await openMapFile(await handle.getFile(), handle);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

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
  projectContext.update({
    projectName: opened.manifest.name,
    paths: opened.maps.map((entry) => entry.path),
    selectedPath: "",
  });
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

window.addEventListener("tea-maps-open-recent-project", (event) => {
  const request = (event as CustomEvent<OpenRecentProjectRequest>).detail;
  event.preventDefault();
  void openRecentProject(request.id, true).then(
    request.resolve,
    request.reject,
  );
});

async function openProjectFromControls() {
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
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function openProjectMap(
  path: string,
  siteTool?: {
    readonly expectedDocumentId: string;
    readonly expectedRevision: number;
    readonly discardUnsavedChanges: boolean;
  },
) {
  const previous = activeProjectPath ?? "";
  const entry = project?.maps.find((projectMap) => projectMap.path === path);
  if (!entry) {
    projectContext.update({ selectedPath: previous });
    if (siteTool) throw new Error(`Unknown project map ${path}`);
    return false;
  }
  if (path === activeProjectPath) return true;
  try {
    const file = await entry.handle.getFile();
    const text = await file.text();
    const parsed = parseMapSource(text);
    const document = parsed.document;
    if (siteTool)
      await checkSiteToolReplacement(
        siteTool.expectedDocumentId,
        siteTool.expectedRevision,
        siteTool.discardUnsavedChanges,
      );
    else if (!(await mayReplaceMap())) {
      projectContext.update({ selectedPath: previous });
      return false;
    }
    persistDraft();
    leaveHostedMap();
    const identity = `project:${projectRecoveryScope}:${path}`;
    const diskSource = serializeMap(document);
    const recovery = siteTool
      ? null
      : await newerLocalRecovery(identity, file, diskSource);
    if (recovery) {
      openRecoveredLocalCopy(recovery, entry.handle.name);
      return true;
    }
    openedFile = entry.handle;
    openedFingerprint = mapSourceFingerprint(text);
    mapName = entry.handle.name;
    savedSource = diskSource;
    activeProjectPath = path;
    documentId = identity;
    setMap(document, parsed.source);
    projectContext.update({ selectedPath: path });
    projectMapSelector.hide();
    if (activeRecentProjectId)
      void rememberRecentProjectMap(activeRecentProjectId, path).catch(
        () => {},
      );
    if (siteTool) {
      persistDraft();
      await saveQueue;
    }
    return true;
  } catch (error) {
    projectContext.update({ selectedPath: previous });
    status.textContent = error instanceof Error ? error.message : String(error);
    if (siteTool) throw error;
    return false;
  }
}

async function exportLatestBuild(settings: ExportSettings): Promise<void> {
  const latest = latestBuildExport;
  if (!latest || !isBuildExportCurrent(latest)) {
    throw new Error("The map changed; build it again before exporting");
  }
  if (exportBusy) return;
  exportBusy = true;
  refreshBuildExport();
  try {
    buildControls.exportStatus = "Packaging build…";
    const file = await packageBuildExport(latest.input, settings.includeSource);
    if (!isBuildExportCurrent(latest)) {
      throw new Error("The map changed while packaging the export");
    }
    if (settings.directory) await writeBuildExport(settings.directory, file);
    else downloadBuildFile(file);
    buildControls.exportStatus = settings.directory
      ? `Exported ${settings.directory.name}/${file.name}`
      : `Downloaded ${file.name}`;
  } finally {
    exportBusy = false;
    refreshBuildExport();
  }
}

async function runBuild(exportOnce: boolean) {
  if (
    buildControls.state.buildDisabled ||
    (exportOnce && buildControls.state.buildExportOnceDisabled)
  )
    return;
  if (!applyWorkingSource()) return;
  const selected = project?.manifest.buildProfiles.find(
    (profile) => profile.id === buildControls.state.profileId,
  );
  const quality =
    selected?.quality ??
    (buildControls.state.profileId === "final" ? "final" : "preview");
  if (hostedMap) {
    const map = hostedMap;
    const document = session.document;
    const sourceAtStart = source.value;
    const cameraAtStart = compiledPreviewCamera();
    const generation = ++buildGeneration;
    hostedBuildBusy = true;
    buildControls.update({
      buildDisabled: true,
      buildExportOnceDisabled: true,
    });
    buildControls.buildLogHidden = true;
    buildControls.buildStatus = `Checking hosted ${quality} build…`;
    try {
      if ((await new IndexedDbCollaborationOutbox().pending(map.id)).length > 0)
        throw new Error("Wait for hosted edits to sync before building");
      const result = await hostedBuildControls!.build(quality);
      if (generation !== buildGeneration || hostedMap?.id !== map.id) return;
      buildControls.buildOutput = [
        ...(result.result?.diagnostics ?? []).map(
          (entry) => `${entry.severity}: ${entry.stage}: ${entry.message}`,
        ),
        ...(result.result?.logs ?? []).map(
          (entry) => `${entry.stage}:\n${entry.text}`,
        ),
        ...(result.result?.error ? [result.result.error] : []),
      ].join("\n\n");
      buildControls.buildLogHidden = buildControls.buildOutput.length === 0;
      const bsp = result.result?.artifacts?.find(
        (artifact) => artifact.kind === "bsp",
      );
      if (result.status !== "succeeded" || !bsp) {
        buildControls.buildStatus = "Hosted build failed; see build messages";
      } else if (
        result.mapVersion === hostedMap.mapVersion &&
        session.document === document &&
        source.value === sourceAtStart
      ) {
        buildControls.buildStatus = "Hosted build succeeded · loading preview";
        installCompiledPreview(
          { bsp: hostedBuildArtifactPath(map.id, result.id, bsp.sha256) },
          document,
          sourceAtStart,
          cameraAtStart,
        );
      } else {
        buildControls.buildStatus =
          "Hosted build succeeded for an earlier map version; use build history to download it";
      }
    } catch (error) {
      if (generation === buildGeneration && hostedMap?.id === map.id)
        buildControls.buildStatus =
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
  const cameraAtStart = compiledPreviewCamera();
  const projectAtStart = project;
  const gameAtStart = activeGame();
  const bindingsAtStart = projectBindings;
  const preferredProfileId =
    selected && bindingsAtStart?.preferred(selected.id);
  const nameAtStart = mapName;
  const settingsAtStart = exportSettings;
  const autoExport = settingsAtStart.afterBuild || exportOnce;
  const generation = ++buildGeneration;
  localBuildBusy = true;
  latestBuildExport = null;
  buildControls.exportStatus = "";
  refreshBuildExport();
  buildControls.update({ buildDisabled: true, buildExportOnceDisabled: true });
  buildControls.buildStatus = `Building ${quality}…`;
  buildControls.buildLogHidden = true;
  try {
    const { result, profileId, previewSource, exportInput } = await buildMap({
      document,
      mapName: nameAtStart,
      project: projectAtStart,
      quality,
      game: gameAtStart,
      ...(preferredProfileId ? { preferredProfileId } : {}),
    });
    buildControls.buildOutput = [
      ...result.diagnostics.map(
        (entry) => `${entry.severity}: ${entry.stage}: ${entry.message}`,
      ),
      ...result.logs.map((entry) => `${entry.stage}:\n${entry.text}`),
    ].join("\n\n");
    buildControls.buildLogHidden = buildControls.buildOutput.length === 0;
    if (selected && bindingsAtStart && project === projectAtStart) {
      try {
        await bindingsAtStart.remember(selected.id, profileId);
      } catch {
        buildControls.buildOutput +=
          "\n\nBuild profile choice could not be saved in this browser";
        buildControls.buildLogHidden = false;
      }
    }
    if (
      session.document !== document ||
      project !== projectAtStart ||
      activeGame() !== gameAtStart ||
      mapName !== nameAtStart ||
      source.value !== sourceAtStart
    ) {
      buildControls.buildStatus =
        "Build finished; map changed, so result was not downloaded";
    } else if (
      result.status === "succeeded" &&
      result.artifacts.some((artifact) => artifact.kind === "bsp")
    ) {
      if (!autoExport) downloadBsp(result);
      const buildOutcome = autoExport ? "Build succeeded" : "BSP downloaded";
      buildControls.buildStatus = `${buildOutcome} · ${Math.round(result.elapsedMilliseconds / 1000)}s`;
      if (exportInput) {
        buildControls.exportStatus = "Preparing bundle…";
        if (previewSource) {
          buildControls.buildStatus += " · preparing preview resources";
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
            buildControls.exportStatus = "Bundle ready";
            refreshBuildExport();
            if (previewSource) {
              buildControls.buildStatus = `${buildOutcome} · loading compiled preview`;
              installCompiledPreview(
                previewSourceWithExportAssets(previewSource, prepared),
                document,
                sourceAtStart,
                cameraAtStart,
              );
            }
            if (autoExport) {
              try {
                await exportLatestBuild(settingsAtStart);
              } catch (error) {
                if (!isBuildExportCurrent(preparedBuild)) return;
                downloadBsp(result);
                buildControls.buildStatus =
                  "BSP downloaded · automatic export unavailable";
                buildControls.exportStatus =
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
            buildControls.exportStatus =
              error instanceof Error ? error.message : String(error);
            if (autoExport) downloadBsp(result);
            if (previewSource) {
              buildControls.buildStatus = `${autoExport ? "BSP downloaded" : buildOutcome} · loading compiled preview without companion assets`;
              installCompiledPreview(
                previewSource,
                document,
                sourceAtStart,
                cameraAtStart,
              );
            } else if (autoExport) {
              buildControls.buildStatus =
                "BSP downloaded · automatic export unavailable";
            }
          });
      } else if (previewSource) {
        buildControls.buildStatus += " · loading compiled preview";
        installCompiledPreview(
          previewSource,
          document,
          sourceAtStart,
          cameraAtStart,
        );
      } else {
        clearCompiledPreview();
        buildControls.buildStatus +=
          " · compiled preview unavailable for this format";
      }
    } else {
      buildControls.buildStatus = "Build failed; see build messages";
    }
  } catch (error) {
    buildControls.buildStatus =
      error instanceof Error ? error.message : String(error);
  } finally {
    localBuildBusy = false;
    setHostedEditability();
  }
}

async function exportCurrentBuild() {
  refreshBuildExport();
  const latest = latestBuildExport;
  if (!latest || buildControls.state.exportDisabled) return;
  try {
    await exportLatestBuild(exportSettings);
  } catch (error) {
    buildControls.exportStatus =
      error instanceof Error ? error.message : String(error);
  }
}

function downloadCurrentMap() {
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
}

function exportNormalizedMap() {
  if (hostedMap) {
    status.textContent = "Open a local copy before exporting normalized source";
    return;
  }
  if (!applyWorkingSource()) return;
  const normalizedName = mapName.replace(/\.map$/i, "") + ".normalized.map";
  downloadMapCopy(normalizedName, serializeMap(session.document));
  status.textContent = `Exported ${normalizedName} as a separate copy`;
}

function refreshVersions() {
  window.dispatchEvent(
    new CustomEvent<VersionsRefreshRequest>("tea-maps-versions-refresh", {
      detail: { mapId: hostedMap?.id ?? null },
    }),
  );
}

window.addEventListener("tea-maps-versions-restore", (event) => {
  event.preventDefault();
  const request = (event as CustomEvent<VersionsRestoreRequest>).detail;
  void (async () => {
    if (request.kind === "hosted") {
      const current = hostedMap;
      if (!current || current.id !== request.mapId) return;
      const snapshot = await readHostedCheckpointSource(
        request.mapId,
        request.checkpointId,
      );
      const parsed = parseMapSource(snapshot.source);
      if (hostedMap?.id !== request.mapId || !(await mayReplaceMap())) return;
      clearOpenedFile();
      localGame = current.game;
      mapName = `${current.slug}.map`;
      setMap(parsed.document, parsed.source);
      source.value = snapshot.source;
      scheduleDraftSave();
      versionsDialog.close();
      status.textContent = `Restored hosted checkpoint “${snapshot.checkpoint.name}” as a local copy · save to a file when ready`;
      return;
    }
    const { version } = request;
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
  })().then(request.resolve, request.reject);
});

async function createCheckpointFromControls(label: string): Promise<boolean> {
  if (hostedMap) {
    const map = hostedMap;
    if (!hostedConnection || map.role === "viewer") return false;
    try {
      if (await hostedConnection.pending()) {
        throw new Error("Wait for live brush edits to finish syncing");
      }
      const checkpoint = await createHostedCheckpoint(
        map.id,
        label.trim() || `Checkpoint v${map.mapVersion}`,
      );
      if (hostedMap?.id !== map.id) return false;
      status.textContent = `Hosted checkpoint “${checkpoint.name}” saved at v${checkpoint.mapVersion}`;
      if (versionsDialog.open) refreshVersions();
      return true;
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : String(error);
      return false;
    } finally {
      setHostedEditability();
    }
  }
  try {
    persistDraft();
    await saveQueue;
    const version = await createEditorCheckpoint(captureDraft(), label);
    status.textContent = `Protected checkpoint “${version.label}” saved on this device`;
    return true;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    return false;
  }
}

async function showVersionsFromControls() {
  try {
    if (!hostedMap) persistDraft();
    await saveQueue;
    versionsDialog.showModal();
    refreshVersions();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>(
  ".editor-toolbar button:not(.transform-nudge, #delete-selection, #duplicate-selection, #hide-selection, #isolate-selection, #show-all, #snap-to-grid, #copy-selection, #paste-cursor, #make-brush-entity, #make-structural, #add-point-entity, #move-selection, #rotate-selection, #scale-selection, #shear-selection, #flip-x, #flip-y, #flip-z, #undo, #redo, #new-map, #example-map, #open-map-button, #open-project, #save-map, #export-normalized, #create-checkpoint, #show-versions, #download-map, #build-map, #build-export-once, #toggle-compiled, #export-build, #selection-brush-touching, #selection-brush-inside, #selection-brush-projected, #select-all, #invert-selection, #focus-selection, #lock-selection, #unlock-all, #repeat-commands, #clear-repeat-commands, #paste-original)",
)) {
  button.disabled = false;
}
source.disabled = false;
buildControls.update({ profileDisabled: false });
loadCurrentExportSettings();
setHostedEditability();
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
  onUpdate(build, durationHint) {
    buildControls.buildStatus = `Hosted ${build.quality} build · ${build.status} · v${build.mapVersion}${(build.status === "queued" || build.status === "running") && durationHint ? ` · ${durationHint}` : ""}`;
  },
  preview(build, artifactPath) {
    void (async () => {
      const map = hostedMap;
      if (!map || map.mapVersion !== build.mapVersion) {
        buildControls.buildStatus = "This build is from an earlier map version";
        return;
      }
      if (
        (await new IndexedDbCollaborationOutbox().pending(map.id)).length > 0
      ) {
        buildControls.buildStatus =
          "Wait for hosted edits to sync before previewing";
        return;
      }
      if (hostedMap?.id !== map.id || hostedMap.mapVersion !== build.mapVersion)
        return;
      buildControls.buildStatus = "Loading hosted preview resources";
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
      buildControls.buildStatus = "Loading hosted compiled preview";
      installCompiledPreview(
        previewSource,
        session.document,
        source.value,
        compiledPreviewCamera(),
      );
    })().catch((error: unknown) => {
      buildControls.buildStatus =
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
    return openDetachedCopyAfterConfirmation(copy);
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

const detachedMapUrl = new URL(location.href);
const launchDetachedMap = detachedMapUrl.searchParams.get("detachedMap");
if (launchDetachedMap)
  void (async () => {
    const copy = await new IndexedDbCollaborationOutbox().loadDetached(
      launchDetachedMap,
    );
    if (!copy)
      throw new Error("This recovery copy is unavailable on this device");
    if (!(await openDetachedCopyAfterConfirmation(copy))) return;
    detachedMapUrl.searchParams.delete("detachedMap");
    history.replaceState(null, "", detachedMapUrl);
  })().catch((error: unknown) => {
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

void registerEditorWebMcpTools(
  document,
  () => ({
    session,
    name: mapName,
    workingSource: source.value,
    sourceState: mapSourceState,
    dirty: hasUnsavedChanges(),
    project,
    hostedMap,
    renderer,
    materials: currentMaterials(),
    activeTool: toolSettings.state.tool,
    canUndo: hostedMap
      ? (hostedConnection?.canUndo() ?? false)
      : session.canUndo,
    canRedo: hostedMap
      ? (hostedConnection?.canRedo() ?? false)
      : session.canRedo,
  }),
  {
    prepareEdit() {
      if (hostedMap && !hostedConnection)
        throw new Error("Join the hosted room before editing");
      if (source.value !== sourcePreview())
        throw new Error("Apply source edits before using site tools");
    },
    async history(action) {
      if (hostedMap) await hostedConnection![action]();
      else session[action]();
    },
    async openProjectMap(
      path,
      discardUnsavedChanges,
      expectedDocumentId,
      expectedRevision,
    ) {
      await openProjectMap(path, {
        expectedDocumentId,
        expectedRevision,
        discardUnsavedChanges,
      });
    },
    async replaceMapSource(text, name, expectedDocumentId, expectedRevision) {
      const parsed = parseMapSource(text);
      await checkSiteToolReplacement(
        expectedDocumentId,
        expectedRevision,
        true,
      );
      const game = activeGame();
      persistDraft();
      leaveHostedMap();
      setProject(null);
      localGame = game;
      openedFile = null;
      openedFingerprint = null;
      mapName = name;
      documentId = crypto.randomUUID();
      savedSource = "";
      setMap(parsed.document, parsed.source);
      persistDraft();
      await saveQueue;
    },
    setTool(next) {
      activateViewportTool(next);
    },
    status(message) {
      status.textContent = `Site tool: ${message}`;
    },
  },
);
