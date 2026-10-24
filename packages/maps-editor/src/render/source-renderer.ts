import { HullDraft } from "./hull-draft.js";
import {
  brushesInDocument,
  createObjectSelection,
  deriveBrush,
  editorGroupForObject,
  findBrush,
  pointEntitiesInDocument,
  selectedBrushIds,
  selectedPointEntityIds,
  selectionForEditorGroup,
  type Bounds,
  type FaceSelection,
  type EditorObjectViewState,
  type EditorSelection,
  type EditorMaterial,
  type EntityLinkMode,
  type MapDocument,
  type Vec3,
} from "../core/index.js";
import { perspectiveForward } from "@jackharrhy/tea-maps-renderer/core";
import type {
  EditorSourceRendererOptions,
  EditorSpriteMaterial,
  EditorDiagnosticOverlay,
  EditorReferenceScene,
  EditorRemotePresenceOverlay,
  EditorTool,
  EditorTopologyKind,
  EditorTransformDragEvent,
  EditorViewportCameraState,
  EditorViewportKind,
} from "./types.js";
import {
  buildSceneBuffers,
  disposeSceneBuffers,
  objectSelectionBounds,
  type SceneBuffers,
  type SceneBuildInput,
} from "./scene-buffers.js";
import {
  buildEditorObjectSpatialIndex,
  type IndexedEditorObject,
} from "./object-spatial-index.js";
import type { BoundsSpatialIndex } from "../core/index.js";
import { SourceMaterialResources } from "./materials/source-material-resources.js";
import {
  availableFaceHandles as deriveAvailableFaceHandles,
  availableTopologyHandles as deriveAvailableTopologyHandles,
  encodedTopologyPoint,
  inferClipPlane,
  isTransformTool,
  topologyHandleBounds,
  topologyHandleKey,
  topologyHandleVertices,
  transformTopologyPoint,
  translatedTopologyHandle,
  type FaceHandle,
  type MovementTrace,
  type TopologyHandle,
} from "./viewport-geometry.js";

import {
  type EditorObjectRayHit,
  type Pipelines,
  type ViewportInteraction,
} from "./viewport-common.js";
import { createRendererGpuRuntime } from "./renderer-gpu.js";
import type { TgpuRoot, TgpuSampler } from "typegpu";
import {
  DEFAULT_EDITOR_RENDER_THEME,
  type EditorRenderTheme,
} from "./theme.js";
import { Viewport } from "./viewport.js";
import {
  brushFaceNormal,
  hitTestEditorObjects,
  interactionSelectionBounds,
  selectedFaceHandle,
  selectionCenter,
  snapClipHitToGrid,
  FaceSnapQuery,
} from "./source-renderer-queries.js";
const EMPTY_PREVIEW_OBJECT_IDS: readonly string[] = [];

function retainedObjectIds(
  current: readonly string[],
  incoming: readonly string[],
): readonly string[] {
  const unique = [...new Set(incoming)];
  return unique.length === current.length &&
    unique.every((id, index) => id === current[index])
    ? current
    : unique;
}

export class EditorSourceRenderer {
  private scene: SceneBuffers;
  private theme: EditorRenderTheme;
  private canonicalDocument: MapDocument;
  private readonly faceSnapQuery = new FaceSnapQuery();
  private document: MapDocument;
  private previewFaceOutlines: readonly FaceSelection[] | null = null;
  private previewDocument: MapDocument | null = null;
  private previewObjectIds = EMPTY_PREVIEW_OBJECT_IDS;
  private previewSelectionObjectIds = EMPTY_PREVIEW_OBJECT_IDS;
  private selection: EditorSelection | null;
  private objectViewState: EditorObjectViewState;
  private gridSize: number;
  private transformPivot: Vec3 | null;
  private transformPivotHovered = false;
  private transformPivotTrace: MovementTrace | null = null;
  private movementTraces: readonly MovementTrace[] = [];
  private hoverSelection: EditorSelection | null = null;
  private entityPlacementBounds: Bounds;
  private topologySelection: readonly TopologyHandle[] = [];
  private topologyHover: TopologyHandle | null = null;
  private clipPoints: readonly Vec3[] = [];
  private clipPlanePoints: readonly [Vec3, Vec3, Vec3] | null = null;
  private readonly hullDraft = new HullDraft(
    (event) => this.onHullCreate?.(event),
    () => this.rebuildScene(),
  );
  private sweepCaps: readonly (readonly Vec3[])[] = [];
  private lastClipViewport: EditorViewportKind = "perspective";
  private referenceScenes: readonly EditorReferenceScene[];
  private diagnosticOverlays: readonly EditorDiagnosticOverlay[];
  private remotePresence: readonly EditorRemotePresenceOverlay[];
  private sprites: readonly EditorSpriteMaterial[];
  private entityLinkMode: EntityLinkMode;
  private entityDefinitions: EditorSourceRendererOptions["entityDefinitions"];
  private objectSpatialIndex: BoundsSpatialIndex<IndexedEditorObject>;
  private openGroupId: string | null;
  private tool: EditorTool;
  private readonly materialResources: SourceMaterialResources;
  private readonly viewports: readonly Viewport[];
  private renderedViewportKinds: ReadonlySet<EditorViewportKind> = new Set();
  private readonly onClipPlaneChange: EditorSourceRendererOptions["onClipPlaneChange"];
  private readonly onHullCreate: EditorSourceRendererOptions["onHullCreate"];
  private readonly onTopologySelectionChange: EditorSourceRendererOptions["onTopologySelectionChange"];
  private readonly onRenderRequest: EditorSourceRendererOptions["onRenderRequest"];
  private readonly onPreviewDocument: EditorSourceRendererOptions["onPreviewDocument"];
  private sceneVersion = 0;
  private disposed = false;

