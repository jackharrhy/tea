import {
  addBrushVertex,
  deleteBrushVertices,
  flipBrush,
  moveBrushVertices,
  replaceBrush,
  rotateBrush,
  rotateBrushVertices,
  scaleBrush,
  scaleBrushVertices,
  shearBrush,
  shearBrushVertices,
  snapBrushVerticesToGrid,
  translateBrush,
  type TransformAxis,
} from "./document.js";
import { brushVertices, deriveBrush } from "./geometry.js";
import {
  flipAffineMatrix,
  rotationAffineMatrix,
  scaleAffineMatrix,
  shearAffineMatrix,
  transformEditorGroupSubtreeMetadata,
  translationAffineMatrix,
} from "./linked-groups.js";
import { type BrushEdit } from "./history.js";
import { flipPointEntity, rotatePointEntity } from "./point-entities.js";
import {
  selectedBrushIds,
  selectedFaceReferences,
  selectedPointEntityIds,
} from "./selection.js";
import type {
  BrushId,
  EditorSelection,
  FaceSelection,
  IdFactory,
  MapBrush,
  Vec3,
} from "./types.js";
import { findBrush } from "./types.js";
import {
  createBrushEditCandidate,
  translatedObjects,
  transformedObjects,
  transformPointEntityByAffine,
  objectTransformLabel,
  type BrushEditCandidate,
  type BrushBatchEditCandidate,
  type DocumentEditCandidate,
} from "./session-common.js";
import type { SessionKernel } from "./session-kernel.js";

type SessionTransformKernel = Readonly<
  Pick<SessionKernel, "document" | "selection">
>;

export interface SessionTransformPorts {
  readonly commitCandidate: (
    candidate: BrushEditCandidate | BrushBatchEditCandidate,
  ) => void;
  readonly commitDocumentCandidate: (candidate: DocumentEditCandidate) => void;
}

export class SessionTransformCommands {
  public constructor(
    private readonly kernel: SessionTransformKernel,
    private readonly ports: SessionTransformPorts,
  ) {}

  public snapSelectionToGrid(
    gridSize: number,
    ids: IdFactory,
    textureLock = true,
  ): boolean {
    if (!Number.isFinite(gridSize) || gridSize <= 0)
      throw new Error("Grid size must be positive");
    if (!this.kernel.selection) return false;
    const faces = selectedFaceReferences(this.kernel.selection);
    const brushIds =
      faces.length > 0
        ? [...new Set(faces.map((face) => face.brushId))]
        : selectedBrushIds(this.kernel.selection);
    const vertices = faces.flatMap((selection) => {
      const brush = findBrush(this.kernel.document, selection.brushId);
      return (
        (brush &&
          deriveBrush(brush).faces.find(
            (face) => face.faceId === selection.faceId,
          )?.vertices) ??
        []
      );
    });
    const isOnGrid = (point: Vec3) =>
      point.every(
        (value) =>
          Math.abs(value / gridSize - Math.round(value / gridSize)) <= 1e-6,
      );
    const targetsAlreadySnapped = brushIds.every((brushId) => {
      const brush = findBrush(this.kernel.document, brushId);
      if (!brush) return true;
      const targetVertices =
        faces.length === 0
          ? brushVertices(brush)
          : brushVertices(brush).filter((point) =>
              vertices.some((target) =>
                target.every(
                  (value, axis) => Math.abs(value - point[axis]!) <= 0.001,
                ),
              ),
            );
      return targetVertices.every(isOnGrid);
    });
    if (targetsAlreadySnapped) return false;
    const candidate = this.createBrushSetTransformCandidate(
      brushIds,
      faces.length === 0
        ? "Snap brush vertices to grid"
        : "Snap face vertices to grid",
      faces.length === 0
        ? "Snap brush vertices to grid"
        : "Snap face vertices to grid",
      (brush) =>
        snapBrushVerticesToGrid(
          brush,
          faces.length === 0 ? brushVertices(brush) : vertices,
          gridSize,
          ids,
          textureLock,
        ),
    );
    if (!candidate) return false;
    this.ports.commitCandidate(candidate);
    return true;
  }

