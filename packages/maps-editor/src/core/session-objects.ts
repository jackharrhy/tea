import {
  cloneBrush,
  insertBrush,
  insertBrushes,
  insertEntity,
  removeBrush,
  removeBrushes,
  removeEntities,
  replaceBrushes,
  replaceEntityProperties,
  setBrushFaceMaterials,
  translateBrush,
  type BrushInsertion,
} from "./document.js";
import { createObjectClipboardDocument } from "./clipboard.js";
import { deriveBrush } from "./geometry.js";
import {
  deriveEditorGroups,
  deleteEditorGroup,
  selectedEditorGroup,
} from "./groups.js";
import {
  normalizeSingleLinkedGroups,
  setEntityPropertyProtection as setLinkedEntityPropertyProtection,
  transformEditorGroupSubtreeMetadata,
  translationAffineMatrix,
} from "./linked-groups.js";
import {
  brushIdsWithMaterial,
  faceReferencesWithMaterial,
} from "./material-usage.js";
import { editorLayerForSelection, type EditorLayerId } from "./layers.js";
import { pointEntitiesInDocument } from "./point-entities.js";
import {
  sweepBrushFace,
  type SweepOptions,
  type SweepTransform,
} from "./sweep.js";
import {
  createFaceSelection,
  createObjectSelection,
  selectedBrushIds,
  selectedFaceReferences,
  selectedPointEntityIds,
} from "./selection.js";
import type {
  BrushId,
  EditorSelection,
  EntityId,
  FaceId,
  FaceSelection,
  IdFactory,
  MapBrush,
  MapDocument,
  MapEntity,
  Vec3,
} from "./types.js";
import { findBrush } from "./types.js";
import {
  faceSelectionKey,
  translatedObjects,
  type BrushEditCandidate,
  type BrushBatchEditCandidate,
  type BrushCreationCandidate,
  type BrushBatchCreationCandidate,
  type DocumentEditCandidate,
  type SessionCommitMutation,
  type SweepCandidate,
} from "./session-common.js";
import type { SessionKernel } from "./session-kernel.js";

type SessionObjectKernel = Readonly<
  Pick<SessionKernel, "document" | "editingGroupId" | "layerId" | "selection">
>;

export interface SessionObjectPorts {
  readonly activeLayerEntity: (document?: MapDocument) => MapEntity;
  readonly commitCandidate: (
    candidate: BrushEditCandidate | BrushBatchEditCandidate,
  ) => void;
  readonly commitDocumentCandidate: (candidate: DocumentEditCandidate) => void;
  readonly commitBatchCreationCandidate: (
    candidate: BrushBatchCreationCandidate,
  ) => void;
  readonly commitMutation: (mutation: SessionCommitMutation) => void;
  readonly createMaterialCandidate: (
    material: string,
    selection?: EditorSelection | null,
  ) => BrushEditCandidate | BrushBatchEditCandidate | null;
  readonly createPasteCandidate: (
    clipboard: MapDocument,
    ids: IdFactory,
    delta: Vec3,
    textureLock: boolean,
    targetGroupId: string | null,
    targetLayerId: EditorLayerId,
  ) => DocumentEditCandidate | null;
  readonly hasLinkedEditingGroup: (document?: MapDocument) => boolean;
  readonly editableObjectIds: () => {
    readonly brushIds: readonly BrushId[];
    readonly entityIds: readonly EntityId[];
  };
  readonly setObjectSelection: (
    brushIds: readonly BrushId[],
    entityIds: readonly EntityId[],
    label: string,
  ) => EditorSelection | null;
  readonly setSelection: (
    selection: EditorSelection | null,
    label: string,
  ) => EditorSelection | null;
}

export class SessionObjectCommands {
  public constructor(
    private readonly kernel: SessionObjectKernel,
    private readonly ports: SessionObjectPorts,
  ) {}