  private constructor(
    private readonly root: TgpuRoot,
    private readonly device: GPUDevice,
    format: GPUTextureFormat,
    pipelines: Pipelines,
    materialSampler: TgpuSampler,
    options: EditorSourceRendererOptions,
    private clearColor: readonly [number, number, number, number],
  ) {
    this.canonicalDocument = options.document;
    this.document = options.document;
    this.theme = options.theme ?? DEFAULT_EDITOR_RENDER_THEME;
    this.selection = options.selection ?? null;
    this.objectViewState = options.objectViewState ?? {
      hiddenBrushIds: [],
      hiddenEntityIds: [],
      lockedBrushIds: [],
      lockedEntityIds: [],
    };
    this.gridSize = Math.max(1, options.gridSize ?? 16);
    this.transformPivot = options.transformPivot ?? null;
    this.entityPlacementBounds = options.entityPlacementBounds ?? {
      min: [-8, -8, -8],
      max: [8, 8, 8],
    };
    this.referenceScenes = options.referenceScenes ?? [];
    this.diagnosticOverlays = options.diagnosticOverlays ?? [];
    this.remotePresence = options.remotePresence ?? [];
    this.sprites = options.sprites ?? [];
    this.entityLinkMode = options.entityLinkMode ?? "direct";
    this.entityDefinitions = options.entityDefinitions;
    this.objectSpatialIndex = buildEditorObjectSpatialIndex(
      this.document,
      this.entityDefinitions,
    );
    this.openGroupId = options.openGroupId ?? null;
    this.tool = options.tool ?? "select";
    this.onClipPlaneChange = options.onClipPlaneChange;
    this.onHullCreate = options.onHullCreate;
    this.onTopologySelectionChange = options.onTopologySelectionChange;
    this.onRenderRequest = options.onRenderRequest;
    this.onPreviewDocument = options.onPreviewDocument;
    void device.lost.then((info) => {
      if (this.disposed) return;
      options.onDeviceLost?.(
        `WebGPU device lost${info.message ? `: ${info.message}` : ""}`,
      );
    });
    this.scene = buildSceneBuffers(device, this.sceneInput()).scene;
    this.materialResources = new SourceMaterialResources(
      root,
      materialSampler,
      options.materials ?? [],
      this.sprites,
    );
    const hitTests = (
      origin: Vec3,
      direction: Vec3,
    ): readonly EditorObjectRayHit[] =>
      hitTestEditorObjects(
        this.objectSpatialIndex,
        this.objectViewState,
        this.entityDefinitions,
        origin,
        direction,
      );
    const hitTest = (
      origin: Vec3,
      direction: Vec3,
    ): EditorObjectRayHit | null => hitTests(origin, direction)[0] ?? null;
    const interaction: ViewportInteraction = {
      currentTool: () => this.tool,
      hitTest,
      hitTests,
      entityPlacementBounds: () => this.entityPlacementBounds,
      brushFaceNormal: (hit) => brushFaceNormal(this.document, hit),
      currentSelection: () => this.selection,
      transformPivot: () => this.transformPivot,
      brushCenter: (selection) => selectionCenter(this.document, selection),
      brushBounds: (selection) =>
        interactionSelectionBounds(
          this.document,
          selection,
          this.tool,
          this.topologySelection,
        ),
      faceHandle: (selection) => selectedFaceHandle(this.document, selection),
      faceHandles: () => this.availableFaceHandles(),
      faceSnapTargets: (source, distance, padding) =>
        this.faceSnapQuery.query(
          this.canonicalDocument,
          this.selection,
          this.objectViewState,
          source,
          distance,
          padding,
        ),
      snapClipHit: (hit, gridSize) =>
        snapClipHitToGrid(this.document, hit, gridSize),
      clipPoints: () => this.clipPoints,
      addClipPoints: (points, viewport, viewDirection) => {
        const base = this.clipPoints.length >= 3 ? [] : this.clipPoints;
        this.clipPoints = [...base, ...points].slice(0, 3);
        this.clipPlanePoints = inferClipPlane(this.clipPoints, viewDirection);
        this.lastClipViewport = viewport;
        this.rebuildScene();
        this.onClipPlaneChange?.({
          viewport,
          points: this.clipPoints,
          planePoints: this.clipPlanePoints,
        });
      },
      moveClipPoint: (
        index,
        point,
        viewport,
        viewDirection,
        axisRestriction,
        phase,
      ) => {
        if (!this.clipPoints[index]) return;
        this.clipPoints = this.clipPoints.map((existing, pointIndex) =>
          pointIndex === index ? point : existing,
        );
        this.clipPlanePoints = inferClipPlane(this.clipPoints, viewDirection);
        this.lastClipViewport = viewport;
        this.rebuildScene();
        this.onClipPlaneChange?.({
          viewport,
          points: this.clipPoints,
          planePoints: this.clipPlanePoints,
          movingPointIndex: index,
          pointMovePhase: phase,
          axisRestriction,
        });
      },
      matchClipFace: (hit, viewport) => {
        const brush = findBrush(this.document, hit.brushId);
        const face = brush?.faces.find(
          (candidate) => candidate.id === hit.faceId,
        );
        if (!face) return;
        this.clipPoints = face.planePoints;
        this.clipPlanePoints = face.planePoints;
        this.lastClipViewport = viewport;
        this.rebuildScene();
        this.onClipPlaneChange?.({
          viewport,
          points: this.clipPoints,
          planePoints: this.clipPlanePoints,
        });
      },
      pick: (selection, viewport, intent) =>
        options.onPick?.(
          selection,
          viewport,
          intent ?? { additive: false, expansion: "single" },
        ),
      hover: (selection) => {
        const containingGroup =
          selection && !selection.faceId
            ? editorGroupForObject(this.document, selection, this.openGroupId)
            : null;
        const effectiveSelection = containingGroup
          ? selectionForEditorGroup(
              containingGroup,
              selection?.brushId
                ? { kind: "brush", brushId: selection.brushId }
                : selection?.entityId
                  ? { kind: "entity", entityId: selection.entityId }
                  : null,
            )
          : selection;
        if (
          this.hoverSelection?.brushId === effectiveSelection?.brushId &&
          this.hoverSelection?.faceId === effectiveSelection?.faceId &&
          this.hoverSelection?.entityId === effectiveSelection?.entityId &&
          selectedBrushIds(this.hoverSelection).join("\u0000") ===
            selectedBrushIds(effectiveSelection).join("\u0000") &&
          selectedPointEntityIds(this.hoverSelection).join("\u0000") ===
            selectedPointEntityIds(effectiveSelection).join("\u0000")
        )
          return;
        this.hoverSelection = effectiveSelection;
        this.rebuildScene();
      },
      drag: (event, tracePoints) => {
        const version = this.sceneVersion;
        this.movementTraces =
          event.phase === "preview"
            ? tracePoints.map((point) => ({
                start: [...point] as Vec3,
                end: [
                  point[0] + event.delta[0],
                  point[1] + event.delta[1],
                  point[2] + event.delta[2],
                ] as Vec3,
                axisRestriction: event.axisRestriction,
              }))
            : [];
        options.onBrushDrag?.(event);
        if (this.sceneVersion === version) this.rebuildScene();
      },
      placePointEntity: (event) => options.onPointEntityPlace?.(event),
      pointerPosition: (event) => options.onPointerPosition?.(event),
      contextMenu: (event) => options.onContextMenu?.(event),
      create: (event) => options.onBrushCreate?.(event),
      hull: (event) => this.onHullCreate?.(event),
      hullPoints: () => this.hullDraft.points,
      previewHullPoints: (points) => this.hullDraft.setPreview(points),
      addHullPoints: (points, viewport) =>
        this.hullDraft.replace([...this.hullDraft.points, ...points], viewport),
      addHullFace: (face, viewport, clickedPoint) => {
        const brush = findBrush(this.document, face.brushId);
        const derivedFace = brush
          ? deriveBrush(brush).faces.find(
              (candidate) => candidate.faceId === face.faceId,
            )
          : null;
        if (!derivedFace) return;
        const clickedKey = clickedPoint
          ? encodedTopologyPoint(clickedPoint)
          : null;
        this.hullDraft.replace(
          [
            ...this.hullDraft.points.filter(
              (point) => encodedTopologyPoint(point) !== clickedKey,
            ),
            ...derivedFace.vertices,
          ],
          viewport,
        );
      },
      clearHullPreview: () => {
        if (this.hullDraft.preview.length) this.hullDraft.setPreview([]);
      },
      brushFaceSelections: (brushId) => {
        const brush = findBrush(this.document, brushId);
        return brush?.faces.map((face) => ({ brushId, faceId: face.id })) ?? [];
      },
      transfer: (event) => options.onFaceTransfer?.(event),
      face: (event) => options.onFaceDrag?.(event),
      selectFaceLasso: (handles, ensureSelected, viewport) =>
        options.onFaceLasso?.(
          handles.map((handle) => handle.selection),
          viewport,
          ensureSelected,
        ),
      topologyHandles: (kind) => this.availableTopologyHandles(kind),
      selectedTopologyHandles: () => this.topologySelection,
      selectTopology: (handle, additive) => {
        if (!handle) {
          if (!additive && this.topologySelection.length > 0) {
            this.topologySelection = [];
            options.onTopologySelectionChange?.(
              this.tool as EditorTopologyKind,
              0,
              [],
            );
            this.rebuildScene();
          }
          return this.topologySelection;
        }
        const compatible = this.topologySelection.filter(
          (candidate) => candidate.kind === handle.kind,
        );
        const selected = compatible.some(
          (candidate) => candidate.key === handle.key,
        );
        this.topologySelection = additive
          ? selected
            ? compatible.filter((candidate) => candidate.key !== handle.key)
            : [...compatible, handle]
          : selected
            ? compatible
            : [handle];
        options.onTopologySelectionChange?.(
          handle.kind,
          this.topologySelection.length,
          topologyHandleVertices(this.topologySelection),
        );
        this.rebuildScene();
        return this.topologySelection;
      },
      selectTopologyLasso: (handles, additive) => {
        const kind = handles[0]?.kind ?? (this.tool as EditorTopologyKind);
        const selected = new Map(
          this.topologySelection
            .filter((handle) => handle.kind === kind)
            .map((handle) => [handle.key, handle] as const),
        );
        for (const handle of handles) {
          if (additive) selected.set(handle.key, handle);
          else if (selected.has(handle.key)) selected.delete(handle.key);
          else selected.set(handle.key, handle);
        }
        this.topologySelection = [...selected.values()];
        options.onTopologySelectionChange?.(
          kind,
          this.topologySelection.length,
          topologyHandleVertices(this.topologySelection),
        );
        this.rebuildScene();
      },
      hoverTopology: (handle) => {
        if (this.topologyHover?.key === handle?.key) return;
        this.topologyHover = handle;
        this.rebuildScene();
      },
      topology: (event, originalHandles) => {
        const version = this.sceneVersion;
        this.movementTraces =
          event.phase === "preview"
            ? originalHandles.map((handle) => ({
                start: [...handle.center] as Vec3,
                end: [
                  handle.center[0] + event.delta[0],
                  handle.center[1] + event.delta[1],
                  handle.center[2] + event.delta[2],
                ] as Vec3,
                axisRestriction: event.axisRestriction,
              }))
            : [];
        this.topologySelection =
          event.phase === "cancel"
            ? originalHandles
            : originalHandles.map((handle) =>
                translatedTopologyHandle(handle, event.delta),
              );
        this.topologyHover = null;
        options.onTopologySelectionChange?.(
          event.kind,
          this.topologySelection.length,
          topologyHandleVertices(this.topologySelection),
        );
        options.onTopologyDrag?.(event);
        if (this.sceneVersion === version) this.rebuildScene();
      },
      transform: (event) => options.onTransformDrag?.(event),
      hoverTransformPivot: (hovered) => {
        if (this.transformPivotHovered === hovered) return;
        this.transformPivotHovered = hovered;
        this.rebuildScene();
      },
      moveTransformPivot: (event) => {
        this.transformPivot = [...event.pivot] as Vec3;
        this.transformPivotHovered = true;
        this.transformPivotTrace =
          event.phase === "preview"
            ? {
                start: [...event.startPivot] as Vec3,
                end: [...event.pivot] as Vec3,
                axisRestriction: event.axisRestriction,
              }
            : null;
        options.onTransformPivotDrag?.(event);
        this.rebuildScene();
      },
      cameraChanged: (viewport, mode, camera) => {
        if (viewport !== "perspective" && (mode === "pan" || mode === "zoom")) {
          for (const linkedViewport of this.viewports) {
            linkedViewport.synchronizeOrthographicCamera(
              viewport,
              camera,
              mode === "zoom",
            );
          }
        }
        this.onRenderRequest?.();
        options.onCameraChange?.({ viewport, mode, camera });
      },
      sweepCaps: () => this.sweepCaps,
      sweep: (event) => options.onSweepDrag?.(event),
    };
    this.viewports = (
      Object.entries(options.canvases) as [
        EditorViewportKind,
        HTMLCanvasElement,
      ][]
    ).map(
      ([kind, canvas]) =>
        new Viewport(
          root,
          format,
          pipelines,
          kind,
          canvas,
          interaction,
          this.gridSize,
          () => this.onRenderRequest?.(),
          this.theme,
          options.viewportOverlays?.[kind],
        ),
    );
    this.renderedViewportKinds = new Set(
      this.viewports.map((viewport) => viewport.kind),
    );
    for (const viewport of this.viewports) {
      options.onCameraChange?.({
        viewport: viewport.kind,
        mode: "initial",
        camera: viewport.camera,
      });
    }
  }

