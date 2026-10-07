import { deriveBrush } from "./geometry.js";
import type { MapSourceDiagnostic } from "./map-source-types.js";
import type {
  BrushId,
  EntityId,
  MapBrush,
  MapDocument,
  MapEntity,
} from "./types.js";

export const COLLABORATION_SCHEMA_VERSION = 1 as const;

export interface CollaborationOperation {
  readonly schemaVersion: typeof COLLABORATION_SCHEMA_VERSION;
  readonly operationId: string;
  readonly transactionId: string;
  readonly actorId: string;
  readonly baseMapVersion: number;
  readonly label: string;
  readonly edits: readonly CollaborationEdit[];
  /** Conditional inverse captured at commit time for this actor's personalized undo. */
  readonly inverseEdits?: readonly CollaborationEdit[] | undefined;
}

export type CollaborationEdit =
  | {
      readonly kind: "insert-entity";
      readonly insertionIndex: number;
      readonly entity: MapEntity;
    }
  | {
      readonly kind: "delete-entity";
      readonly entityId: EntityId;
      readonly baseProperties: Readonly<Record<string, string>>;
    }
  | {
      readonly kind: "replace-brush";
      readonly brushId: BrushId;
      readonly baseRevision: number;
      readonly brush: MapBrush;
    }
  | {
      readonly kind: "insert-brush";
      readonly entityId: EntityId;
      readonly insertionIndex: number;
      readonly brush: MapBrush;
    }
  | {
      readonly kind: "delete-brush";
      readonly brushId: BrushId;
      readonly baseRevision: number;
    }
  | {
      readonly kind: "move-brush";
      readonly brushId: BrushId;
      readonly baseEntityId: EntityId;
      readonly baseRevision: number;
      readonly entityId: EntityId;
      readonly insertionIndex: number;
    }
  | {
      readonly kind: "replace-entity-properties";
      readonly entityId: EntityId;
      readonly baseProperties: Readonly<Record<string, string>>;
      readonly properties: Readonly<Record<string, string>>;
    };

export interface CollaborationConflict {
  readonly editIndex: number;
  readonly kind:
    | "missing-target"
    | "target-exists"
    | "revision-mismatch"
    | "invalid-geometry";
  readonly targetId: string;
  readonly message: string;
}

export type CollaborationFailure = CollaborationConflict | MapSourceDiagnostic;

export interface SequencedCollaborationOperation {
  readonly mapVersion: number;
  readonly operation: CollaborationOperation;
}

export type CollaborationApplyResult =
  | { readonly status: "applied"; readonly document: MapDocument }
  | { readonly status: "duplicate"; readonly document: MapDocument }
  | {
      readonly status: "conflict";
      readonly document: MapDocument;
      readonly conflicts: readonly CollaborationConflict[];
    };

function recordsEqual(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => left[key] === right[key]);
}

function locateBrush(document: MapDocument, brushId: BrushId) {
  for (
    let entityIndex = 0;
    entityIndex < document.entities.length;
    entityIndex += 1
  ) {
    const entity = document.entities[entityIndex]!;
    const brushIndex = entity.primitives.findIndex(
      (brush) => brush.id === brushId,
    );
    if (brushIndex >= 0)
      return {
        entityIndex,
        brushIndex,
        entity,
        brush: entity.primitives[brushIndex]!,
      };
  }
  return null;
}

/**
 * Applies an accepted room operation atomically. The caller supplies the durable operation-id set;
 * keeping that ledger outside the document makes `.map` files portable and collaboration-free.
 */