  public createBrushCandidate(
    brush: MapBrush,
    entityId?: EntityId,
  ): BrushCreationCandidate {
    const target = entityId
      ? this.kernel.document.entities.find((entity) => entity.id === entityId)
      : this.ports.activeLayerEntity();
    if (!target) {
      throw new Error(
        entityId
          ? `Unknown entity ${entityId}`
          : "The map has no worldspawn entity",
      );
    }
    const derived = deriveBrush(brush);
    if (!derived.valid) {
      throw new Error(
        derived.diagnostics.map((diagnostic) => diagnostic.message).join("; "),
      );
    }
    const insertionIndex = target.primitives.length;
    return {
      label: "Create brush",
      entityId: target.id,
      insertionIndex,
      baseDocumentRevision: this.kernel.document.revision,
      brush,
      document: insertBrush(
        this.kernel.document,
        target.id,
        brush,
        insertionIndex,
      ),
    };
  }
  public createBrushesCandidate(
    brushes: readonly MapBrush[],
    label = brushes.length === 1 ? "Create brush" : "Create brushes",
    entityId?: EntityId,
  ): BrushBatchCreationCandidate {
    if (brushes.length === 0)
      throw new Error("A batch creation candidate needs at least one brush");
    if (brushes.length > 1024) {
      throw new Error(
        "A batch creation candidate may contain at most 1024 brushes",
      );
    }
    const target = entityId
      ? this.kernel.document.entities.find((entity) => entity.id === entityId)
      : this.ports.activeLayerEntity();
    if (!target) {
      throw new Error(
        entityId
          ? `Unknown entity ${entityId}`
          : "The map has no worldspawn entity",
      );
    }
    for (const brush of brushes) {
      const derived = deriveBrush(brush);
      if (!derived.valid) {
        throw new Error(
          derived.diagnostics
            .map((diagnostic) => diagnostic.message)
            .join("; "),
        );
      }
    }
    const insertions = brushes.map((brush, index) => ({
      entityId: target.id,
      insertionIndex: target.primitives.length + index,
      brush,
    }));
    return {
      label,
      baseDocumentRevision: this.kernel.document.revision,
      insertions,
      selectionBefore: this.kernel.selection,
      selectionAfter: brushes.map((brush) => brush.id),
      document: insertBrushes(this.kernel.document, insertions),
    };
  }

  public createSweepCandidate(
    faces: readonly FaceSelection[],
    transform: SweepTransform,
    options: SweepOptions,
    ids: IdFactory,
  ): SweepCandidate | null {
    const normalizedFaces = faces.filter(
      (face, index, all) =>
        all.findIndex(
          (candidate) => faceSelectionKey(candidate) === faceSelectionKey(face),
        ) === index,
    );
    if (normalizedFaces.length === 0) return null;
    const insertions: BrushInsertion[] = [];
    const destinationCaps: (readonly Vec3[])[] = [];
    const nextInsertionByEntity = new Map<EntityId, number>();
    for (const face of normalizedFaces) {
      const sourceBrush = findBrush(this.kernel.document, face.brushId);
      if (!sourceBrush)
        throw new Error(`Unknown sweep source brush ${face.brushId}`);
      const owner = this.kernel.document.entities.find((entity) =>
        entity.primitives.some((brush) => brush.id === sourceBrush.id),
      );
      if (!owner)
        throw new Error(
          `Sweep source brush ${face.brushId} has no owning entity`,
        );
      const result = sweepBrushFace(
        sourceBrush,
        face.faceId,
        transform,
        options,
        ids,
      );
      const destinationCap = result.caps.at(-1);
      if (!destinationCap)
        throw new Error(
          `Sweep face ${face.faceId} produced no destination cap`,
        );
      destinationCaps.push(destinationCap);
      if (insertions.length + result.brushes.length > 1024) {
        throw new Error("A multi-face sweep may create at most 1024 brushes");
      }
      let insertionIndex =
        nextInsertionByEntity.get(owner.id) ?? owner.primitives.length;
      for (const brush of result.brushes) {
        insertions.push({ entityId: owner.id, insertionIndex, brush });
        insertionIndex += 1;
      }
      nextInsertionByEntity.set(owner.id, insertionIndex);
    }
    const selectionAfter = insertions.map((insertion) => insertion.brush.id);
    return {
      label: normalizedFaces.length === 1 ? "Sweep face" : "Sweep faces",
      baseDocumentRevision: this.kernel.document.revision,
      insertions,
      selectionBefore: this.kernel.selection,
      selectionAfter,
      sourceFaces: normalizedFaces,
      destinationCaps,
      document: insertBrushes(this.kernel.document, insertions),
    };
  }

