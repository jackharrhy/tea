import type { FaceMagnet } from "./face-magnet.js";
import {
  isBrushSelected,
  isPointEntitySelected,
  type BrushId,
  type BrushRayHit,
  type Bounds,
  type BrushSelection,
  type EditorSelection,
  type EntityId,
  type FaceAttributeTransferMode,
  type FaceSelection,
  type PointEntityRayHit,
  type TransformAxis,
  type Vec3,
} from "../core/index.js";
import type {
  EditorBrushDragEvent,
  EditorBrushCreateEvent,
  EditorCameraNavigationMode,
  EditorSweepDragEvent,
  EditorFaceDragEvent,
  EditorFaceTransferEvent,
  EditorHullCreateEvent,
  EditorPickIntent,
  EditorPointEntityPlaceEvent,
  EditorPointerPositionEvent,
  EditorTool,
  EditorTopologyDragEvent,
  EditorTopologyKind,
  EditorTransformDragEvent,
  EditorTransformPivotDragEvent,
  EditorViewportCameraState,
  EditorViewportContextMenuEvent,
  EditorViewportKind,
} from "./types.js";
import {
  type FaceHandle,
  type ScaleHandle,
  type TopologyHandle,
} from "./viewport-geometry.js";

export type EditorObjectRayHit = BrushRayHit | PointEntityRayHit;

export function isBrushRayHit(hit: EditorObjectRayHit): hit is BrushRayHit {
  return "brushId" in hit;
}

export function selectionForHit(hit: EditorObjectRayHit): EditorSelection {
  return isBrushRayHit(hit)
    ? { brushId: hit.brushId }
    : { entityId: hit.entityId };
}

export function selectionContainsHit(
  selection: EditorSelection | null,
  hit: EditorObjectRayHit,
): boolean {
  return isBrushRayHit(hit)
    ? isBrushSelected(selection, hit.brushId)
    : isPointEntitySelected(selection, hit.entityId);
}

export function preferredResizeFace(
  explicitHandle: FaceSelection | null,
  selectedVisibleFace: FaceSelection | null,
  proximateSelectedFace: FaceSelection | null,
  visibleFace: FaceSelection | null,
): FaceSelection | null {
  return (
    explicitHandle ??
    selectedVisibleFace ??
    proximateSelectedFace ??
    visibleFace
  );
}

export const FACE_HANDLE_HIT_RADIUS = 8;

export interface ViewportState {
  center: [number, number, number];
  yaw: number;
  pitch: number;
  distance: number;
  orthographicSpan: number;
  fieldOfViewRadians: number;
  flySpeed: number;
}

export type { EditorPipelines as Pipelines } from "./renderer-gpu.js";

export interface ViewportInteraction {
  currentTool(): EditorTool;
  hitTest(origin: Vec3, direction: Vec3): EditorObjectRayHit | null;
  hitTests(origin: Vec3, direction: Vec3): readonly EditorObjectRayHit[];
  currentSelection(): EditorSelection | null;
  brushCenter(selection: EditorSelection): Vec3 | null;
  brushBounds(selection: EditorSelection): Bounds | null;
  transformPivot(): Vec3 | null;
  faceHandle(selection: BrushSelection): FaceHandle | null;
  faceHandles(): readonly FaceHandle[];
  faceSnapTargets(
    source: FaceHandle,
    distance: number,
    padding: number,
  ): readonly FaceHandle[];
  snapClipHit(hit: BrushRayHit, gridSize: number): Vec3 | null;
  clipPoints(): readonly Vec3[];
  addClipPoints(
    points: readonly Vec3[],
    viewport: EditorViewportKind,
    viewDirection: Vec3,
  ): void;
  moveClipPoint(
    index: number,
    point: Vec3,
    viewport: EditorViewportKind,
    viewDirection: Vec3,
    axisRestriction: TransformAxis | null,
    phase: "preview" | "commit" | "cancel",
  ): void;
  matchClipFace(hit: BrushRayHit, viewport: EditorViewportKind): void;
  pick(
    selection: EditorSelection | null,
    viewport: EditorViewportKind,
    intent?: EditorPickIntent,
  ): void;
  hover(selection: EditorSelection | null): void;
  drag(event: EditorBrushDragEvent, tracePoints: readonly Vec3[]): void;
  placePointEntity(event: EditorPointEntityPlaceEvent): void;
  pointerPosition(event: EditorPointerPositionEvent): void;
  contextMenu(event: EditorViewportContextMenuEvent): void;
  entityPlacementBounds(): Bounds;
  brushFaceNormal(hit: BrushRayHit): Vec3 | null;
  create(event: EditorBrushCreateEvent): void;
  hull(event: EditorHullCreateEvent): void;
  hullPoints(): readonly Vec3[];
  previewHullPoints(points: readonly Vec3[]): void;
  addHullPoints(points: readonly Vec3[], viewport: "perspective"): void;
  addHullFace(
    face: FaceSelection,
    viewport: "perspective",
    clickedPoint?: Vec3,
  ): void;
  clearHullPreview(): void;
  brushFaceSelections(brushId: BrushId): readonly FaceSelection[];
  transfer(event: EditorFaceTransferEvent): void;
  face(event: EditorFaceDragEvent): void;
  selectFaceLasso(
    handles: readonly FaceHandle[],
    ensureSelected: boolean,
    viewport: EditorViewportKind,
  ): void;
  topologyHandles(kind: EditorTopologyKind): readonly TopologyHandle[];
  selectedTopologyHandles(): readonly TopologyHandle[];
  selectTopology(
    handle: TopologyHandle | null,
    additive: boolean,
  ): readonly TopologyHandle[];
  selectTopologyLasso(
    handles: readonly TopologyHandle[],
    additive: boolean,
  ): void;
  hoverTopology(handle: TopologyHandle | null): void;
  topology(
    event: EditorTopologyDragEvent,
    originalHandles: readonly TopologyHandle[],
  ): void;
  transform(event: EditorTransformDragEvent): void;
  hoverTransformPivot(hovered: boolean): void;
  moveTransformPivot(event: EditorTransformPivotDragEvent): void;
  cameraChanged(
    viewport: EditorViewportKind,
    mode: EditorCameraNavigationMode,
    camera: EditorViewportCameraState,
  ): void;
  sweepCaps(): readonly (readonly Vec3[])[];
  sweep(event: EditorSweepDragEvent): void;
}