export function applyCollaborationOperation(
  document: MapDocument,
  operation: CollaborationOperation,
  appliedOperationIds: ReadonlySet<string> = new Set(),
): CollaborationApplyResult {
  if (appliedOperationIds.has(operation.operationId))
    return { status: "duplicate", document };

  let next = document;
  const conflicts: CollaborationConflict[] = [];
  for (const [editIndex, edit] of operation.edits.entries()) {
    if (edit.kind === "insert-entity") {
      if (next.entities.some(({ id }) => id === edit.entity.id)) {
        conflicts.push({
          editIndex,
          kind: "target-exists",
          targetId: edit.entity.id,
          message: `Entity ${edit.entity.id} already exists`,
        });
        continue;
      }
      const insertionIndex = Math.min(
        Math.max(edit.insertionIndex, 0),
        next.entities.length,
      );
      next = Object.assign({}, next, {
        entities: next.entities.toSpliced(insertionIndex, 0, {
          ...edit.entity,
          primitives: [],
        }),
      });
    } else if (edit.kind === "replace-brush" || edit.kind === "delete-brush") {
      const located = locateBrush(next, edit.brushId);
      if (!located) {
        conflicts.push({
          editIndex,
          kind: "missing-target",
          targetId: edit.brushId,
          message: `Brush ${edit.brushId} no longer exists`,
        });
        continue;
      }
      if (located.brush.revision !== edit.baseRevision) {
        conflicts.push({
          editIndex,
          kind: "revision-mismatch",
          targetId: edit.brushId,
          message: `Brush ${edit.brushId} is revision ${located.brush.revision}, expected ${edit.baseRevision}`,
        });
        continue;
      }
      if (edit.kind === "replace-brush") {
        const brush = { ...edit.brush, revision: located.brush.revision + 1 };
        if (!deriveBrush(brush).valid) {
          conflicts.push({
            editIndex,
            kind: "invalid-geometry",
            targetId: edit.brushId,
            message: `Brush ${edit.brushId} is not valid convex geometry`,
          });
          continue;
        }
        const brushes = located.entity.primitives.with(
          located.brushIndex,
          brush,
        );
        next = Object.assign({}, next, {
          entities: next.entities.with(located.entityIndex, {
            ...located.entity,
            primitives: brushes,
          }),
        });
      } else {
        const brushes = located.entity.primitives.toSpliced(
          located.brushIndex,
          1,
        );
        next = Object.assign({}, next, {
          entities: next.entities.with(located.entityIndex, {
            ...located.entity,
            primitives: brushes,
          }),
        });
      }
    } else if (edit.kind === "insert-brush") {
      if (locateBrush(next, edit.brush.id)) {
        conflicts.push({
          editIndex,
          kind: "target-exists",
          targetId: edit.brush.id,
          message: `Brush ${edit.brush.id} already exists`,
        });
        continue;
      }
      const entityIndex = next.entities.findIndex(
        (entity) => entity.id === edit.entityId,
      );
      const entity = next.entities[entityIndex];
      if (!entity) {
        conflicts.push({
          editIndex,
          kind: "missing-target",
          targetId: edit.entityId,
          message: `Entity ${edit.entityId} no longer exists`,
        });
        continue;
      }
      if (!deriveBrush(edit.brush).valid) {
        conflicts.push({
          editIndex,
          kind: "invalid-geometry",
          targetId: edit.brush.id,
          message: `Brush ${edit.brush.id} is not valid convex geometry`,
        });
        continue;
      }
      const insertionIndex = Math.min(
        Math.max(edit.insertionIndex, 0),
        entity.primitives.length,
      );
      next = Object.assign({}, next, {
        entities: next.entities.with(entityIndex, {
          ...entity,
          primitives: entity.primitives.toSpliced(
            insertionIndex,
            0,
            edit.brush,
          ),
        }),
      });
    } else if (edit.kind === "move-brush") {
      const located = locateBrush(next, edit.brushId);
      const targetIndex = next.entities.findIndex(
        ({ id }) => id === edit.entityId,
      );
      if (!located || located.entity.id !== edit.baseEntityId) {
        conflicts.push({
          editIndex,
          kind: "missing-target",
          targetId: edit.brushId,
          message: `Brush ${edit.brushId} is no longer owned by entity ${edit.baseEntityId}`,
        });
        continue;
      }
      if (located.brush.revision !== edit.baseRevision) {
        conflicts.push({
          editIndex,
          kind: "revision-mismatch",
          targetId: edit.brushId,
          message: `Brush ${edit.brushId} is revision ${located.brush.revision}, expected ${edit.baseRevision}`,
        });
        continue;
      }
      const target = next.entities[targetIndex];
      if (!target) {
        conflicts.push({
          editIndex,
          kind: "missing-target",
          targetId: edit.entityId,
          message: `Entity ${edit.entityId} no longer exists`,
        });
        continue;
      }
      const sourcePrimitives = located.entity.primitives.toSpliced(
        located.brushIndex,
        1,
      );
      const insertionIndex = Math.min(
        Math.max(edit.insertionIndex, 0),
        target.primitives.length,
      );
      const entities = next.entities.with(located.entityIndex, {
        ...located.entity,
        primitives: sourcePrimitives,
      });
      next = {
        ...next,
        entities: entities.with(targetIndex, {
          ...target,
          primitives: target.primitives.toSpliced(
            insertionIndex,
            0,
            located.brush,
          ),
        }),
      };
    } else if (edit.kind === "replace-entity-properties") {
      const entityIndex = next.entities.findIndex(
        (entity) => entity.id === edit.entityId,
      );
      const entity = next.entities[entityIndex];
      if (!entity) {
        conflicts.push({
          editIndex,
          kind: "missing-target",
          targetId: edit.entityId,
          message: `Entity ${edit.entityId} no longer exists`,
        });
        continue;
      }
      if (!recordsEqual(entity.properties, edit.baseProperties)) {
        conflicts.push({
          editIndex,
          kind: "revision-mismatch",
          targetId: edit.entityId,
          message: `Entity ${edit.entityId} properties changed concurrently`,
        });
        continue;
      }
      next = Object.assign({}, next, {
        entities: next.entities.with(entityIndex, {
          ...entity,
          properties: edit.properties,
        }),
      });
    } else {
      const entityIndex = next.entities.findIndex(
        ({ id }) => id === edit.entityId,
      );
      const entity = next.entities[entityIndex];
      if (!entity || entity.primitives.length > 0) {
        conflicts.push({
          editIndex,
          kind: "missing-target",
          targetId: edit.entityId,
          message: `Entity ${edit.entityId} no longer exists or is not empty`,
        });
        continue;
      }
      if (!recordsEqual(entity.properties, edit.baseProperties)) {
        conflicts.push({
          editIndex,
          kind: "revision-mismatch",
          targetId: edit.entityId,
          message: `Entity ${edit.entityId} properties changed concurrently`,
        });
        continue;
      }
      next = { ...next, entities: next.entities.toSpliced(entityIndex, 1) };
    }
  }

  if (conflicts.length > 0) return { status: "conflict", document, conflicts };
  return {
    status: "applied",
    document: { ...next, revision: document.revision + 1 },
  };
}