  public sweepFaces(
    faces: readonly FaceSelection[],
    transform: SweepTransform,
    options: SweepOptions,
    ids: IdFactory,
  ): boolean {
    const candidate = this.createSweepCandidate(faces, transform, options, ids);
    if (!candidate) return false;
    this.ports.commitBatchCreationCandidate(candidate);
    return true;
  }

  /** Builds stable in-place clones that can be translated repeatedly during a drag preview. */
  public createDuplicationCandidate(
    brushIds: readonly BrushId[],
    ids: IdFactory,
  ): BrushBatchCreationCandidate | null {
    const normalizedIds = [...new Set(brushIds)];
    if (normalizedIds.length === 0) return null;
    if (normalizedIds.length > 1024)
      throw new Error("At most 1024 brushes may be duplicated");
    const selectedIds = new Set(normalizedIds);
    const insertions: BrushInsertion[] = [];
    for (const entity of this.kernel.document.entities) {
      let insertionIndex = entity.primitives.length;
      for (const brush of entity.primitives) {
        if (brush.kind !== "brush") continue;
        if (!selectedIds.has(brush.id)) continue;
        insertions.push({
          entityId: entity.id,
          insertionIndex,
          brush: cloneBrush(brush, ids),
        });
        insertionIndex += 1;
      }
    }
    if (insertions.length !== normalizedIds.length) {
      throw new Error("The duplication selection contains an unknown brush");
    }
    return {
      label: insertions.length === 1 ? "Duplicate brush" : "Duplicate brushes",
      baseDocumentRevision: this.kernel.document.revision,
      insertions,
      selectionBefore: this.kernel.selection,
      selectionAfter: insertions.map((insertion) => insertion.brush.id),
      document: insertBrushes(this.kernel.document, insertions),
    };
  }

