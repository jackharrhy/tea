import type {
  Bounds,
  BrushId,
  BrushSelection,
  EditorObjectViewState,
  EditorSelection,
  EditorMaterial,
  EntityDefinitionCatalog,
  EntityLinkMode,
  FaceAttributeTransferMode,
  FaceId,
  FaceSelection,
  MapDocument,
  TransformAxis,
  Vec3,
} from "../core/index.js";
import type { EditorRenderTheme } from "./theme.js";

export type EditorViewportKind = "perspective" | "xy" | "xz" | "yz";
export type EditorTool =
  | "select"
  | "entity"
  | "create"
  | "hull"
  | "face"
  | "sweep"
  | "clip"
  | "vertex"
  | "edge"
  | "rotate"
  | "scale"
  | "shear";

export interface EditorPickIntent {
  /** Adds or toggles the hit faces instead of replacing the current face selection. */
  readonly additive: boolean;
  /** Adds or toggles a brush in the current object selection. */
  readonly objectAdditive?: boolean;
  /** Expands a face hit to one face, every face on its brush, or a connected coplanar surface. */
  readonly expansion: "single" | "brush" | "coplanar";
  /** The hit was accumulated by a continuous face paint-selection gesture. */
  readonly paint?: boolean;
  /** Activates a group on double-click, or selects every brush owned by an ungrouped brush entity. */
  readonly objectExpansion?: "single" | "siblings" | "activate";
  /** The hit was reached by Ctrl/Command-wheel selection drilling beneath the pointer. */
  readonly drill?: "farther" | "nearer";
  /** Distinguishes ordinary object drilling from Shift-modified face drilling. */
  readonly drillTarget?: "object" | "face";
}

export type EditorBrushDragPhase = "preview" | "commit" | "cancel";
export type EditorMovementPlane = "viewport" | "xy" | "z";

export interface EditorBrushDragEvent {
  readonly phase: EditorBrushDragPhase;
  readonly viewport: EditorViewportKind;
  readonly selection: EditorSelection;
  /** Absolute, grid-snapped translation from the start of the drag. */
  readonly delta: Vec3;
  /** Active editing plane; perspective movement uses XY normally and Z while Alt is held. */
  readonly movementPlane: EditorMovementPlane;
  /** Dominant axis retained while Shift is held, or null for unconstrained movement. */
  readonly axisRestriction: TransformAxis | null;
  /** Ctrl/Command-drag clones the selected brushes and moves the clones in one transaction. */
  readonly duplicate: boolean;
}

export interface EditorPointEntityPlaceEvent {
  readonly viewport: EditorViewportKind;
  /** Snapped map-space origin after accounting for the active point-entity bounds. */
  readonly origin: Vec3;
}

export interface EditorPointerPositionEvent {
  readonly viewport: EditorViewportKind;
  /** Grid-snapped map point under the pointer, or on the active construction plane. */
  readonly point: Vec3;
  /** Outward source-face normal when the pointer is over a brush in perspective. */
  readonly surfaceNormal: Vec3 | null;
}

export interface EditorViewportContextMenuEvent {
  readonly viewport: EditorViewportKind;
  /** Browser viewport coordinates for anchoring an application-owned menu. */
  readonly clientX: number;
  readonly clientY: number;
  /** Snapped world-space pointer used by paste and surface-aware actions. */
  readonly pointer: EditorPointerPositionEvent;
  /** Frontmost editable hit; brush hits retain the exact face under the pointer. */
  readonly hit: EditorSelection | null;
  /** Surface-aware, bounds-adjusted origin for point-entity creation. */
  readonly pointEntityOrigin: Vec3 | null;
}

export interface EditorBrushCreateEvent {
  readonly phase: EditorBrushDragPhase;
  readonly viewport: EditorViewportKind;
  /** Grid-snapped box bounds, or null when an in-progress gesture is cancelled. */
  readonly bounds: Bounds | null;
  /** Active TrenchBroom-style drawing constraint. */
  readonly constraint: "none" | "square" | "cube" | "height";
}

export interface EditorHullCreateEvent {
  readonly phase: "preview" | "commit" | "cancel";
  /** The hull tool is intentionally restricted to TrenchBroom-style 3D reference placement. */
  readonly viewport: "perspective";
  /** Deduplicated points placed on existing brush faces. */
  readonly points: readonly Vec3[];
}

export interface EditorFaceTransferEvent {
  readonly phase: EditorBrushDragPhase;
  readonly viewport: EditorViewportKind;
  readonly mode: FaceAttributeTransferMode;
  readonly source: FaceSelection;
  /** Ordered paint path; each transferred target becomes the source for the next face. */
  readonly targets: readonly FaceSelection[];
}

interface EditorFaceDragBase {
  readonly phase: EditorBrushDragPhase;
  readonly viewport: EditorViewportKind;
  readonly selection: BrushSelection & { readonly faceId: FaceId };
}