  public translateSelected(delta: Vec3, textureLock = true): boolean {
    if (!this.kernel.selection || this.kernel.selection.faceId) return false;
    const candidate = this.createObjectTranslationCandidate(
      this.kernel.selection,
      delta,
      textureLock,
    );
    if (!candidate) return false;
    this.ports.commitDocumentCandidate(candidate);
    return true;
  }
  public translate(brushId: BrushId, delta: Vec3, textureLock = true): boolean {
    if (delta.every((component) => Math.abs(component) <= Number.EPSILON))
      return false;
    const candidate = this.createTranslationCandidate(
      brushId,
      delta,
      textureLock,
    );
    if (!candidate) return false;
    this.ports.commitCandidate(candidate);
    return true;
  }

  public createTranslationCandidate(
    brushId: BrushId,
    delta: Vec3,
    textureLock = true,
  ): BrushEditCandidate | null {
    const before = findBrush(this.kernel.document, brushId);
    if (!before) return null;
    const after = translateBrush(before, delta, textureLock);
    const derived = deriveBrush(after);
    if (!derived.valid) {
      throw new Error(
        derived.diagnostics.map((diagnostic) => diagnostic.message).join("; "),
      );
    }
    return {
      label: "Move brush",
      brushId,
      baseDocumentRevision: this.kernel.document.revision,
      baseBrushRevision: before.revision,
      before,
      after,
      document: replaceBrush(this.kernel.document, after),
    };
  }

  public createBrushSetTranslationCandidate(
    brushIds: readonly BrushId[],
    delta: Vec3,
    textureLock = true,
  ): BrushEditCandidate | BrushBatchEditCandidate | null {
    if (delta.every((component) => Math.abs(component) <= Number.EPSILON))
      return null;
    return this.createBrushSetTransformCandidate(
      brushIds,
      "Move brush",
      "Move brushes",
      (before) => translateBrush(before, delta, textureLock),
    );
  }

  public createObjectTranslationCandidate(
    selection: EditorSelection,
    delta: Vec3,
    textureLock = true,
  ): DocumentEditCandidate | null {
    if (
      selection.faceId ||
      delta.every((component) => Math.abs(component) <= Number.EPSILON)
    ) {
      return null;
    }
    const brushCount = selectedBrushIds(selection).length;
    const entityCount = selectedPointEntityIds(selection).length;
    if (brushCount + entityCount === 0) return null;
    let after = translatedObjects(
      this.kernel.document,
      selection,
      delta,
      textureLock,
    );
    after = transformEditorGroupSubtreeMetadata(
      after,
      selection.groupId,
      translationAffineMatrix(delta),
    );
    const subject =
      brushCount > 0 && entityCount > 0
        ? "object"
        : entityCount > 0
          ? "entity"
          : "brush";
    const count = brushCount + entityCount;
    return {
      label:
        count === 1
          ? `Move ${subject}`
          : `Move ${subject === "brush" ? "brushes" : `${subject}s`}`,
      baseDocumentRevision: this.kernel.document.revision,
      before: this.kernel.document,
      after,
      selectionBefore: this.kernel.selection,
      selectionAfter: selection,
      document: after,
      repeatable: { kind: "translate", delta: [...delta], textureLock },
    };
  }

  public rotateSelected(
    pivot: Vec3,
    axis: TransformAxis,
    degrees: number,
    textureLock = true,
  ): boolean {
    if (!this.kernel.selection || this.kernel.selection.faceId) return false;
    const candidate = this.createObjectRotationCandidate(
      this.kernel.selection,
      pivot,
      axis,
      degrees,
      textureLock,
    );
    if (!candidate) return false;
    this.ports.commitDocumentCandidate(candidate);
    return true;
  }