  public static async create(
    options: EditorSourceRendererOptions,
  ): Promise<EditorSourceRenderer> {
    const { root, device, format, pipelines, materialSampler } =
      await createRendererGpuRuntime();
    if (options.signal?.aborted) {
      root.destroy();
      options.signal.throwIfAborted();
    }
    return new EditorSourceRenderer(
      root,
      device,
      format,
      pipelines,
      materialSampler,
      options,
      options.clearColor ??
        options.theme?.background ??
        DEFAULT_EDITOR_RENDER_THEME.background,
    );
  }

  private availableTopologyHandles(
    kind: EditorTopologyKind,
  ): readonly TopologyHandle[] {
    return deriveAvailableTopologyHandles(this.document, this.selection, kind);
  }

  private availableFaceHandles(): readonly FaceHandle[] {
    return deriveAvailableFaceHandles(this.document, this.selection);
  }

  public setDocument(
    document: MapDocument,
    selection: EditorSelection | null = this.selection,
    objectViewState: EditorObjectViewState = this.objectViewState,
  ): void {
    if (this.disposed) return;
    this.canonicalDocument = document;
    this.previewDocument = null;
    this.previewFaceOutlines = null;
    this.previewObjectIds = EMPTY_PREVIEW_OBJECT_IDS;
    this.previewSelectionObjectIds = EMPTY_PREVIEW_OBJECT_IDS;
    this.installActiveDocument(document, selection, objectViewState);
  }