/** Produces the stable semantic delta used by local outboxes and personalized inverse operations. */
export function collaborationEditsBetween(
  before: MapDocument,
  after: MapDocument,
): readonly CollaborationEdit[] {
  const edits: CollaborationEdit[] = [];
  const beforeEntities = new Map(
    before.entities.map((entity) => [entity.id, entity] as const),
  );
  const afterEntities = new Map(
    after.entities.map((entity) => [entity.id, entity] as const),
  );
  const beforeBrushes = new Map(
    before.entities.flatMap((entity) =>
      entity.primitives
        .filter((primitive) => primitive.kind === "brush")
        .map((brush) => [brush.id, brush] as const),
    ),
  );
  const afterBrushes = new Map(
    after.entities.flatMap((entity) =>
      entity.primitives
        .filter((primitive) => primitive.kind === "brush")
        .map((brush) => [brush.id, brush] as const),
    ),
  );

  const afterBrushOwners = new Map(
    after.entities.flatMap((entity) =>
      entity.primitives
        .filter((primitive) => primitive.kind === "brush")
        .map((brush) => [brush.id, entity.id] as const),
    ),
  );

  for (const [insertionIndex, entity] of after.entities.entries()) {
    if (!beforeEntities.has(entity.id)) {
      edits.push({
        kind: "insert-entity",
        insertionIndex,
        entity: { ...entity, primitives: [] },
      });
    }
  }

  for (const entity of before.entities) {
    const afterEntity = after.entities.find(
      (candidate) => candidate.id === entity.id,
    );
    if (
      afterEntity &&
      !recordsEqual(entity.properties, afterEntity.properties)
    ) {
      edits.push({
        kind: "replace-entity-properties",
        entityId: entity.id,
        baseProperties: entity.properties,
        properties: afterEntity.properties,
      });
    }
    for (const brush of entity.primitives) {
      if (brush.kind !== "brush") continue;
      const replacement = afterBrushes.get(brush.id);
      const brushChanged =
        replacement !== undefined &&
        replacement !== brush &&
        JSON.stringify(replacement) !== JSON.stringify(brush);
      if (!replacement)
        edits.push({
          kind: "delete-brush",
          brushId: brush.id,
          baseRevision: brush.revision,
        });
      else if (brushChanged) {
        edits.push({
          kind: "replace-brush",
          brushId: brush.id,
          baseRevision: brush.revision,
          brush: replacement,
        });
      }
      const targetEntityId = afterBrushOwners.get(brush.id);
      if (replacement && targetEntityId && targetEntityId !== entity.id) {
        const target = afterEntities.get(targetEntityId)!;
        edits.push({
          kind: "move-brush",
          brushId: brush.id,
          baseEntityId: entity.id,
          baseRevision: brush.revision + (brushChanged ? 1 : 0),
          entityId: targetEntityId,
          insertionIndex: target.primitives.findIndex(
            ({ id }) => id === brush.id,
          ),
        });
      }
    }
  }
  for (const entity of after.entities) {
    for (const [insertionIndex, brush] of entity.primitives.entries()) {
      if (brush.kind !== "brush") continue;
      if (!beforeBrushes.has(brush.id)) {
        edits.push({
          kind: "insert-brush",
          entityId: entity.id,
          insertionIndex,
          brush,
        });
      }
    }
  }
  for (const entity of before.entities) {
    if (!afterEntities.has(entity.id)) {
      edits.push({
        kind: "delete-entity",
        entityId: entity.id,
        baseProperties: entity.properties,
      });
    }
  }
  return edits;
}