  /** Creates stable-ID duplicates for a mixed brush/point-entity selection. */
  public createObjectDuplicationCandidate(
    selection: EditorSelection,
    ids: IdFactory,
    targetGroupId: string | null = null,
  ): DocumentEditCandidate | null {
    if (selection.faceId) return null;
    const brushIds = selectedBrushIds(selection);
    const entityIds = selectedPointEntityIds(selection);
    if (brushIds.length + entityIds.length === 0) return null;
    if (brushIds.length + entityIds.length > 1024) {
      throw new Error("At most 1024 objects may be duplicated");
    }
    const groupedClipboard = createObjectClipboardDocument(
      this.kernel.document,
      selection,
    );
    if (groupedClipboard && deriveEditorGroups(groupedClipboard).length > 0) {
      const sourceLayer = editorLayerForSelection(
        this.kernel.document,
        selection,
      );
      const candidate = this.ports.createPasteCandidate(
        groupedClipboard,
        ids,
        [0, 0, 0],
        true,
        targetGroupId,
        targetGroupId
          ? null
          : sourceLayer
            ? sourceLayer.id
            : this.kernel.layerId,
      );
      return candidate
        ? {
            ...candidate,
            label:
              brushIds.length + entityIds.length === 1
                ? "Duplicate object"
                : "Duplicate objects",
            selectionBefore: this.kernel.selection,
            repeatable: {
              kind: "duplicate",
              delta: [0, 0, 0],
              textureLock: true,
              targetGroupId,
            },
          }
        : null;
    }
    const brushCandidate = this.createDuplicationCandidate(brushIds, ids);
    let after = brushCandidate?.document ?? this.kernel.document;
    const pointEntityIds = new Set(entityIds);
    const pointEntities = pointEntitiesInDocument(this.kernel.document).filter(
      (entity) => pointEntityIds.has(entity.id),
    );
    if (pointEntities.length !== pointEntityIds.size) {
      throw new Error(
        "The duplication selection contains an unknown point entity",
      );
    }
    const duplicatedEntities = pointEntities.map<MapEntity>((entity) =>
      Object.assign({}, entity, {
        id: ids.entity(),
        properties: { ...entity.properties },
        primitives: [],
      }),
    );
    for (const entity of duplicatedEntities)
      after = insertEntity(after, entity);
    after = { ...after, revision: this.kernel.document.revision + 1 };
    const duplicatedBrushIds = brushCandidate?.selectionAfter ?? [];
    const duplicatedEntityIds = duplicatedEntities.map((entity) => entity.id);
    const selectionAfter = createObjectSelection(
      duplicatedBrushIds,
      duplicatedEntityIds,
      selection.entityId && duplicatedEntityIds.length > 0
        ? { kind: "entity", entityId: duplicatedEntityIds.at(-1)! }
        : duplicatedBrushIds.length > 0
          ? { kind: "brush", brushId: duplicatedBrushIds.at(-1)! }
          : { kind: "entity", entityId: duplicatedEntityIds.at(-1)! },
    );
    const count = brushIds.length + entityIds.length;
    const subject =
      brushIds.length > 0 && entityIds.length > 0
        ? "object"
        : entityIds.length > 0
          ? "entity"
          : "brush";
    return {
      label:
        count === 1
          ? `Duplicate ${subject}`
          : `Duplicate ${subject === "brush" ? "brushes" : `${subject}s`}`,
      baseDocumentRevision: this.kernel.document.revision,
      before: this.kernel.document,
      after,
      selectionBefore: this.kernel.selection,
      selectionAfter,
      document: after,
      repeatable: {
        kind: "duplicate",
        delta: [0, 0, 0],
        textureLock: true,
        targetGroupId,
      },
    };
  }

  /** Translates stable duplicates from their original locations without accumulating preview drift. */
  public translateObjectDuplicationCandidate(
    base: DocumentEditCandidate,
    delta: Vec3,
    textureLock = true,
    label = base.label,
  ): DocumentEditCandidate {
    if (base.baseDocumentRevision !== this.kernel.document.revision) {
      throw new Error(
        "Cannot translate a duplication candidate from a stale document revision",
      );
    }
    if (!base.selectionAfter)
      throw new Error("A duplication candidate requires a selection");
    let after = translatedObjects(
      base.after,
      base.selectionAfter,
      delta,
      textureLock,
    );
    after = transformEditorGroupSubtreeMetadata(
      after,
      base.selectionAfter.groupId,
      translationAffineMatrix(delta),
    );
    return {
      ...base,
      label,
      after: { ...after, revision: this.kernel.document.revision + 1 },
      document: { ...after, revision: this.kernel.document.revision + 1 },
      ...(base.repeatable?.kind === "duplicate"
        ? {
            repeatable: {
              ...base.repeatable,
              delta: [...delta],
              textureLock,
            },
          }
        : {}),
    };
  }

  /** Translates an in-place batch candidate without changing its generated brush or face IDs. */
  public translateBatchCreationCandidate(
    base: BrushBatchCreationCandidate,
    delta: Vec3,
    textureLock = true,
    label = base.label,
  ): BrushBatchCreationCandidate {
    if (base.baseDocumentRevision !== this.kernel.document.revision) {
      throw new Error(
        "Cannot translate a batch candidate from a stale document revision",
      );
    }
    if (!delta.every(Number.isFinite))
      throw new Error("Duplication translation must be finite");
    const insertions = base.insertions.map<BrushInsertion>((insertion) => ({
      ...insertion,
      brush: {
        ...translateBrush(insertion.brush, delta, textureLock),
        revision: insertion.brush.revision,
      },
    }));
    return {
      ...base,
      label,
      insertions,
      document: insertBrushes(this.kernel.document, insertions),
    };
  }