  public createObjectRotationCandidate(
    selection: EditorSelection,
    pivot: Vec3,
    axis: TransformAxis,
    degrees: number,
    textureLock = true,
    updateEntityAngles = true,
  ): DocumentEditCandidate | null {
    if (selection.faceId || Math.abs(degrees) <= Number.EPSILON) return null;
    const brushCount = selectedBrushIds(selection).length;
    const entityCount = selectedPointEntityIds(selection).length;
    if (brushCount + entityCount === 0) return null;
    let after = transformedObjects(
      this.kernel.document,
      selection,
      (brush) => rotateBrush(brush, pivot, axis, degrees, textureLock),
      (entity) =>
        rotatePointEntity(entity, pivot, axis, degrees, updateEntityAngles),
    );
    after = transformEditorGroupSubtreeMetadata(
      after,
      selection.groupId,
      rotationAffineMatrix(pivot, axis, degrees),
    );
    return {
      label: objectTransformLabel("Rotate", brushCount, entityCount),
      baseDocumentRevision: this.kernel.document.revision,
      before: this.kernel.document,
      after,
      selectionBefore: this.kernel.selection,
      selectionAfter: selection,
      document: after,
      repeatable: {
        kind: "rotate",
        pivot: [...pivot],
        axis,
        degrees,
        textureLock,
        updateEntityAngles,
      },
    };
  }

  public flipSelected(
    pivot: Vec3,
    axis: TransformAxis,
    textureLock = true,
    updateEntityAngles = true,
  ): boolean {
    if (!this.kernel.selection || this.kernel.selection.faceId) return false;
    const candidate = this.createObjectFlipCandidate(
      this.kernel.selection,
      pivot,
      axis,
      textureLock,
      updateEntityAngles,
    );
    if (!candidate) return false;
    this.ports.commitDocumentCandidate(candidate);
    return true;
  }

  public createObjectFlipCandidate(
    selection: EditorSelection,
    pivot: Vec3,
    axis: TransformAxis,
    textureLock = true,
    updateEntityAngles = true,
  ): DocumentEditCandidate | null {
    if (selection.faceId) return null;
    const brushCount = selectedBrushIds(selection).length;
    const entityCount = selectedPointEntityIds(selection).length;
    if (brushCount + entityCount === 0) return null;
    let after = transformedObjects(
      this.kernel.document,
      selection,
      (brush) => flipBrush(brush, pivot, axis, textureLock),
      (entity) => flipPointEntity(entity, pivot, axis, updateEntityAngles),
    );
    after = transformEditorGroupSubtreeMetadata(
      after,
      selection.groupId,
      flipAffineMatrix(pivot, axis),
    );
    return {
      label: objectTransformLabel("Flip", brushCount, entityCount),
      baseDocumentRevision: this.kernel.document.revision,
      before: this.kernel.document,
      after,
      selectionBefore: this.kernel.selection,
      selectionAfter: selection,
      document: after,
      repeatable: {
        kind: "flip",
        pivot: [...pivot],
        axis,
        textureLock,
        updateEntityAngles,
      },
    };
  }

  public createRotationCandidate(
    brushId: BrushId,
    pivot: Vec3,
    axis: TransformAxis,
    degrees: number,
    textureLock = true,
  ): BrushEditCandidate | null {
    if (Math.abs(degrees) <= Number.EPSILON) return null;
    return this.createBrushTransformCandidate(
      brushId,
      "Rotate brush",
      (before) => rotateBrush(before, pivot, axis, degrees, textureLock),
    );
  }

  public createBrushSetRotationCandidate(
    brushIds: readonly BrushId[],
    pivot: Vec3,
    axis: TransformAxis,
    degrees: number,
    textureLock = true,
  ): BrushEditCandidate | BrushBatchEditCandidate | null {
    if (Math.abs(degrees) <= Number.EPSILON) return null;
    return this.createBrushSetTransformCandidate(
      brushIds,
      "Rotate brush",
      "Rotate brushes",
      (before) => rotateBrush(before, pivot, axis, degrees, textureLock),
    );
  }

  public scaleSelected(
    pivot: Vec3,
    factors: Vec3,
    textureLock = true,
  ): boolean {
    if (!this.kernel.selection || this.kernel.selection.faceId) return false;
    const candidate = this.createObjectScaleCandidate(
      this.kernel.selection,
      pivot,
      factors,
      textureLock,
    );
    if (!candidate) return false;
    this.ports.commitDocumentCandidate(candidate);
    return true;
  }

