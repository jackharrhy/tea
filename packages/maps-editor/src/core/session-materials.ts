import {
  alignFaceTexture,
  setBrushFaceMaterials,
  setBrushMaterial,
  setFaceTextureTransform,
  setSurfaceAttributeFlag,
  setSurfaceAttributeValue,
  updateBrushFaceSurfaces,
  transformFaceTexture,
  transferFaceAttributes,
  type FaceAttributeTransferMode,
  type FaceTextureAlignmentOperation,
  type FaceTextureAlignmentOptions,
  type FaceTextureTransform,
  type FaceTextureTransformDelta,
} from "./document.js";
import { type FaceAttributeClipboard } from "./clipboard.js";
import { deriveBrush } from "./geometry.js";
import { type BrushEdit } from "./history.js";
import { selectedBrushIds, selectedFaceReferences } from "./selection.js";
import type {
  BrushId,
  EditorSelection,
  FaceSelection,
  MapBrush,
  Vec3,
} from "./types.js";
import { findBrush } from "./types.js";
import {
  createBrushEditCandidate,
  faceSelectionKey,
  type BrushBatchEditCandidate,
  type BrushEditCandidate,
} from "./session-common.js";
import type { SessionKernel } from "./session-kernel.js";

type SessionMaterialKernel = Readonly<
  Pick<SessionKernel, "document" | "selection">
>;

export type FaceTextureProjectionField =
  | "offset-u"
  | "offset-v"
  | "scale-u"
  | "scale-v"
  | "rotation";

function groupFacesByBrush(
  faces: readonly FaceSelection[],
): Map<BrushId, FaceSelection[]> {
  const groups = new Map<BrushId, FaceSelection[]>();
  for (const face of faces) {
    const group = groups.get(face.brushId) ?? [];
    group.push(face);
    groups.set(face.brushId, group);
  }
  return groups;
}

function projectionFieldValue(
  projection: FaceTextureTransform,
  field: FaceTextureProjectionField,
): number {
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
}

function projectionWithField(
  projection: FaceTextureTransform,
  field: FaceTextureProjectionField,
  value: number,
): FaceTextureTransform {
  return {
    offset: [
      field === "offset-u" ? value : projection.offset[0],
      field === "offset-v" ? value : projection.offset[1],
    ],
    scale: [
      field === "scale-u" ? value : projection.scale[0],
      field === "scale-v" ? value : projection.scale[1],
    ],
    rotationDegrees: field === "rotation" ? value : projection.rotationDegrees,
  };
}

export interface SessionMaterialPorts {
  readonly commitCandidate: (
    candidate: BrushEditCandidate | BrushBatchEditCandidate,
  ) => void;
}

export class SessionMaterialCommands {
  public constructor(
    private readonly kernel: SessionMaterialKernel,
    private readonly ports: SessionMaterialPorts,
  ) {}

  private createSelectedSurfaceCandidate(
    label: string,
    update: Parameters<typeof updateBrushFaceSurfaces>[2],
  ): BrushEditCandidate | BrushBatchEditCandidate | null {
    const selectedFaces = selectedFaceReferences(this.kernel.selection);
    if (selectedFaces.length === 0) return null;
    const byBrush = groupFacesByBrush(selectedFaces);
    const edits = [...byBrush].map<BrushEdit>(([brushId, faces]) => {
      const before = findBrush(this.kernel.document, brushId)!;
      const after = updateBrushFaceSurfaces(
        before,
        faces.map(({ faceId }) => faceId),
        update,
      );
      return { brushId, baseBrushRevision: before.revision, before, after };
    });
    return createBrushEditCandidate(this.kernel.document, edits, label);
  }

  public setSelectedSurfaceFlag(
    field: "contents" | "flags",
    mask: number,
    enabled: boolean,
  ): boolean {
    const candidate = this.createSelectedSurfaceCandidate(
      `${enabled ? "Set" : "Clear"} surface ${field} flag`,
      (surface) => setSurfaceAttributeFlag(surface, field, mask, enabled),
    );
    if (!candidate) return false;
    this.ports.commitCandidate(candidate);
    return true;
  }