  public duplicateSelected(
    ids: IdFactory,
    delta: Vec3 = [16, 16, 0],
    textureLock = true,
    targetGroupId: string | null = null,
  ): boolean {
    if (!this.kernel.selection || this.kernel.selection.faceId) return false;
    const base = this.createObjectDuplicationCandidate(
      this.kernel.selection,
      ids,
      targetGroupId,
    );
    if (!base) return false;
    this.ports.commitDocumentCandidate(
      this.translateObjectDuplicationCandidate(base, delta, textureLock),
    );
    return true;
  }

  public deleteSelected(): boolean {
    if (!this.kernel.selection || this.kernel.selection.faceId) return false;
    const selectedGroup = selectedEditorGroup(
      this.kernel.document,
      this.kernel.selection,
    );
    if (selectedGroup) {
      const after = normalizeSingleLinkedGroups(
        deleteEditorGroup(this.kernel.document, selectedGroup.id),
      );
      this.ports.commitDocumentCandidate({
        label: "Delete group",
        baseDocumentRevision: this.kernel.document.revision,
        before: this.kernel.document,
        after,
        selectionBefore: this.kernel.selection,
        selectionAfter: null,
        document: after,
      });
      return true;
    }
    const brushIds = selectedBrushIds(this.kernel.selection);
    const entityIds = selectedPointEntityIds(this.kernel.selection);
    if (entityIds.length > 0) {
      let after = this.kernel.document;
      if (brushIds.length > 0) after = removeBrushes(after, brushIds);
      after = removeEntities(after, entityIds);
      after = { ...after, revision: this.kernel.document.revision + 1 };
      this.ports.commitDocumentCandidate({
        label:
          brushIds.length + entityIds.length === 1
            ? "Delete object"
            : "Delete objects",
        baseDocumentRevision: this.kernel.document.revision,
        before: this.kernel.document,
        after,
        selectionBefore: this.kernel.selection,
        selectionAfter: null,
        document: after,
      });
      return true;
    }
    if (brushIds.length === 1) return this.deleteBrush(brushIds[0]!);
    const selectedIds = new Set(brushIds);
    const insertions = this.kernel.document.entities.flatMap((entity) =>
      entity.primitives.flatMap((brush, insertionIndex) =>
        brush.kind === "brush" && selectedIds.has(brush.id)
          ? [{ entityId: entity.id, insertionIndex, brush }]
          : [],
      ),
    );
    if (insertions.length !== selectedIds.size) return false;
    if (this.ports.hasLinkedEditingGroup()) {
      const after = removeBrushes(this.kernel.document, brushIds);
      this.ports.commitDocumentCandidate({
        label: "Delete brushes",
        baseDocumentRevision: this.kernel.document.revision,
        before: this.kernel.document,
        after,
        selectionBefore: this.kernel.selection,
        selectionAfter: null,
        document: after,
      });
      return true;
    }
    this.ports.commitMutation({
      document: removeBrushes(this.kernel.document, brushIds),
      selection: null,
      historyEntry: {
        kind: "delete-brushes",
        label: "Delete brushes",
        insertions,
      },
    });
    return true;
  }

  public deleteBrush(brushId: BrushId): boolean {
    const owner = this.kernel.document.entities.find((entity) =>
      entity.primitives.some((brush) => brush.id === brushId),
    );
    if (!owner) return false;
    const insertionIndex = owner.primitives.findIndex(
      (brush) => brush.id === brushId,
    );
    const brush = owner.primitives[insertionIndex];
    if (!brush || brush.kind !== "brush") return false;
    if (this.ports.hasLinkedEditingGroup()) {
      const after = removeBrush(this.kernel.document, brushId);
      this.ports.commitDocumentCandidate({
        label: "Delete brush",
        baseDocumentRevision: this.kernel.document.revision,
        before: this.kernel.document,
        after,
        selectionBefore: this.kernel.selection,
        selectionAfter: null,
        document: after,
      });
      return true;
    }
    this.ports.commitMutation({
      document: removeBrush(this.kernel.document, brushId),
      selection:
        this.kernel.selection?.brushId === brushId
          ? null
          : this.kernel.selection,
      historyEntry: {
        kind: "delete-brush",
        label: "Delete brush",
        entityId: owner.id,
        insertionIndex,
        brush,
      },
    });
    return true;
  }