  /** Installs a transient drag candidate without replacing the retained committed world. */
  public setPreviewDocument(
    document: MapDocument,
    selection: EditorSelection | null,
    affectedObjectIds: readonly string[],
    highlightedObjectIds: readonly string[] = affectedObjectIds,
    faceOutlines: readonly FaceSelection[] | null = null,
  ): void {
    if (this.disposed) return;
    this.previewObjectIds = retainedObjectIds(
      this.previewObjectIds,
      affectedObjectIds,
    );
    this.previewSelectionObjectIds = retainedObjectIds(
      this.previewSelectionObjectIds,
      highlightedObjectIds,
    );
    this.previewDocument = document;
    this.previewFaceOutlines = faceOutlines;
    this.installActiveDocument(document, selection, this.objectViewState);
  }

  private installActiveDocument(
    document: MapDocument,
    selection: EditorSelection | null,
    objectViewState: EditorObjectViewState,
  ): void {
    const documentChanged = document !== this.document;
    this.document = document;
    if (documentChanged)
      this.objectSpatialIndex = buildEditorObjectSpatialIndex(
        document,
        this.entityDefinitions,
      );
    this.selection = selection;
    this.objectViewState = objectViewState;
    this.onPreviewDocument?.(document);
    const topologyKind =
      this.tool === "vertex" || this.tool === "edge" ? this.tool : null;
    if (topologyKind) {
      const previousCount = this.topologySelection.length;
      const available = new Map(
        this.availableTopologyHandles(topologyKind).map(
          (handle) => [handle.key, handle] as const,
        ),
      );
      this.topologySelection = this.topologySelection.flatMap((handle) => {
        const replacement = available.get(handle.key);
        return replacement ? [replacement] : [];
      });
      if (this.topologySelection.length === 0) {
        this.topologyHover = null;
      }
      if (previousCount !== this.topologySelection.length) {
        this.onTopologySelectionChange?.(
          topologyKind,
          this.topologySelection.length,
          topologyHandleVertices(this.topologySelection),
        );
      }
    }
    this.rebuildScene();
  }