  public setSelectedSurfaceValue(value: number): boolean {
    const candidate = this.createSelectedSurfaceCandidate(
      "Set surface value",
      (surface) => setSurfaceAttributeValue(surface, value),
    );
    if (!candidate) return false;
    this.ports.commitCandidate(candidate);
    return true;
  }

  public createMaterialCandidate(
    material: string,
    selection = this.kernel.selection,
  ): BrushEditCandidate | BrushBatchEditCandidate | null {
    if (!selection) return null;
    const selectedFaces = selectedFaceReferences(selection);
    const byBrush = groupFacesByBrush(selectedFaces);
    if (selectedFaces.length === 0) {
      for (const brushId of selectedBrushIds(selection))
        byBrush.set(brushId, []);
    }
    const edits: BrushEdit[] = [];
    for (const [brushId, faceSelections] of byBrush) {
      const before = findBrush(this.kernel.document, brushId);
      if (!before) continue;
      const affectedFaces =
        faceSelections.length === 0
          ? before.faces
          : before.faces.filter((face) =>
              faceSelections.some((selected) => selected.faceId === face.id),
            );
      if (affectedFaces.every((face) => face.material === material.trim()))
        continue;
      const after =
        faceSelections.length === 0
          ? setBrushMaterial(before, material)
          : setBrushFaceMaterials(
              before,
              material,
              faceSelections.map((face) => face.faceId),
            );
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
      "Apply material",
    );
  }

  public applyTextureTransform(
    transform: FaceTextureTransform,
    selection = this.kernel.selection,
  ): boolean {
    const candidate = this.createTextureTransformCandidate(
      transform,
      selection,
    );
    if (!candidate) return false;
    this.ports.commitCandidate(candidate);
    return true;
  }

  public setSelectedTextureProjectionField(
    field: FaceTextureProjectionField,
    value: number,
  ): boolean {
    if (!Number.isFinite(value))
      throw new Error("Texture projection value must be finite");
    if (
      (field === "scale-u" || field === "scale-v") &&
      Math.abs(value) <= 1e-6
    ) {
      throw new Error("Texture scale cannot be zero");
    }
    const faces = selectedFaceReferences(this.kernel.selection);
    if (faces.length === 0) return false;
    const byBrush = groupFacesByBrush(faces);
    const edits: BrushEdit[] = [];
    for (const [brushId, faceSelections] of byBrush) {
      const before = findBrush(this.kernel.document, brushId);
      if (!before) continue;
      let after = before;
      for (const selection of faceSelections) {
        const face = after.faces.find(
          (candidate) => candidate.id === selection.faceId,
        );
        if (!face) continue;
        if (projectionFieldValue(face.projection, field) === value) continue;
        after = setFaceTextureTransform(
          after,
          selection.faceId,
          projectionWithField(face.projection, field, value),
        );
      }
      if (after !== before) {
        edits.push({
          brushId,
          baseBrushRevision: before.revision,
          before,
          after,
        });
      }
    }
    const candidate = createBrushEditCandidate(
      this.kernel.document,
      edits,
      "Adjust texture",
    );
    if (!candidate) return false;
    this.ports.commitCandidate(candidate);
    return true;
  }

  public alignTexture(
    operation: FaceTextureAlignmentOperation,
    options: FaceTextureAlignmentOptions = {},
    selection = this.kernel.selection,
  ): boolean {
    const candidate = this.createTextureAlignmentCandidate(
      operation,
      options,
      selection,
    );
    if (!candidate) return false;
    this.ports.commitCandidate(candidate);
    return true;
  }