export type EditorFaceDragEvent =
  | (EditorFaceDragBase & {
      readonly mode: "normal";
      /** Absolute, grid-snapped movement of the face plane along its outward normal. */
      readonly distance: number;
      /** Creates two adjacent brushes instead of replacing the source brush volume. */
      readonly split: boolean;
      /** Creates one independent prismatic brush from the source face without changing its owner. */
      readonly stamp: boolean;
    })
  | (EditorFaceDragBase & {
      readonly mode: "translate";
      /** Absolute, component-wise grid-snapped movement on the active viewport plane. */
      readonly delta: Vec3;
      readonly split: false;
      readonly stamp: false;
    });

export type EditorTopologyKind = "vertex" | "edge";

export interface EditorTopologyDragEvent {
  readonly phase: EditorBrushDragPhase;
  readonly viewport: EditorViewportKind;
  readonly kind: EditorTopologyKind;
  /** Moves existing handles, snaps them onto a target vertex, or inserts a surface point. */
  readonly operation: "move" | "snap" | "insert";
  readonly selection: BrushSelection;
  /** Brushes that own at least one dragged handle; insertion always has exactly one owner. */
  readonly brushIds: readonly BrushId[];
  /** Original derived corners, or the surface origin of a prospective inserted vertex. */
  readonly vertices: readonly Vec3[];
  /** Absolute, component-wise grid-snapped movement from the start of the gesture. */
  readonly delta: Vec3;
  /** Selected source vertex used by the one-click snap operation. */
  readonly anchor?: Vec3;
  /** Existing vertex receiving the one-click snap operation. */
  readonly target?: Vec3;
  readonly snapMode: "relative" | "absolute";
  readonly movementPlane: EditorMovementPlane;
  readonly axisRestriction: TransformAxis | null;
}

export interface EditorClipPlaneEvent {
  readonly viewport: EditorViewportKind;
  /** User-placed or face-matched points rendered by the tool. */
  readonly points: readonly Vec3[];
  /** The fully oriented plane; two placed points use the active viewport to infer the third. */
  readonly planePoints: readonly [Vec3, Vec3, Vec3] | null;
  /** Existing point currently being repositioned, if this update came from a point drag. */
  readonly movingPointIndex?: number;
  readonly pointMovePhase?: EditorBrushDragPhase;
  /** Dominant 2D axis retained while Shift is held during a point drag. */
  readonly axisRestriction?: TransformAxis | null;
}

interface EditorTransformDragBase {
  readonly phase: EditorBrushDragPhase;
  readonly viewport: EditorViewportKind;
  readonly pivot: Vec3;
}

export type EditorTransformDragEvent =
  | (EditorTransformDragBase & {
      readonly tool: "rotate";
      readonly selection: EditorSelection;
      readonly axis: TransformAxis;
      readonly angleDegrees: number;
    })
  | (EditorTransformDragBase & {
      readonly tool: "scale";
      readonly selection: EditorSelection;
      readonly factors: Vec3;
    })
  | (EditorTransformDragBase & {
      readonly tool: "shear";
      readonly selection: EditorSelection;
      readonly sourceAxis: TransformAxis;
      readonly targetAxis: TransformAxis;
      readonly factor: number;
      readonly offset: number;
    });

/** Moving the yellow rotate-tool center is viewport state, not a document edit. */
export interface EditorTransformPivotDragEvent {
  readonly phase: EditorBrushDragPhase;
  readonly viewport: EditorViewportKind;
  readonly startPivot: Vec3;
  /** Absolute grid-snapped pivot at this phase of the gesture. */
  readonly pivot: Vec3;
  /** Absolute grid-snapped movement from startPivot. */
  readonly delta: Vec3;
  readonly movementPlane: EditorMovementPlane;
  readonly axisRestriction: TransformAxis | null;
}

interface EditorSweepDragBase {
  readonly phase: EditorBrushDragPhase;
  /** TrenchBroom's destination-cap manipulator lives in the perspective viewport. */
  readonly viewport: "perspective";
}

export type EditorSweepDragEvent =
  | (EditorSweepDragBase & {
      readonly mode: "translate";
      /** Absolute snapped delta from the destination cap's position at pointer-down. */
      readonly delta: Vec3;
      readonly movementPlane: "xy" | "z";
      readonly axisRestriction: TransformAxis | null;
    })
  | (EditorSweepDragBase & {
      readonly mode: "rotate";
      readonly axis: TransformAxis;
      /** Absolute snapped angle from the destination cap's orientation at pointer-down. */
      readonly angleDegrees: number;
    })
  | (EditorSweepDragBase & {
      readonly mode: "scale";
      /** Uniform factor relative to the destination cap's scale at pointer-down. */
      readonly factor: number;
    });

export interface EditorViewportCanvases {
  readonly perspective: HTMLCanvasElement;
  readonly xy: HTMLCanvasElement;
  readonly xz: HTMLCanvasElement;
  readonly yz: HTMLCanvasElement;
}

/** Host-owned overlay roots whose high-frequency geometry is controlled by a viewport runtime. */
export interface EditorViewportOverlayElements {
  readonly container: HTMLElement;
  readonly handleLasso: HTMLDivElement;
  readonly transformReadout: HTMLDivElement;
}