  public setReferenceScenes(
    referenceScenes: readonly EditorReferenceScene[],
  ): void {
    if (this.disposed) return;
    this.referenceScenes = referenceScenes;
    this.rebuildScene();
  }

  public setRemotePresence(
    presence: readonly EditorRemotePresenceOverlay[],
  ): void {
    if (this.disposed) return;
    this.remotePresence = presence;
    this.rebuildScene();
  }

  public setEntityLinkMode(mode: EntityLinkMode): void {
    if (this.disposed || mode === this.entityLinkMode) return;
    this.entityLinkMode = mode;
    this.rebuildScene();
  }

  public setOpenGroupId(groupId: string | null): void {
    if (this.disposed || groupId === this.openGroupId) return;
    this.openGroupId = groupId;
    this.rebuildScene();
  }

  public setObjectViewState(state: EditorObjectViewState): void {
    if (this.disposed) return;
    this.objectViewState = {
      hiddenBrushIds: [...state.hiddenBrushIds],
      hiddenEntityIds: [...state.hiddenEntityIds],
      lockedBrushIds: [...state.lockedBrushIds],
      lockedEntityIds: [...state.lockedEntityIds],
    };
    this.hoverSelection = null;
    this.topologySelection = [];
    this.topologyHover = null;
    this.rebuildScene();
  }