  public createTextureAlignmentCandidate(
    operation: FaceTextureAlignmentOperation,
    options: FaceTextureAlignmentOptions = {},
    selection = this.kernel.selection,
  ): BrushEditCandidate | BrushBatchEditCandidate | null {
    if (!selection) return null;
    const selectedFaces = selectedFaceReferences(selection);
    const faces =
      selectedFaces.length > 0
        ? selectedFaces
        : selectedBrushIds(selection).flatMap((brushId) => {
            const brush = findBrush(this.kernel.document, brushId);
            return (
              brush?.faces.map((face) => ({ brushId, faceId: face.id })) ?? []
            );
          });
    if (faces.length === 0) return null;
    const byBrush = groupFacesByBrush(faces);
    const edits = [...byBrush].map<BrushEdit>(([brushId, targets]) => {
      const before = findBrush(this.kernel.document, brushId)!;
      const after = targets.reduce(
        (brush, target) =>
          alignFaceTexture(brush, target.faceId, operation, options),
        before,
      );
      return { brushId, baseBrushRevision: before.revision, before, after };
    });
    const labels: Record<FaceTextureAlignmentOperation, string> = {
      reset: "Reset texture alignment",
      world: "Reset world texture alignment",
      "flip-u": "Flip texture horizontally",
      "flip-v": "Flip texture vertically",
      "rotate-ccw": "Rotate texture counterclockwise",
      "rotate-cw": "Rotate texture clockwise",
      "align-edge": "Align texture to face edge",
      "justify-u-min": "Justify texture left",
      "justify-u-max": "Justify texture right",
      "justify-v-min": "Justify texture top",
      "justify-v-max": "Justify texture bottom",
      "fit-u": "Fit texture horizontally",
      "fit-v": "Fit texture vertically",
      "auto-fit": "Auto-fit texture",
    };
    const label = labels[operation];
    return createBrushEditCandidate(this.kernel.document, edits, label);
  }

  public transferFaceAttributes(
    source: FaceSelection,
    targets: readonly FaceSelection[],
    mode: FaceAttributeTransferMode,
  ): boolean {
    const candidate = this.createFaceAttributeTransferCandidate(
      source,
      targets,
      mode,
    );
    if (!candidate) return false;
    this.ports.commitCandidate(candidate);
    return true;
  }

  public pasteFaceAttributes(
    source: FaceAttributeClipboard,
    selection: EditorSelection | null = this.kernel.selection,
  ): boolean {
    const candidate = this.createFaceAttributePasteCandidate(source, selection);
    if (!candidate) return false;
    this.ports.commitCandidate(candidate);
    return true;
  }

  public createFaceAttributePasteCandidate(
    source: FaceAttributeClipboard,
    selection: EditorSelection | null = this.kernel.selection,
  ): BrushEditCandidate | BrushBatchEditCandidate | null {
    const targets = selectedFaceReferences(selection);
    if (targets.length === 0) return null;
    const afterByBrush = new Map<BrushId, MapBrush>();
    for (const target of targets) {
      const before =
        afterByBrush.get(target.brushId) ??
        findBrush(this.kernel.document, target.brushId);
      if (!before) throw new Error(`Unknown target brush ${target.brushId}`);
      afterByBrush.set(
        target.brushId,
        transferFaceAttributes(before, target.faceId, source, "project"),
      );
    }
    const edits = [...afterByBrush].map<BrushEdit>(([brushId, after]) => {
      const before = findBrush(this.kernel.document, brushId)!;
      return { brushId, baseBrushRevision: before.revision, before, after };
    });
    return createBrushEditCandidate(
      this.kernel.document,
      edits,
      "Paste face attributes",
    );
  }

  public createFaceAttributeTransferCandidate(
    source: FaceSelection,
    targets: readonly FaceSelection[],
    mode: FaceAttributeTransferMode,
  ): BrushEditCandidate | BrushBatchEditCandidate | null {
    const sourceBrush = findBrush(this.kernel.document, source.brushId);
    let chainSource = sourceBrush?.faces.find(
      (face) => face.id === source.faceId,
    );
    if (!chainSource) throw new Error(`Unknown source face ${source.faceId}`);
    const normalizedTargets = targets.filter(
      (target, index, all) =>
        faceSelectionKey(target) !== faceSelectionKey(source) &&
        all.findIndex(
          (candidate) =>
            faceSelectionKey(candidate) === faceSelectionKey(target),
        ) === index,
    );
    if (normalizedTargets.length === 0) return null;
    const afterByBrush = new Map<BrushId, MapBrush>();
    for (const target of normalizedTargets) {
      const before =
        afterByBrush.get(target.brushId) ??
        findBrush(this.kernel.document, target.brushId);
      if (!before) throw new Error(`Unknown target brush ${target.brushId}`);
      const after = transferFaceAttributes(
        before,
        target.faceId,
        chainSource,
        mode,
      );
      afterByBrush.set(target.brushId, after);
      chainSource = after.faces.find((face) => face.id === target.faceId);
      if (!chainSource)
        throw new Error(`Unknown transferred face ${target.faceId}`);
    }
    const edits = [...afterByBrush].map<BrushEdit>(([brushId, after]) => {
      const before = findBrush(this.kernel.document, brushId)!;
      return { brushId, baseBrushRevision: before.revision, before, after };
    });
    const label =
      mode === "material" ? "Transfer material" : "Transfer face attributes";
    return createBrushEditCandidate(this.kernel.document, edits, label);
  }