export type TransformGesture =
  | {
      readonly tool: "pivot";
      readonly pivot: Vec3;
    }
  | {
      readonly tool: "rotate";
      readonly selection: EditorSelection;
      readonly pivot: Vec3;
      readonly axis: 0 | 1 | 2;
      readonly startVector: Vec3;
    }
  | {
      readonly tool: "scale";
      readonly selection: EditorSelection;
      readonly bounds: Bounds;
      readonly handle: ScaleHandle;
    }
  | {
      readonly tool: "shear";
      readonly selection: EditorSelection;
      readonly pivot: Vec3;
      readonly sourceAxis: 0 | 1 | 2;
      readonly targetAxis: 0 | 1 | 2;
      readonly sourceSpan: number;
    };

export type SweepGesture =
  | {
      readonly mode: "translate";
      readonly pivot: Vec3;
    }
  | {
      readonly mode: "rotate";
      readonly pivot: Vec3;
      readonly axis: TransformAxis;
      readonly startVector: Vec3;
    }
  | {
      readonly mode: "scale";
      readonly pivot: Vec3;
      readonly handle: Vec3;
    };

export interface PointerDrag {
  readonly button: number;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly hit: EditorSelection | null;
  readonly moveSelection: EditorSelection | null;
  readonly duplicating: boolean;
  readonly objectPainting: boolean;
  readonly paintedBrushIds: Set<BrushId>;
  readonly paintedEntityIds: Set<EntityId>;
  readonly faceSelection: EditorFaceDragEvent["selection"] | null;
  readonly facePainting: boolean;
  readonly faceSplitting: boolean;
  readonly faceStamping: boolean;
  readonly faceTranslating: boolean;
  readonly faceLassoEligible: boolean;
  readonly faceLassoEnsureSelected: boolean;
  readonly paintedFaceKeys: Set<string>;
  readonly faceScreenDirection: readonly [number, number] | null;
  readonly facePixelsPerWorld: number;
  readonly anchor: Vec3 | null;
  readonly planePoint: Vec3 | null;
  readonly planeNormal: Vec3;
  readonly creating: boolean;
  readonly placingEntity: boolean;
  readonly creationReferenceBounds: Bounds | null;
  readonly hullBuilding: boolean;
  readonly hullPoint: Vec3 | null;
  readonly hullFace: FaceSelection | null;
  readonly hullDuplicating: boolean;
  readonly faceTransferMode: FaceAttributeTransferMode | null;
  readonly faceTransferSource: FaceSelection | null;
  readonly faceTransferTargets: FaceSelection[];
  readonly clipping: boolean;
  readonly clipPoint: Vec3 | null;
  readonly clipPointIndex: number | null;
  readonly transform: TransformGesture | null;
  readonly sweep: SweepGesture | null;
  readonly topologyKind: EditorTopologyKind | null;
  readonly topologyHandle: TopologyHandle | null;
  readonly topologyHandles: readonly TopologyHandle[];
  readonly topologySnapTarget: TopologyHandle | null;
  readonly topologySelection: BrushSelection | null;
  readonly topologyOperation: EditorTopologyDragEvent["operation"];
  readonly topologyLassoAdditive: boolean;
  readonly cameraMode: "look" | "orbit" | "pan" | null;
  readonly cameraEye: Vec3 | null;
  readonly cameraOrbit: {
    readonly center: Vec3;
    readonly distance: number;
    readonly yaw: number;
    readonly pitch: number;
  } | null;
  cameraOrbitInitialized: boolean;
  x: number;
  y: number;
  moved: number;
  moving: boolean;
  faceMoving: boolean;
  faceLasso: boolean;
  transformMoving: boolean;
  pivotMoving: boolean;
  sweepMoving: boolean;
  topologyMoving: boolean;
  topologyLasso: boolean;
  clipMoving: boolean;
  hullMoving: boolean;
  faceTransferMoving: boolean;
  lastTopologySnapMode: "relative" | "absolute";
  lastMovementPlane: "viewport" | "xy" | "z";
  lastAxisRestriction: TransformAxis | null;
  lastDelta: Vec3;
  lastFaceDistance: number;
  readonly faceSource: FaceHandle | null;
  faceMagnet: FaceMagnet | null;
  faceAlignment: readonly FaceHandle[];
  lastBounds: Bounds | null;
  lastCreationConstraint: EditorBrushCreateEvent["constraint"];
  lastClipPoint: Vec3 | null;
  lastHullPoints: readonly Vec3[];
  lastTransform: EditorTransformDragEvent | null;
  lastPivot: EditorTransformPivotDragEvent | null;
  lastSweep: EditorSweepDragEvent | null;
}

export function initialState(kind: EditorViewportKind): ViewportState {
  return {
    center: kind === "perspective" ? [0, 0, 48] : [0, 0, 48],
    yaw: Math.PI * 0.72,
    pitch: -0.43,
    distance: 620,
    orthographicSpan: 640,
    fieldOfViewRadians: Math.PI / 3,
    flySpeed: 320,
  };
}