export function inverseCollaborationEdits(
  before: MapDocument,
  after: MapDocument,
): readonly CollaborationEdit[] {
  return collaborationEditsBetween(after, before);
}

/** Buffers reordered room delivery and applies every sequenced operation exactly once. */
export class OrderedCollaborationReplica {
  private readonly pending = new Map<number, CollaborationOperation>();
  private readonly appliedOperationIds = new Set<string>();
  private currentRoomVersion = 0;

  public constructor(private currentDocument: MapDocument) {}

  public get document(): MapDocument {
    return this.currentDocument;
  }

  public get mapVersion(): number {
    return this.currentRoomVersion;
  }

  public receive(
    frame: SequencedCollaborationOperation,
  ): readonly CollaborationConflict[] {
    if (frame.mapVersion <= this.currentRoomVersion) return [];
    this.pending.set(frame.mapVersion, frame.operation);
    const conflicts: CollaborationConflict[] = [];
    while (this.pending.has(this.currentRoomVersion + 1)) {
      const operation = this.pending.get(this.currentRoomVersion + 1)!;
      this.pending.delete(this.currentRoomVersion + 1);
      const result = applyCollaborationOperation(
        this.currentDocument,
        operation,
        this.appliedOperationIds,
      );
      if (result.status === "conflict") conflicts.push(...result.conflicts);
      else if (result.status === "applied") {
        this.currentDocument = result.document;
        this.appliedOperationIds.add(operation.operationId);
      }
      this.currentRoomVersion += 1;
    }
    return conflicts;
  }
}

export interface CollaborationSimulationResult {
  readonly seed: number;
  readonly replicas: readonly OrderedCollaborationReplica[];
  readonly deliveredFrames: number;
  readonly conflicts: readonly CollaborationConflict[];
}

/** Deterministic fault simulator for delayed, reordered, duplicate, and disconnected delivery. */
export function simulateCollaborationDelivery(
  baseline: MapDocument,
  frames: readonly SequencedCollaborationOperation[],
  seed = 0x5eed,
  replicaCount = 3,
): CollaborationSimulationResult {
  let randomState = seed >>> 0;
  const random = (): number => {
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    return (randomState >>> 0) / 0x1_0000_0000;
  };
  const replicas = Array.from(
    { length: replicaCount },
    () => new OrderedCollaborationReplica(baseline),
  );
  const deliveries = replicas.flatMap((replica, replicaIndex) =>
    frames.flatMap((frame) => {
      const delivery = { replica, replicaIndex, frame, delay: random() };
      return random() < 0.35
        ? [delivery, { ...delivery, delay: random() }]
        : [delivery];
    }),
  );
  // The final replica is considered disconnected for the first half of the simulated timeline.
  deliveries.sort((left, right) => {
    const leftDelay =
      left.delay + (left.replicaIndex === replicaCount - 1 ? 1 : 0);
    const rightDelay =
      right.delay + (right.replicaIndex === replicaCount - 1 ? 1 : 0);
    return leftDelay - rightDelay;
  });
  const conflicts: CollaborationConflict[] = [];
  for (const delivery of deliveries)
    conflicts.push(...delivery.replica.receive(delivery.frame));
  return { seed, replicas, deliveredFrames: deliveries.length, conflicts };
}