  public setTransformPivot(pivot: Vec3 | null): void {
    if (this.disposed) return;
    if (pivot && !pivot.every(Number.isFinite))
      throw new Error("Transform pivot must be finite");
    if (
      this.transformPivot === pivot ||
      (this.transformPivot &&
        pivot &&
        this.transformPivot.every(
          (component, axis) => component === pivot[axis],
        ))
    ) {
      return;
    }
    this.transformPivot = pivot ? ([...pivot] as Vec3) : null;
    this.rebuildScene();
  }

  private sceneInput(): SceneBuildInput {
    return {
      world: {
        document: this.canonicalDocument,
        objectViewState: this.objectViewState,
        sprites: this.sprites,
      },
      localPreview: {
        document: this.previewDocument,
        objectIds: this.previewObjectIds,
        selectionObjectIds: this.previewSelectionObjectIds,
        faceOutlines: this.previewFaceOutlines,
      },
      selection: { current: this.selection, hovered: this.hoverSelection },
      tools: {
        active: this.tool,
        gridSize: this.gridSize,
        transformPivot: this.transformPivot,
        transformPivotHovered: this.transformPivotHovered,
        transformPivotTrace: this.transformPivotTrace,
        movementTraces: this.movementTraces,
        clipPoints: this.clipPoints,
        hullPoints: this.hullDraft.points,
        hullPreviewPoints: this.hullDraft.preview,
        sweepCaps: this.sweepCaps,
        topologySelection: this.topologySelection,
        topologyHover: this.topologyHover,
        entityLinkMode: this.entityLinkMode,
        openGroupId: this.openGroupId,
      },
      references: this.referenceScenes,
      diagnostics: this.diagnosticOverlays,
      remotePresence: this.remotePresence,
      entityDefinitions: this.entityDefinitions,
      theme: this.theme,
    };
  }

  private rebuildScene(): void {
    const started = performance.now();
    const previous = this.scene;
    const result = buildSceneBuffers(this.device, this.sceneInput(), previous);
    this.scene = result.scene;
    if (result.rebuilt.size === 0) return;
    this.sceneVersion += 1;
    performance.measure("worldview.editor.scene-rebuild", {
      start: started,
      end: performance.now(),
    });
    this.onRenderRequest?.();
  }

  public setMaterials(materials: readonly EditorMaterial[]): void {
    if (this.disposed) return;
    this.materialResources.setMaterials(materials);
    this.sceneVersion += 1;
    this.onRenderRequest?.();
  }

  public setTheme(theme: EditorRenderTheme): void {
    if (this.disposed) return;
    this.theme = theme;
    this.clearColor = theme.background;
    for (const viewport of this.viewports) viewport.setTheme(theme);
    this.rebuildScene();
  }

  public setSprites(sprites: readonly EditorSpriteMaterial[]): void {
    if (this.disposed) return;
    this.sprites = sprites;
    this.materialResources.setSprites(sprites);
    this.rebuildScene();
  }

  public setEntityDefinitions(
    entityDefinitions: EditorSourceRendererOptions["entityDefinitions"],
  ): void {
    if (this.entityDefinitions === entityDefinitions) return;
    this.entityDefinitions = entityDefinitions;
    this.objectSpatialIndex = buildEditorObjectSpatialIndex(
      this.document,
      entityDefinitions,
    );
    this.rebuildScene();
  }

