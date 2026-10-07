import {
  replaceBrushes,
  replaceEntities,
  translateBrush,
  type TransformAxis,
  type BrushInsertion,
} from "./document.js";
import { type AffineMatrix } from "./linked-groups.js";
import {
  type BrushClipEdit,
  type BrushEdit,
  type HistoryEntry,
} from "./history.js";
import {
  formatEntityOrigin,
  parseEntityOrigin,
  transformPointEntityAffine,
} from "./point-entities.js";
import { selectedBrushIds, selectedPointEntityIds } from "./selection.js";
import type {
  BrushId,
  EditorSelection,
  EntityId,
  FaceSelection,
  MapBrush,
  MapDocument,
  MapEntity,
  Vec3,
} from "./types.js";
import { findBrush } from "./types.js";
export interface EditorSessionChange {
  readonly kind: "document" | "selection" | "history" | "view";
  readonly label: string;
  readonly documentRevision: number;
}

export interface SelectionBrushSelectionResult {
  readonly removedBrushCount: number;
  readonly selectedBrushCount: number;
  readonly selectedEntityCount: number;
  readonly selection: EditorSelection | null;
}

export type ChangeListener = (change: EditorSessionChange) => void;

export interface BrushEditCandidate extends BrushEdit {
  readonly label: string;
  readonly baseDocumentRevision: number;
  /** A derived preview document. The session remains unchanged until commitCandidate is called. */
  readonly document: MapDocument;
}

export type { BrushClipEdit, BrushEdit } from "./history.js";

export interface BrushBatchEditCandidate {
  readonly label: string;
  readonly baseDocumentRevision: number;
  readonly edits: readonly BrushEdit[];
  /** A derived preview document. The session remains unchanged until commitCandidate is called. */
  readonly document: MapDocument;
}

export interface BrushCreationCandidate {
  readonly label: string;
  readonly entityId: EntityId;
  readonly insertionIndex: number;
  readonly baseDocumentRevision: number;
  readonly brush: MapBrush;
  /** A derived preview document. The session remains unchanged until commitCreationCandidate. */
  readonly document: MapDocument;
}

export interface BrushBatchCreationCandidate {
  readonly label: string;
  readonly baseDocumentRevision: number;
  readonly insertions: readonly BrushInsertion[];
  readonly selectionBefore: EditorSelection | null;
  readonly selectionAfter: readonly BrushId[];
  /** A derived preview document. The session remains unchanged until commitBatchCreationCandidate. */
  readonly document: MapDocument;
}

/** Object-edit commands that can be replayed as TrenchBroom-style command repetition. */
export type EditorRepeatableCommand =
  | {
      readonly kind: "duplicate";
      readonly delta: Vec3;
      readonly textureLock: boolean;
      readonly targetGroupId: string | null;
    }
  | {
      readonly kind: "translate";
      readonly delta: Vec3;
      readonly textureLock: boolean;
    }
  | {
      readonly kind: "rotate";
      readonly pivot: Vec3;
      readonly axis: TransformAxis;
      readonly degrees: number;
      readonly textureLock: boolean;
      readonly updateEntityAngles: boolean;
    }
  | {
      readonly kind: "flip";
      readonly pivot: Vec3;
      readonly axis: TransformAxis;
      readonly textureLock: boolean;
      readonly updateEntityAngles: boolean;
    }
  | {
      readonly kind: "scale";
      readonly pivot: Vec3;
      readonly factors: Vec3;
      readonly textureLock: boolean;
      readonly updateEntityAngles: boolean;
    }
  | {
      readonly kind: "shear";
      readonly pivot: Vec3;
      readonly sourceAxis: TransformAxis;
      readonly targetAxis: TransformAxis;
      readonly factor: number;
      readonly textureLock: boolean;
      readonly updateEntityAngles: boolean;
    };

/** A stable whole-document preview used when an edit spans brushes and point entities. */
export interface DocumentEditCandidate {
  readonly label: string;
  readonly baseDocumentRevision: number;
  readonly before: MapDocument;
  readonly after: MapDocument;
  readonly selectionBefore: EditorSelection | null;
  readonly selectionAfter: EditorSelection | null;
  readonly document: MapDocument;
  /** Present when this candidate should join the current command-repetition sequence. */
  readonly repeatable?: EditorRepeatableCommand;
}

/** A validated domain mutation handed to the session's single history/notification commit point. */
export interface SessionCommitMutation {
  readonly document: MapDocument;
  readonly selection: EditorSelection | null;
  readonly historyEntry: HistoryEntry;
  readonly changeKind?: EditorSessionChange["kind"];
}

export interface SweepCandidate extends BrushBatchCreationCandidate {
  /** Deduplicated source faces used to produce this preview. */
  readonly sourceFaces: readonly FaceSelection[];
  /** Final cap for each source face, used by the 3D Sweep manipulator. */
  readonly destinationCaps: readonly (readonly Vec3[])[];
}

export type BrushClipMode = "back" | "split" | "front";