  public createObjectScaleCandidate(
    selection: EditorSelection,
    pivot: Vec3,
    factors: Vec3,
    textureLock = true,
    updateEntityAngles = true,
  ): DocumentEditCandidate | null {
    if (
      selection.faceId ||
      factors.every((factor) => Math.abs(factor - 1) <= Number.EPSILON)
    ) {
      return null;
    }
    const brushCount = selectedBrushIds(selection).length;
    const entityCount = selectedPointEntityIds(selection).length;
    if (brushCount + entityCount === 0) return null;
    const affine = scaleAffineMatrix(pivot, factors);
    let after = transformedObjects(
      this.kernel.document,
      selection,
      (brush) => scaleBrush(brush, pivot, factors, textureLock),
      (entity) =>
        transformPointEntityByAffine(entity, affine, updateEntityAngles),
    );
    after = transformEditorGroupSubtreeMetadata(
      after,
      selection.groupId,
      affine,
    );
    return {
      label: objectTransformLabel("Scale", brushCount, entityCount),
      baseDocumentRevision: this.kernel.document.revision,
      before: this.kernel.document,
      after,
      selectionBefore: this.kernel.selection,
      selectionAfter: selection,
      document: after,
      repeatable: {
        kind: "scale",
        pivot: [...pivot],
        factors: [...factors],
        textureLock,
        updateEntityAngles,
      },
    };
  }

  public createScaleCandidate(
    brushId: BrushId,
    pivot: Vec3,
    factors: Vec3,
    textureLock = true,
  ): BrushEditCandidate | null {
    if (factors.every((factor) => Math.abs(factor - 1) <= Number.EPSILON))
      return null;
    return this.createBrushTransformCandidate(
      brushId,
      "Scale brush",
      (before) => scaleBrush(before, pivot, factors, textureLock),
    );
  }

  public createBrushSetScaleCandidate(
    brushIds: readonly BrushId[],
    pivot: Vec3,
    factors: Vec3,
    textureLock = true,
  ): BrushEditCandidate | BrushBatchEditCandidate | null {
    if (factors.every((factor) => Math.abs(factor - 1) <= Number.EPSILON))
      return null;
    return this.createBrushSetTransformCandidate(
      brushIds,
      "Scale brush",
      "Scale brushes",
      (before) => scaleBrush(before, pivot, factors, textureLock),
    );
  }

  public shearSelected(
    pivot: Vec3,
    sourceAxis: TransformAxis,
    targetAxis: TransformAxis,
    factor: number,
    textureLock = true,
  ): boolean {
    if (!this.kernel.selection || this.kernel.selection.faceId) return false;
    const candidate = this.createObjectShearCandidate(
      this.kernel.selection,
      pivot,
      sourceAxis,
      targetAxis,
      factor,
      textureLock,
    );
    if (!candidate) return false;
    this.ports.commitDocumentCandidate(candidate);
    return true;
  }

  public createObjectShearCandidate(
    selection: EditorSelection,
    pivot: Vec3,
    sourceAxis: TransformAxis,
    targetAxis: TransformAxis,
    factor: number,
    textureLock = true,
    updateEntityAngles = true,
  ): DocumentEditCandidate | null {
    if (selection.faceId || Math.abs(factor) <= Number.EPSILON) return null;
    const brushCount = selectedBrushIds(selection).length;
    const entityCount = selectedPointEntityIds(selection).length;
    if (brushCount + entityCount === 0) return null;
    const affine = shearAffineMatrix(pivot, sourceAxis, targetAxis, factor);
    let after = transformedObjects(
      this.kernel.document,
      selection,
      (brush) =>
        shearBrush(brush, pivot, sourceAxis, targetAxis, factor, textureLock),
      (entity) =>
        transformPointEntityByAffine(entity, affine, updateEntityAngles),
    );
    after = transformEditorGroupSubtreeMetadata(
      after,
      selection.groupId,
      affine,
    );
    return {
      label: objectTransformLabel("Shear", brushCount, entityCount),
      baseDocumentRevision: this.kernel.document.revision,
      before: this.kernel.document,
      after,
      selectionBefore: this.kernel.selection,
      selectionAfter: selection,
      document: after,
      repeatable: {
        kind: "shear",
        pivot: [...pivot],
        sourceAxis,
        targetAxis,
        factor,
        textureLock,
        updateEntityAngles,
      },
    };
  }