  public setDiagnosticOverlays(
    overlays: readonly EditorDiagnosticOverlay[],
  ): void {
    if (this.disposed) return;
    this.diagnosticOverlays = overlays;
    this.rebuildScene();
  }

  public setSelection(selection: EditorSelection | null): void {
    if (this.previewDocument)
      this.installActiveDocument(
        this.previewDocument,
        selection,
        this.objectViewState,
      );
    else this.setDocument(this.canonicalDocument, selection);
  }

  public setEntityPlacementBounds(bounds: Bounds): void {
    this.entityPlacementBounds = bounds;
  }

  public clearTopologySelection(): void {
    if (this.topologySelection.length === 0) return;
    const kind = this.topologySelection[0]!.kind;
    this.topologySelection = [];
    this.topologyHover = null;
    this.onTopologySelectionChange?.(kind, 0, []);
    this.rebuildScene();
  }

  /** Prepares selected component handles for an immediately following translated document commit. */
  public translateTopologySelection(delta: Vec3): void {
    if (!delta.every(Number.isFinite))
      throw new Error("Topology translation must be finite");
    const kind = this.topologySelection[0]?.kind;
    if (!kind) return;
    this.topologySelection = this.topologySelection.map((handle) =>
      translatedTopologyHandle(handle, delta),
    );
    this.topologyHover = null;
    this.onTopologySelectionChange?.(
      kind,
      this.topologySelection.length,
      topologyHandleVertices(this.topologySelection),
    );
  }

  public remapTopologySelection(event: EditorTransformDragEvent): void {
    const kind = this.topologySelection[0]?.kind;
    if (!kind) return;
    const desiredKeys = new Set(
      this.topologySelection.map((handle) =>
        topologyHandleKey(
          kind,
          handle.vertices.map((point) => transformTopologyPoint(point, event)),
        ),
      ),
    );
    this.topologySelection = this.availableTopologyHandles(kind).filter(
      (handle) => desiredKeys.has(handle.key),
    );
    this.topologyHover = null;
    this.onTopologySelectionChange?.(
      kind,
      this.topologySelection.length,
      topologyHandleVertices(this.topologySelection),
    );
    this.rebuildScene();
  }

  public setSweepCaps(caps: readonly (readonly Vec3[])[]): void {
    if (this.disposed) return;
    this.sweepCaps = caps;
    this.rebuildScene();
  }

  public setTool(tool: EditorTool): void {
    if (this.disposed || tool === this.tool) return;
    for (const viewport of this.viewports) viewport.cancelInteraction();
    this.hoverSelection = null;
    if (tool !== "rotate") {
      this.transformPivotHovered = false;
      this.transformPivotTrace = null;
    }
    if (this.tool === "clip" && tool !== "clip") this.clearClipPlane();
    if (this.tool === "hull" && tool !== "hull") this.clearHullPoints();
    if (this.tool === "sweep" && tool !== "sweep") this.sweepCaps = [];
    const selectedTopologyKind = this.topologySelection[0]?.kind ?? null;
    const preserveTopology =
      isTransformTool(tool) ||
      (selectedTopologyKind !== null && tool === selectedTopologyKind);
    if (
      tool !== this.tool &&
      this.topologySelection.length > 0 &&
      !preserveTopology
    ) {
      const previousTopologyTool: EditorTopologyKind | null =
        selectedTopologyKind ??
        (this.tool === "vertex" || this.tool === "edge" ? this.tool : null);
      this.topologySelection = [];
      this.topologyHover = null;
      if (previousTopologyTool)
        this.onTopologySelectionChange?.(previousTopologyTool, 0, []);
    }
    this.tool = tool;
    this.rebuildScene();
  }

  public clearClipPlane(): void {
    if (this.clipPoints.length === 0 && !this.clipPlanePoints) return;
    this.clipPoints = [];
    this.clipPlanePoints = null;
    this.rebuildScene();
    this.notifyClipPlaneChange();
  }

  public get hullHistoryActive(): boolean {
    return this.tool === "hull" && this.hullDraft.hasHistory;
  }
  public get canUndoHull(): boolean {
    return this.hullHistoryActive && this.hullDraft.canUndo;
  }
  public get canRedoHull(): boolean {
    return this.hullHistoryActive && this.hullDraft.canRedo;
  }
  public undoHull(): boolean {
    return this.changeHullHistory("undo");
  }
  public redoHull(): boolean {
    return this.changeHullHistory("redo");
  }
  private changeHullHistory(direction: "undo" | "redo"): boolean {
    if (!this.hullHistoryActive) return false;
    this.hullDraft.changeHistory(direction);
    return true;
  }
  public commitHullBrush(): boolean {
    if (this.tool !== "hull" || !this.hullDraft.points.length) return false;
    this.hullDraft.commit();
    return true;
  }
  public clearHullPoints(): boolean {
    return this.hullDraft.clear();
  }