  public setEntityProperty(
    entityId: EntityId,
    key: string,
    value: string | null,
    protect = false,
  ): boolean {
    const entity = this.kernel.document.entities.find(
      (candidate) => candidate.id === entityId,
    );
    if (!entity) return false;
    const normalizedKey = key.trim();
    if (normalizedKey.length === 0)
      throw new Error("Entity property keys cannot be empty");
    if (/[\r\n]/.test(normalizedKey)) {
      throw new Error("Entity property keys cannot contain line breaks");
    }
    if (value === null && !(normalizedKey in entity.properties) && !protect)
      return false;
    if (
      value !== null &&
      entity.properties[normalizedKey] === value &&
      !protect
    )
      return false;
    const beforeDocument = this.kernel.document;
    let workingDocument = this.kernel.document;
    if (protect) {
      if (!this.kernel.editingGroupId)
        throw new Error("Open a linked group before protecting a property");
      workingDocument = setLinkedEntityPropertyProtection(
        workingDocument,
        this.kernel.editingGroupId,
        entityId,
        normalizedKey,
        true,
      );
    }
    const workingEntity = workingDocument.entities.find(
      (candidate) => candidate.id === entityId,
    )!;
    const before = entity.properties;
    const after = { ...workingEntity.properties };
    let label = "Update entity property";
    if (value === null) {
      delete after[normalizedKey];
      label = "Remove entity property";
    } else {
      if (!(normalizedKey in before)) label = "Add entity property";
      after[normalizedKey] = value;
    }
    const changedDocument = replaceEntityProperties(
      workingDocument,
      entityId,
      after,
    );
    if (this.ports.hasLinkedEditingGroup(changedDocument)) {
      this.ports.commitDocumentCandidate({
        label,
        baseDocumentRevision: this.kernel.document.revision,
        before: beforeDocument,
        after: changedDocument,
        selectionBefore: this.kernel.selection,
        selectionAfter: this.kernel.selection,
        document: changedDocument,
      });
      return true;
    }
    this.ports.commitMutation({
      document: changedDocument,
      selection: this.kernel.selection,
      historyEntry: {
        kind: "replace-entity-properties",
        label,
        entityId,
        before,
        after,
      },
    });
    return true;
  }

  public setEntityPropertyProtected(
    entityId: EntityId,
    key: string,
    protect: boolean,
  ): boolean {
    if (!this.kernel.editingGroupId) return false;
    const entity = this.kernel.document.entities.find(
      (candidate) => candidate.id === entityId,
    );
    if (!entity) return false;
    const beforeProtected = entity.properties["_tb_protected_properties"] ?? "";
    const after = setLinkedEntityPropertyProtection(
      this.kernel.document,
      this.kernel.editingGroupId,
      entityId,
      key,
      protect,
    );
    const updated = after.entities.find(
      (candidate) => candidate.id === entityId,
    )!;
    if (
      beforeProtected ===
        (updated.properties["_tb_protected_properties"] ?? "") &&
      entity.properties[key] === updated.properties[key]
    ) {
      return false;
    }
    this.ports.commitDocumentCandidate({
      label: protect ? "Protect entity property" : "Unprotect entity property",
      baseDocumentRevision: this.kernel.document.revision,
      before: this.kernel.document,
      after,
      selectionBefore: this.kernel.selection,
      selectionAfter: this.kernel.selection,
      document: after,
    });
    return true;
  }

  public applyMaterial(
    material: string,
    selection = this.kernel.selection,
  ): boolean {
    const candidate = this.ports.createMaterialCandidate(material, selection);
    if (!candidate) return false;
    this.ports.commitCandidate(candidate);
    return true;
  }