  public createShearCandidate(
    brushId: BrushId,
    pivot: Vec3,
    sourceAxis: TransformAxis,
    targetAxis: TransformAxis,
    factor: number,
    textureLock = true,
  ): BrushEditCandidate | null {
    if (Math.abs(factor) <= Number.EPSILON) return null;
    return this.createBrushTransformCandidate(
      brushId,
      "Shear brush",
      (before) =>
        shearBrush(before, pivot, sourceAxis, targetAxis, factor, textureLock),
    );
  }

  public createBrushSetShearCandidate(
    brushIds: readonly BrushId[],
    pivot: Vec3,
    sourceAxis: TransformAxis,
    targetAxis: TransformAxis,
    factor: number,
    textureLock = true,
  ): BrushEditCandidate | BrushBatchEditCandidate | null {
    if (Math.abs(factor) <= Number.EPSILON) return null;
    return this.createBrushSetTransformCandidate(
      brushIds,
      "Shear brush",
      "Shear brushes",
      (before) =>
        shearBrush(before, pivot, sourceAxis, targetAxis, factor, textureLock),
    );
  }

  public createBrushSetVertexRotationCandidate(
    brushIds: readonly BrushId[],
    vertices: readonly Vec3[],
    pivot: Vec3,
    axis: TransformAxis,
    degrees: number,
    ids: IdFactory,
    textureLock = true,
  ): BrushEditCandidate | BrushBatchEditCandidate | null {
    if (Math.abs(degrees) <= Number.EPSILON) return null;
    return this.createBrushSetVertexTransformCandidate(
      brushIds,
      vertices,
      "Rotate components",
      (before) =>
        rotateBrushVertices(
          before,
          vertices,
          pivot,
          axis,
          degrees,
          ids,
          textureLock,
        ),
    );
  }

  public createBrushSetVertexScaleCandidate(
    brushIds: readonly BrushId[],
    vertices: readonly Vec3[],
    pivot: Vec3,
    factors: Vec3,
    ids: IdFactory,
    textureLock = true,
  ): BrushEditCandidate | BrushBatchEditCandidate | null {
    if (factors.every((factor) => Math.abs(factor - 1) <= Number.EPSILON))
      return null;
    return this.createBrushSetVertexTransformCandidate(
      brushIds,
      vertices,
      "Scale components",
      (before) =>
        scaleBrushVertices(before, vertices, pivot, factors, ids, textureLock),
    );
  }

  public createBrushSetVertexShearCandidate(
    brushIds: readonly BrushId[],
    vertices: readonly Vec3[],
    pivot: Vec3,
    sourceAxis: TransformAxis,
    targetAxis: TransformAxis,
    factor: number,
    ids: IdFactory,
    textureLock = true,
  ): BrushEditCandidate | BrushBatchEditCandidate | null {
    if (Math.abs(factor) <= Number.EPSILON) return null;
    return this.createBrushSetVertexTransformCandidate(
      brushIds,
      vertices,
      "Shear components",
      (before) =>
        shearBrushVertices(
          before,
          vertices,
          pivot,
          sourceAxis,
          targetAxis,
          factor,
          ids,
          textureLock,
        ),
    );
  }

  private createBrushSetVertexTransformCandidate(
    brushIds: readonly BrushId[],
    vertices: readonly Vec3[],
    label: string,
    transform: (brush: MapBrush) => MapBrush,
  ): BrushEditCandidate | BrushBatchEditCandidate | null {
    if (vertices.length === 0) return null;
    const targets = this.brushIdsContainingVertices(brushIds, vertices);
    return this.createBrushSetTransformCandidate(
      targets,
      label,
      label,
      transform,
    );
  }