  public removeLastClipPoint(): boolean {
    if (this.clipPoints.length === 0) return false;
    this.clipPoints = this.clipPoints.slice(0, -1);
    const viewport = this.viewports.find(
      (candidate) => candidate.kind === this.lastClipViewport,
    );
    const direction =
      this.lastClipViewport === "xy"
        ? ([0, 0, -1] as const)
        : this.lastClipViewport === "xz"
          ? ([0, 1, 0] as const)
          : this.lastClipViewport === "yz"
            ? ([-1, 0, 0] as const)
            : viewport?.camera
              ? perspectiveForward(viewport.camera.yaw, viewport.camera.pitch)
              : ([0, 1, 0] as const);
    this.clipPlanePoints = inferClipPlane(this.clipPoints, direction);
    this.rebuildScene();
    this.notifyClipPlaneChange();
    return true;
  }

  private notifyClipPlaneChange(): void {
    this.onClipPlaneChange?.({
      viewport: this.lastClipViewport,
      points: this.clipPoints,
      planePoints: this.clipPlanePoints,
    });
  }

  public setGridSize(gridSize: number): void {
    if (this.disposed) return;
    const next = Math.max(1, gridSize);
    if (next === this.gridSize) return;
    this.gridSize = next;
    for (const viewport of this.viewports) viewport.setGridSize(next);
    this.rebuildScene();
  }

  public setRenderedViewports(kinds: readonly EditorViewportKind[]): void {
    if (this.disposed) return;
    const next = new Set(kinds);
    if (
      next.size === this.renderedViewportKinds.size &&
      [...next].every((kind) => this.renderedViewportKinds.has(kind))
    ) {
      return;
    }
    this.renderedViewportKinds = next;
    for (const viewport of this.viewports) {
      if (next.has(viewport.kind)) viewport.invalidateRender();
      else viewport.cancelInteraction();
    }
    this.onRenderRequest?.();
  }

  public render(): boolean {
    if (this.disposed) return false;
    const materialBindGroup = (name: string) =>
      this.materialResources.bindGroup(name);
    const encoder = this.device.createCommandEncoder({
      label: "Worldview editor frame",
    });
    let encoded = false;
    const renderedViewports = this.viewports.filter((viewport) =>
      this.renderedViewportKinds.has(viewport.kind),
    );
    for (const viewport of renderedViewports) {
      encoded =
        viewport.render(
          this.scene,
          materialBindGroup,
          this.clearColor,
          this.sceneVersion,
          encoder,
        ) || encoded;
    }
    if (encoded) this.device.queue.submit([encoder.finish()]);
    return renderedViewports.some(
      (viewport) => viewport.requiresContinuousRender,
    );
  }

  public viewportCamera(
    kind: EditorViewportKind,
  ): EditorViewportCameraState | null {
    return (
      this.viewports.find((viewport) => viewport.kind === kind)?.camera ?? null
    );
  }

  public setPerspectiveFieldOfView(fieldOfViewDegrees: number): void {
    if (this.disposed || !Number.isFinite(fieldOfViewDegrees)) return;
    const viewport = this.viewports.find((view) => view.kind === "perspective");
    if (viewport)
      viewport.restoreCamera({ ...viewport.camera, fieldOfViewDegrees });
  }

  public restoreViewportCameras(
    cameras: Readonly<Record<EditorViewportKind, EditorViewportCameraState>>,
  ): void {
    if (this.disposed) return;
    for (const viewport of this.viewports)
      viewport.restoreCamera(cameras[viewport.kind]);
  }

  public focusSelection(): boolean {
    if (this.disposed) return false;
    const bounds =
      this.topologySelection.length > 0
        ? topologyHandleBounds(this.topologySelection)
        : objectSelectionBounds(this.document, this.selection);
    if (!bounds) return false;
    for (const viewport of this.viewports) viewport.focusBounds(bounds);
    return true;
  }

  public focusDocument(): boolean {
    if (this.disposed) return false;
    const bounds = objectSelectionBounds(
      this.document,
      createObjectSelection(
        brushesInDocument(this.document).map((brush) => brush.id),
        pointEntitiesInDocument(this.document).map((entity) => entity.id),
      ),
    );
    if (!bounds) return false;
    for (const viewport of this.viewports) viewport.focusBounds(bounds);
    return true;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    disposeSceneBuffers(this.scene);
    this.materialResources.dispose();
    for (const viewport of this.viewports) viewport.dispose();
    this.root.destroy();
  }
}
