import type {
  Bounds,
  FaceSelection,
  EditorObjectViewState,
  EditorSelection,
  EntityDefinitionCatalog,
  EntityLinkMode,
  MapDocument,
  Vec3,
} from "../core/index.js";
import type { LineBatch } from "./scene-line-batches.js";
import type { SolidBatch } from "./scene-solid-batches.js";
import type { EditorRenderTheme } from "./theme.js";
import type {
  EditorDiagnosticOverlay,
  EditorReferenceScene,
  EditorRemotePresenceOverlay,
  EditorSpriteMaterial,
  EditorTool,
} from "./types.js";
import type { MovementTrace, TopologyHandle } from "./viewport-geometry.js";

export type SceneContributionName =
  | "worldSolids"
  | "objectLines"
  | "localPreview"
  | "localSelection"
  | "toolPreviews"
  | "faceGrid"
  | "references"
  | "diagnostics"
  | "remotePresence";

export type SceneDependencyKey = readonly unknown[];

export type SceneDependencyKeys = Readonly<
  Record<SceneContributionName, SceneDependencyKey>
>;

export interface LineBuffer {
  readonly buffer: GPUBuffer;
  readonly count: number;
}

export interface SolidBuffers {
  readonly solids: readonly SolidBatch[];
}

export interface ObjectLineBuffers {
  readonly batches: readonly LineBatch[];
  readonly unbatched: LineBuffer;
}

export interface SelectionBuffers {
  readonly lines: GPUBuffer;
  readonly lineCount: number;
  readonly solids: readonly SolidBatch[];
}

export interface ToolPreviewBuffers {
  readonly resizeFace: LineBuffer;
  readonly resizeFaceSelections: readonly FaceSelection[];
  readonly hull: {
    readonly polygon: readonly Vec3[];
    readonly grid: LineBuffer;
    readonly lines: LineBuffer;
    readonly handles: LineBuffer;
    readonly face: LineBuffer;
  };
  readonly lines: LineBuffer;
  readonly selectionGuide: LineBuffer;
  readonly scaleBounds: Bounds | null;
}

export interface ReferenceBuffers extends SolidBuffers, ObjectLineBuffers {}

export interface LocalPreviewBuffers extends ReferenceBuffers {
  readonly active: boolean;
  readonly selection: SelectionBuffers;
}

export interface RetainedSceneContribution<
  Name extends SceneContributionName,
  Value,
> {
  readonly name: Name;
  readonly key: SceneDependencyKey;
  readonly value: Value;
  dispose(): void;
}

export interface SceneBuffers {
  readonly worldSolids: RetainedSceneContribution<"worldSolids", SolidBuffers>;
  readonly objectLines: RetainedSceneContribution<
    "objectLines",
    ObjectLineBuffers
  >;
  readonly localPreview: RetainedSceneContribution<
    "localPreview",
    LocalPreviewBuffers
  >;
  readonly localSelection: RetainedSceneContribution<
    "localSelection",
    SelectionBuffers
  >;
  readonly toolPreviews: RetainedSceneContribution<
    "toolPreviews",
    ToolPreviewBuffers
  >;
  readonly faceGrid: RetainedSceneContribution<"faceGrid", LineBuffer>;
  readonly references: RetainedSceneContribution<
    "references",
    ReferenceBuffers
  >;
  readonly diagnostics: RetainedSceneContribution<"diagnostics", LineBuffer>;
  readonly remotePresence: RetainedSceneContribution<
    "remotePresence",
    SelectionBuffers
  >;
}

export interface SceneBuildInput {
  readonly world: {
    readonly document: MapDocument;
    readonly objectViewState: EditorObjectViewState;
    readonly sprites: readonly EditorSpriteMaterial[];
  };
  readonly localPreview: {
    readonly document: MapDocument | null;
    readonly objectIds: readonly string[];
    readonly selectionObjectIds: readonly string[];
    readonly faceOutlines?: readonly FaceSelection[] | null;
  };
  readonly selection: {
    readonly current: EditorSelection | null;
    readonly hovered: EditorSelection | null;
  };
  readonly tools: {
    readonly active: EditorTool;
    readonly gridSize: number;
    readonly transformPivot: Vec3 | null;
    readonly transformPivotHovered: boolean;
    readonly transformPivotTrace: MovementTrace | null;
    readonly movementTraces: readonly MovementTrace[];
    readonly clipPoints: readonly Vec3[];
    readonly hullPoints: readonly Vec3[];
    readonly hullPreviewPoints: readonly Vec3[];
    readonly sweepCaps: readonly (readonly Vec3[])[];
    readonly topologySelection: readonly TopologyHandle[];
    readonly topologyHover: TopologyHandle | null;
    readonly entityLinkMode: EntityLinkMode;
    readonly openGroupId: string | null;
  };
  readonly references: readonly EditorReferenceScene[];
  readonly diagnostics: readonly EditorDiagnosticOverlay[];
  readonly remotePresence: readonly EditorRemotePresenceOverlay[];
  readonly entityDefinitions: EntityDefinitionCatalog | undefined;
  readonly theme: EditorRenderTheme;
}

export interface SceneBuildResult {
  readonly scene: SceneBuffers;
  readonly rebuilt: ReadonlySet<SceneContributionName>;
}