  private createBrushSetTransformCandidate(
    brushIds: readonly BrushId[],
    singleLabel: string,
    batchLabel: string,
    transform: (brush: MapBrush) => MapBrush,
  ): BrushEditCandidate | BrushBatchEditCandidate | null {
    const uniqueIds = [...new Set(brushIds)];
    if (uniqueIds.length === 0) return null;
    const edits: BrushEdit[] = [];
    for (const brushId of uniqueIds) {
      const before = findBrush(this.kernel.document, brushId);
      if (!before) return null;
      const after = transform(before);
      const derived = deriveBrush(after);
      if (!derived.valid) {
        throw new Error(
          `${uniqueIds.length === 1 ? singleLabel : batchLabel} would create an invalid brush: ${derived.diagnostics
            .map((diagnostic) => diagnostic.message)
            .join("; ")}`,
        );
      }
      edits.push({
        brushId,
        baseBrushRevision: before.revision,
        before,
        after,
      });
    }
    return createBrushEditCandidate(
      this.kernel.document,
      edits,
      singleLabel,
      batchLabel,
    );
  }

  private createBrushTransformCandidate(
    brushId: BrushId,
    label: string,
    transform: (brush: MapBrush) => MapBrush,
  ): BrushEditCandidate | null {
    const before = findBrush(this.kernel.document, brushId);
    if (!before) return null;
    const after = transform(before);
    const derived = deriveBrush(after);
    if (!derived.valid) {
      throw new Error(
        `${label} would create an invalid brush: ${derived.diagnostics
          .map((diagnostic) => diagnostic.message)
          .join("; ")}`,
      );
    }
    return {
      label,
      brushId,
      baseDocumentRevision: this.kernel.document.revision,
      baseBrushRevision: before.revision,
      before,
      after,
      document: replaceBrush(this.kernel.document, after),
    };
  }

  public moveSelectedVertices(
    vertices: readonly Vec3[],
    delta: Vec3,
    ids: IdFactory,
    textureLock = true,
  ): boolean {
    if (!this.kernel.selection || this.kernel.selection.faceId) return false;
    const candidate = this.createBrushSetVertexMoveCandidate(
      selectedBrushIds(this.kernel.selection),
      vertices,
      delta,
      ids,
      textureLock,
    );
    if (!candidate) return false;
    this.ports.commitCandidate(candidate);
    return true;
  }

  public createVertexMoveCandidate(
    brushId: BrushId,
    vertices: readonly Vec3[],
    delta: Vec3,
    ids: IdFactory,
    textureLock = true,
  ): BrushEditCandidate | null {
    if (delta.every((component) => Math.abs(component) <= Number.EPSILON))
      return null;
    return this.createBrushTransformCandidate(
      brushId,
      "Move vertices",
      (before) => moveBrushVertices(before, vertices, delta, ids, textureLock),
    );
  }

  public createBrushSetVertexMoveCandidate(
    brushIds: readonly BrushId[],
    vertices: readonly Vec3[],
    delta: Vec3,
    ids: IdFactory,
    textureLock = true,
  ): BrushEditCandidate | BrushBatchEditCandidate | null {
    if (delta.every((component) => Math.abs(component) <= Number.EPSILON))
      return null;
    const targets = this.brushIdsContainingVertices(brushIds, vertices);
    return this.createBrushSetTransformCandidate(
      targets,
      "Move vertices",
      "Move shared vertices",
      (before) => moveBrushVertices(before, vertices, delta, ids, textureLock),
    );
  }

  public createVertexSnapCandidate(
    brushIds: readonly BrushId[],
    vertices: readonly Vec3[],
    anchor: Vec3,
    target: Vec3,
    ids: IdFactory,
    textureLock = true,
  ): BrushEditCandidate | BrushBatchEditCandidate | null {
    if (
      ![...vertices, anchor, target].every((point) =>
        point.every(Number.isFinite),
      )
    ) {
      throw new Error("Vertex snap coordinates must be finite");
    }
    if (
      !vertices.some((vertex) =>
        vertex.every(
          (component, axis) => Math.abs(component - anchor[axis]!) <= 0.001,
        ),
      )
    ) {
      throw new Error(
        "Vertex snap anchor must be part of the selected handle set",
      );
    }
    const delta: Vec3 = [
      target[0] - anchor[0],
      target[1] - anchor[1],
      target[2] - anchor[2],
    ];
    const candidate = this.createBrushSetVertexMoveCandidate(
      brushIds,
      vertices,
      delta,
      ids,
      textureLock,
    );
    return candidate ? { ...candidate, label: "Snap vertices" } : null;
  }