export type EditorViewportOverlays = Partial<
  Readonly<Record<EditorViewportKind, EditorViewportOverlayElements>>
>;

export interface EditorReferenceScene {
  readonly id: string;
  readonly label: string;
  readonly document: MapDocument;
  readonly offset: Vec3;
  readonly visible: boolean;
}

export interface EditorDiagnosticOverlay {
  readonly id: string;
  readonly kind: "leak-path" | "portal";
  readonly points: readonly Vec3[];
}

/** Lossy collaboration overlay. Its document is never installed as editor or history state. */
export interface EditorRemotePresenceOverlay {
  readonly actorId: string;
  readonly color: readonly [number, number, number];
  readonly document: MapDocument;
  readonly selectedObjectIds: readonly string[];
  readonly previewObjectIds: readonly string[];
  readonly pointer?: Vec3;
}

export interface EditorSpriteMaterial {
  readonly path: string;
  readonly material: EditorMaterial;
}

export interface EditorSourceRendererOptions {
  readonly signal?: AbortSignal;
  readonly canvases: EditorViewportCanvases;
  readonly viewportOverlays?: EditorViewportOverlays;
  readonly document: MapDocument;
  readonly selection?: EditorSelection | null;
  readonly objectViewState?: EditorObjectViewState;
  readonly materials?: readonly EditorMaterial[];
  readonly entityDefinitions?: EntityDefinitionCatalog;
  readonly referenceScenes?: readonly EditorReferenceScene[];
  readonly diagnosticOverlays?: readonly EditorDiagnosticOverlay[];
  readonly remotePresence?: readonly EditorRemotePresenceOverlay[];
  readonly sprites?: readonly EditorSpriteMaterial[];
  readonly entityLinkMode?: EntityLinkMode;
  /** Persistent ID of the group currently opened for component editing. */
  readonly openGroupId?: string | null;
  readonly clearColor?: readonly [number, number, number, number];
  readonly theme?: EditorRenderTheme;
  readonly gridSize?: number;
  readonly tool?: EditorTool;
  /** Optional object/component pivot shared by rotate overlays, gestures, and exact controls. */
  readonly transformPivot?: Vec3 | null;
  readonly entityPlacementBounds?: Bounds;
  readonly onPick?: (
    selection: EditorSelection | null,
    viewport: EditorViewportKind,
    intent: EditorPickIntent,
  ) => void;
  readonly onBrushDrag?: (event: EditorBrushDragEvent) => void;
  readonly onPointEntityPlace?: (event: EditorPointEntityPlaceEvent) => void;
  readonly onPointerPosition?: (event: EditorPointerPositionEvent) => void;
  readonly onContextMenu?: (event: EditorViewportContextMenuEvent) => void;
  readonly onBrushCreate?: (event: EditorBrushCreateEvent) => void;
  readonly onHullCreate?: (event: EditorHullCreateEvent) => void;
  readonly onFaceTransfer?: (event: EditorFaceTransferEvent) => void;
  readonly onFaceDrag?: (event: EditorFaceDragEvent) => void;
  readonly onFaceLasso?: (
    faces: readonly FaceSelection[],
    viewport: EditorViewportKind,
    ensureSelected: boolean,
  ) => void;
  readonly onTopologyDrag?: (event: EditorTopologyDragEvent) => void;
  readonly onTopologySelectionChange?: (
    kind: EditorTopologyKind,
    selectedCount: number,
    vertices: readonly Vec3[],
  ) => void;
  readonly onClipPlaneChange?: (event: EditorClipPlaneEvent) => void;
  readonly onTransformDrag?: (event: EditorTransformDragEvent) => void;
  readonly onTransformPivotDrag?: (
    event: EditorTransformPivotDragEvent,
  ) => void;
  readonly onSweepDrag?: (event: EditorSweepDragEvent) => void;
  readonly onCameraChange?: (event: EditorCameraChangeEvent) => void;
  /** Requests one browser animation frame after renderer state or viewport input changes. */
  readonly onRenderRequest?: () => void;
  /** Reports candidate documents; consumers must keep them ephemeral and non-authoritative. */
  readonly onPreviewDocument?: (document: MapDocument) => void;
  /** Reports an unexpected device loss so the host can replace the canvases or explain failure. */
  readonly onDeviceLost?: (message: string) => void;
}

export interface EditorViewportCameraState {
  readonly center: Vec3;
  /** Perspective eye position; orthographic views report their logical center. */
  readonly position: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  readonly distance: number;
  readonly orthographicSpan: number;
  readonly fieldOfViewDegrees: number;
  readonly flySpeed: number;
}

export type EditorCameraNavigationMode =
  | "initial"
  | "look"
  | "orbit"
  | "pan"
  | "dolly"
  | "zoom"
  | "fly"
  | "linked"
  | "focus"
  | "restore";

export interface EditorCameraChangeEvent {
  readonly viewport: EditorViewportKind;
  readonly mode: EditorCameraNavigationMode;
  readonly camera: EditorViewportCameraState;
}