export interface BrushClipCandidate {
  readonly label: string;
  readonly mode: BrushClipMode;
  readonly entityId: EntityId;
  readonly insertionIndex: number;
  readonly baseDocumentRevision: number;
  readonly baseBrushRevision: number;
  readonly before: MapBrush;
  readonly after: readonly MapBrush[];
  /** A derived preview document. The session remains unchanged until commitClipCandidate. */
  readonly document: MapDocument;
}

export interface BrushBatchClipCandidate {
  readonly label: string;
  readonly mode: BrushClipMode;
  readonly baseDocumentRevision: number;
  readonly edits: readonly BrushClipEdit[];
  readonly selectionBefore: readonly BrushId[];
  readonly selectionAfter: readonly BrushId[];
  /** A derived preview document. The session remains unchanged until commitClipCandidate. */
  readonly document: MapDocument;
}

export interface BrushSequenceCandidate {
  readonly label: string;
  readonly baseDocumentRevision: number;
  readonly edits: readonly BrushClipEdit[];
  readonly selectionBefore: readonly BrushId[];
  readonly selectionAfter: readonly BrushId[];
  /** A derived preview document. The session remains unchanged until commitSequenceCandidate. */
  readonly document: MapDocument;
}

export function documentRevisionForApply(
  current: MapDocument,
  content: MapDocument,
): MapDocument {
  return { ...content, revision: current.revision + 1 };
}

/** Package validated brush edits into the same preview shape used by history and gestures. */
export function createBrushEditCandidate(
  before: MapDocument,
  edits: readonly BrushEdit[],
  singleLabel: string,
  batchLabel = singleLabel,
): BrushEditCandidate | BrushBatchEditCandidate | null {
  const first = edits[0];
  if (!first) return null;
  const base = {
    label: edits.length === 1 ? singleLabel : batchLabel,
    baseDocumentRevision: before.revision,
    document: replaceBrushes(
      before,
      edits.map((edit) => edit.after),
    ),
  };
  return edits.length === 1 ? { ...base, ...first } : { ...base, edits };
}

export function faceSelectionKey(face: FaceSelection): string {
  return `${face.brushId}\u0000${face.faceId}`;
}

export function translatedObjects(
  document: MapDocument,
  selection: EditorSelection,
  delta: Vec3,
  textureLock: boolean,
): MapDocument {
  return transformedObjects(
    document,
    selection,
    (brush) => translateBrush(brush, delta, textureLock),
    (entity) => {
      const origin = parseEntityOrigin(entity);
      if (!origin || entity.primitives.length > 0)
        throw new Error(`Entity ${entity.id} is not a point entity`);
      return {
        ...entity,
        properties: {
          ...entity.properties,
          origin: formatEntityOrigin([
            origin[0] + delta[0],
            origin[1] + delta[1],
            origin[2] + delta[2],
          ]),
        },
      };
    },
  );
}

export function transformedObjects(
  document: MapDocument,
  selection: EditorSelection,
  transformBrush: (brush: MapBrush) => MapBrush,
  transformEntity: (entity: MapEntity) => MapEntity,
): MapDocument {
  let transformed = document;
  const brushIds = selectedBrushIds(selection);
  if (brushIds.length > 0) {
    const brushes = brushIds.map((brushId) => {
      const brush = findBrush(document, brushId);
      if (!brush) throw new Error(`Unknown brush ${brushId}`);
      return transformBrush(brush);
    });
    transformed = replaceBrushes(transformed, brushes);
  }
  const entityIds = selectedPointEntityIds(selection);
  if (entityIds.length > 0) {
    const entities = entityIds.map((entityId) => {
      const entity = document.entities.find(
        (candidate) => candidate.id === entityId,
      );
      if (!entity) throw new Error(`Unknown point entity ${entityId}`);
      return transformEntity(entity);
    });
    transformed = replaceEntities(transformed, entities);
  }
  return { ...transformed, revision: document.revision + 1 };
}

export function transformPointEntityByAffine(
  entity: MapEntity,
  matrix: AffineMatrix,
  updateAngles = true,
): MapEntity {
  return transformPointEntityAffine(
    entity,
    [
      [matrix[0], matrix[1], matrix[2]],
      [matrix[4], matrix[5], matrix[6]],
      [matrix[8], matrix[9], matrix[10]],
    ],
    [matrix[3], matrix[7], matrix[11]],
    updateAngles,
  );
}

export function objectTransformLabel(
  verb: "Rotate" | "Flip" | "Scale" | "Shear",
  brushCount: number,
  entityCount: number,
): string {
  const count = brushCount + entityCount;
  if (brushCount > 0 && entityCount > 0) return `${verb} objects`;
  if (entityCount > 0) return `${verb} ${count === 1 ? "entity" : "entities"}`;
  return `${verb} ${count === 1 ? "brush" : "brushes"}`;
}

export function repeatableCommandLabel(
  command: EditorRepeatableCommand,
): string {
  switch (command.kind) {
    case "duplicate":
      return "Duplicate";
    case "translate":
      return "Move";
    case "rotate":
      return "Rotate";
    case "flip":
      return "Flip";
    case "scale":
      return "Scale";
    case "shear":
      return "Shear";
  }
}