  public createFaceSetTranslationCandidate(
    faces: readonly FaceSelection[],
    delta: Vec3,
    ids: IdFactory,
    textureLock = true,
  ): BrushEditCandidate | BrushBatchEditCandidate | null {
    if (faces.length === 0) return null;
    const vertices: Vec3[] = [];
    for (const face of faces) {
      const brush = findBrush(this.kernel.document, face.brushId);
      const derivedFace = brush
        ? deriveBrush(brush).faces.find(
            (candidate) => candidate.faceId === face.faceId,
          )
        : null;
      if (!derivedFace)
        throw new Error(`Unknown face ${face.faceId} on brush ${face.brushId}`);
      vertices.push(...derivedFace.vertices);
    }
    const candidate = this.createBrushSetVertexMoveCandidate(
      [...new Set(faces.map((face) => face.brushId))],
      vertices,
      delta,
      ids,
      textureLock,
    );
    if (!candidate) return null;
    return {
      ...candidate,
      label: faces.length === 1 ? "Move face" : "Move faces",
    };
  }

  public createVertexInsertionCandidate(
    brushId: BrushId,
    sourcePoint: Vec3,
    delta: Vec3,
    ids: IdFactory,
    textureLock = true,
  ): BrushEditCandidate | null {
    if (delta.every((component) => Math.abs(component) <= Number.EPSILON))
      return null;
    const vertex: Vec3 = [
      sourcePoint[0] + delta[0],
      sourcePoint[1] + delta[1],
      sourcePoint[2] + delta[2],
    ];
    return this.createBrushTransformCandidate(brushId, "Add vertex", (before) =>
      addBrushVertex(before, vertex, sourcePoint, ids, textureLock),
    );
  }

  public deleteSelectedVertices(
    vertices: readonly Vec3[],
    ids: IdFactory,
    textureLock = true,
  ): boolean {
    if (!this.kernel.selection || this.kernel.selection.faceId) return false;
    const candidate = this.createBrushSetVertexDeletionCandidate(
      selectedBrushIds(this.kernel.selection),
      vertices,
      ids,
      textureLock,
    );
    if (!candidate) return false;
    this.ports.commitCandidate(candidate);
    return true;
  }

  public createVertexDeletionCandidate(
    brushId: BrushId,
    vertices: readonly Vec3[],
    ids: IdFactory,
    textureLock = true,
  ): BrushEditCandidate | null {
    if (vertices.length === 0) return null;
    return this.createBrushTransformCandidate(
      brushId,
      "Delete vertices",
      (before) => deleteBrushVertices(before, vertices, ids, textureLock),
    );
  }

  public createBrushSetVertexDeletionCandidate(
    brushIds: readonly BrushId[],
    vertices: readonly Vec3[],
    ids: IdFactory,
    textureLock = true,
  ): BrushEditCandidate | BrushBatchEditCandidate | null {
    if (vertices.length === 0) return null;
    const targets = this.brushIdsContainingVertices(brushIds, vertices);
    return this.createBrushSetTransformCandidate(
      targets,
      "Delete vertices",
      "Delete shared vertices",
      (before) => deleteBrushVertices(before, vertices, ids, textureLock),
    );
  }

  private brushIdsContainingVertices(
    brushIds: readonly BrushId[],
    vertices: readonly Vec3[],
  ): readonly BrushId[] {
    return [...new Set(brushIds)].filter((brushId) => {
      const brush = findBrush(this.kernel.document, brushId);
      return Boolean(
        brush &&
        brushVertices(brush).some((point) =>
          vertices.some(
            (vertex) =>
              (point[0] - vertex[0]) ** 2 +
                (point[1] - vertex[1]) ** 2 +
                (point[2] - vertex[2]) ** 2 <=
              0.001 ** 2,
          ),
        ),
      );
    });
  }
}