  /** Selects every visible, editable face using a material token. */
  public selectFacesUsingMaterial(material: string): EditorSelection | null {
    const editableBrushIds = new Set(this.ports.editableObjectIds().brushIds);
    const faces = faceReferencesWithMaterial(
      this.kernel.document,
      material,
      editableBrushIds,
    );
    const selection = createFaceSelection(faces);
    return this.ports.setSelection(
      selection,
      faces.length > 0
        ? `Select ${faces.length} ${faces.length === 1 ? "face" : "faces"} using ${material.trim()}`
        : `No visible faces use ${material.trim()}`,
    );
  }

  /** Selects every visible, editable brush containing a material token. */
  public selectBrushesUsingMaterial(material: string): EditorSelection | null {
    const editableBrushIds = new Set(this.ports.editableObjectIds().brushIds);
    const brushIds = brushIdsWithMaterial(
      this.kernel.document,
      material,
      editableBrushIds,
    );
    return this.ports.setObjectSelection(
      brushIds,
      [],
      brushIds.length > 0
        ? `Select ${brushIds.length} ${brushIds.length === 1 ? "brush" : "brushes"} using ${material.trim()}`
        : `No visible brushes use ${material.trim()}`,
    );
  }

  /** Builds one document transaction that replaces a material globally or within the selection. */
  public createMaterialReplacementCandidate(
    sourceMaterial: string,
    replacementMaterial: string,
    selection = this.kernel.selection,
  ): DocumentEditCandidate | null {
    const source = sourceMaterial.trim();
    const replacement = replacementMaterial.trim();
    if (
      !source ||
      !replacement ||
      source.toLowerCase() === replacement.toLowerCase()
    )
      return null;

    const matchingFaces = faceReferencesWithMaterial(
      this.kernel.document,
      source,
    );
    const scopedFaces = selection?.faceId
      ? (() => {
          const selected = new Set(
            selectedFaceReferences(selection).map(
              (face) => `${face.brushId}\u0000${face.faceId}`,
            ),
          );
          return matchingFaces.filter((face) =>
            selected.has(`${face.brushId}\u0000${face.faceId}`),
          );
        })()
      : selection
        ? (() => {
            const selected = new Set(selectedBrushIds(selection));
            return matchingFaces.filter((face) => selected.has(face.brushId));
          })()
        : matchingFaces;
    if (scopedFaces.length === 0) return null;

    const byBrush = new Map<BrushId, FaceId[]>();
    for (const face of scopedFaces) {
      const faceIds = byBrush.get(face.brushId) ?? [];
      faceIds.push(face.faceId);
      byBrush.set(face.brushId, faceIds);
    }
    const replacements = [...byBrush].map(([brushId, faceIds]) => {
      const brush = findBrush(this.kernel.document, brushId);
      if (!brush)
        throw new Error(`Unknown material replacement brush ${brushId}`);
      return setBrushFaceMaterials(brush, replacement, faceIds);
    });
    const after = replaceBrushes(this.kernel.document, replacements);
    return {
      label: `Replace material ${source} → ${replacement}`,
      baseDocumentRevision: this.kernel.document.revision,
      before: this.kernel.document,
      after,
      selectionBefore: this.kernel.selection,
      selectionAfter: createFaceSelection(scopedFaces),
      document: after,
    };
  }

  /** Replaces matching materials and selects the changed faces as one undoable edit. */
  public replaceMaterial(
    sourceMaterial: string,
    replacementMaterial: string,
    selection = this.kernel.selection,
  ): number {
    const candidate = this.createMaterialReplacementCandidate(
      sourceMaterial,
      replacementMaterial,
      selection,
    );
    if (!candidate) return 0;
    const changedFaceCount = selectedFaceReferences(
      candidate.selectionAfter,
    ).length;
    this.ports.commitDocumentCandidate(candidate);
    return changedFaceCount;
  }
}