  public createTextureTransformCandidate(
    transform: FaceTextureTransform,
    selection = this.kernel.selection,
  ): BrushEditCandidate | BrushBatchEditCandidate | null {
    const faces = selectedFaceReferences(selection);
    if (faces.length === 0) return null;
    const byBrush = groupFacesByBrush(faces);
    const edits: BrushEdit[] = [];
    for (const [brushId, faceSelections] of byBrush) {
      const before = findBrush(this.kernel.document, brushId);
      if (!before) continue;
      let after = before;
      for (const face of faceSelections) {
        after = setFaceTextureTransform(after, face.faceId, transform);
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
      "Adjust texture",
    );
  }

  public createTextureTransformDeltaCandidate(
    transform: FaceTextureTransformDelta,
    primary: FaceSelection,
    primaryPivot: Vec3,
    selection = this.kernel.selection,
  ): BrushEditCandidate | BrushBatchEditCandidate | null {
    const identity =
      transform.offset.every((value) => Math.abs(value) <= Number.EPSILON) &&
      Math.abs(transform.rotationDegrees) <= Number.EPSILON &&
      transform.scale.every((value) => Math.abs(value - 1) <= Number.EPSILON);
    if (identity) return null;
    const faces = selectedFaceReferences(selection);
    const primaryKey = `${primary.brushId}\u0000${primary.faceId}`;
    if (
      faces.length === 0 ||
      !faces.some(
        (face) => `${face.brushId}\u0000${face.faceId}` === primaryKey,
      )
    ) {
      return null;
    }
    const byBrush = groupFacesByBrush(faces);
    const edits: BrushEdit[] = [];
    for (const [brushId, faceSelections] of byBrush) {
      const before = findBrush(this.kernel.document, brushId);
      if (!before) continue;
      const derived = deriveBrush(before);
      let after = before;
      for (const face of faceSelections) {
        const derivedFace = derived.faces.find(
          (candidate) => candidate.faceId === face.faceId,
        );
        if (!derivedFace || derivedFace.vertices.length === 0) {
          throw new Error(`Cannot transform missing face ${face.faceId}`);
        }
        const pivot =
          `${face.brushId}\u0000${face.faceId}` === primaryKey
            ? primaryPivot
            : ((): Vec3 => {
                const sum = derivedFace.vertices.reduce<Vec3>(
                  (value, point) => [
                    value[0] + point[0],
                    value[1] + point[1],
                    value[2] + point[2],
                  ],
                  [0, 0, 0],
                );
                return [
                  sum[0] / derivedFace.vertices.length,
                  sum[1] / derivedFace.vertices.length,
                  sum[2] / derivedFace.vertices.length,
                ];
              })();
        after = transformFaceTexture(after, face.faceId, transform, pivot);
      }
      edits.push({
        brushId,
        baseBrushRevision: before.revision,
        before,
        after,
      });
    }
    const changingScale = transform.scale.some(
      (value) => Math.abs(value - 1) > Number.EPSILON,
    );
    const label = changingScale
      ? "Scale texture"
      : Math.abs(transform.rotationDegrees) > Number.EPSILON
        ? "Rotate texture"
        : "Pan texture";
    return createBrushEditCandidate(this.kernel.document, edits, label);
  }
}
