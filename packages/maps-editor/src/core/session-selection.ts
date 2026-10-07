import { removeBrushes } from "./document.js";
import {
  deriveEditorGroups,
  editorGroupForObject,
  groupObjects,
  isEditorGroupEntity,
  moveObjectsIntoEditorGroup,
  renameEditorGroup,
  selectedEditorGroup,
  selectionForEditorGroup,
  ungroupObjects,
} from "./groups.js";
import {
  createLinkedGroupDuplicate,
  normalizeSingleLinkedGroups,
  transformEditorGroupSubtreeMetadata,
  translationAffineMatrix,
  unlinkEditorGroup,
} from "./linked-groups.js";
import {
  applyEditorIssueFix,
  deriveEditorIssues,
  selectionForEditorIssue,
} from "./issues.js";
import { isEditorLayerEntity } from "./layers.js";
import { pointEntitiesInDocument } from "./point-entities.js";
import {
  connectedCoplanarFaces,
  createFaceSelection,
  createObjectSelection,
  facesOfBrush,
  matchingBrushFaces,
  selectedBrushIds,
  selectedFaceReferences,
  selectedPointEntityIds,
  updateBrushSelection,
  updateFaceSelection,
  updatePointEntitySelection,
} from "./selection.js";
import {
  querySelectionBrushes,
  type SelectionBrushProjection,
  type SelectionBrushQueryMode,
} from "./selection-query.js";
import type {
  BrushId,
  BrushSelection,
  EditorObjectViewState,
  EditorSelection,
  EntityId,
  FaceId,
  FaceSelection,
  IdFactory,
  Vec3,
} from "./types.js";
import { brushesInDocument, findBrush } from "./types.js";
import {
  faceSelectionKey,
  translatedObjects,
  type DocumentEditCandidate,
  type SelectionBrushSelectionResult,
} from "./session-common.js";
import type { SessionKernel } from "./session-kernel.js";

type SessionSelectionKernel = Readonly<Pick<SessionKernel, "document">> &
  Pick<
    SessionKernel,
    | "discardRepeatableCommands"
    | "editingGroupId"
    | "hiddenBrushIds"
    | "hiddenEntityIds"
    | "issueFixIds"
    | "layerId"
    | "lockedBrushIds"
    | "lockedEntityIds"
    | "notify"
    | "selection"
    | "snapshotObjectViewState"
  >;

export interface SessionSelectionPorts {
  readonly objectViewState: () => EditorObjectViewState;
  readonly commitDocumentCandidate: (candidate: DocumentEditCandidate) => void;
  readonly commitObjectViewState: (
    label: string,
    state: EditorObjectViewState,
    selectionAfter: EditorSelection | null,
  ) => boolean;
}

export class SessionSelectionCommands {
  public constructor(
    private readonly kernel: SessionSelectionKernel,
    private readonly ports: SessionSelectionPorts,
  ) {}

  private get issues() {
    return deriveEditorIssues(this.kernel.document);
  }

  private get objectViewState(): EditorObjectViewState {
    return this.ports.objectViewState();
  }

  private get canShowAll(): boolean {
    return (
      this.kernel.hiddenBrushIds.size + this.kernel.hiddenEntityIds.size > 0
    );
  }

  private get canUnlockAll(): boolean {
    return (
      this.kernel.lockedBrushIds.size + this.kernel.lockedEntityIds.size > 0
    );
  }

  public groupSelected(
    name: string,
    ids: IdFactory,
    openGroupId: string | null = null,
  ): string | null {
    const selection = this.kernel.selection;
    if (!selection || selection.faceId) return null;
    const result = groupObjects(
      this.kernel.document,
      selection,
      name,
      ids,
      openGroupId,
      openGroupId ? null : this.kernel.layerId,
    );
    this.ports.commitDocumentCandidate({
      label: "Group objects",
      baseDocumentRevision: this.kernel.document.revision,
      before: this.kernel.document,
      after: result.document,
      selectionBefore: selection,
      selectionAfter: result.selection,
      document: result.document,
    });
    return result.groupId;
  }
  /** Creates another transformed copy and links both group roots as one reusable structure. */
  public linkedDuplicateSelected(
    ids: IdFactory,
    delta: Vec3 = [16, 16, 0],
    textureLock = true,
  ): string | null {
    const source = selectedEditorGroup(
      this.kernel.document,
      this.kernel.selection,
    );
    if (!source) return null;
    const duplicate = createLinkedGroupDuplicate(
      this.kernel.document,
      source.id,
      ids,
    );
    let after = duplicate.document;
    if (
      duplicate.selection &&
      delta.some((component) => Math.abs(component) > Number.EPSILON)
    ) {
      after = translatedObjects(after, duplicate.selection, delta, textureLock);
      after = transformEditorGroupSubtreeMetadata(
        after,
        duplicate.groupId,
        translationAffineMatrix(delta),
      );
    }
    this.ports.commitDocumentCandidate({
      label: "Create linked duplicate",
      baseDocumentRevision: this.kernel.document.revision,
      before: this.kernel.document,
      after,
      selectionBefore: this.kernel.selection,
      selectionAfter: duplicate.selection,
      document: after,
    });
    return duplicate.groupId;
  }

  public unlinkGroup(groupId?: string): boolean {
    const group = groupId
      ? deriveEditorGroups(this.kernel.document).find(
          (candidate) => candidate.id === groupId,
        )
      : selectedEditorGroup(this.kernel.document, this.kernel.selection);
    if (!group?.linkedGroupId) return false;
    const after = unlinkEditorGroup(this.kernel.document, group.id);
    this.ports.commitDocumentCandidate({
      label: "Unlink group",
      baseDocumentRevision: this.kernel.document.revision,
      before: this.kernel.document,
      after,
      selectionBefore: this.kernel.selection,
      selectionAfter: this.kernel.selection,
      document: after,
    });
    return true;
  }

  /** Removes one selected group container but retains all of its objects and child groups. */
  public ungroupSelected(groupId?: string): boolean {
    const group = groupId
      ? { id: groupId }
      : selectedEditorGroup(this.kernel.document, this.kernel.selection);
    if (!group) return false;
    const result = ungroupObjects(this.kernel.document, group.id);
    const after = normalizeSingleLinkedGroups(result.document);
    this.ports.commitDocumentCandidate({
      label: "Ungroup objects",
      baseDocumentRevision: this.kernel.document.revision,
      before: this.kernel.document,
      after,
      selectionBefore: this.kernel.selection,
      selectionAfter: result.selection,
      document: after,
    });
    return true;
  }

  public renameGroup(groupId: string, name: string): boolean {
    const after = renameEditorGroup(this.kernel.document, groupId, name);
    if (after === this.kernel.document) return false;
    this.ports.commitDocumentCandidate({
      label: "Rename group",
      baseDocumentRevision: this.kernel.document.revision,
      before: this.kernel.document,
      after,
      selectionBefore: this.kernel.selection,
      selectionAfter: this.kernel.selection,
      document: after,
    });
    return true;
  }

  public addSelectedToGroup(groupId: string): boolean {
    const selection = this.kernel.selection;
    if (!selection || selection.faceId) return false;
    const after = moveObjectsIntoEditorGroup(
      this.kernel.document,
      selection,
      groupId,
    );
    if (after === this.kernel.document) return false;
    this.ports.commitDocumentCandidate({
      label: "Add objects to group",
      baseDocumentRevision: this.kernel.document.revision,
      before: this.kernel.document,
      after,
      selectionBefore: selection,
      selectionAfter: selection,
      document: after,
    });
    return true;
  }

  public hideSelected(): boolean {
    const selection = this.kernel.selection;
    if (!selection || selection.faceId) return false;
    const brushIds = selectedBrushIds(selection);
    const entityIds = selectedPointEntityIds(selection);
    if (brushIds.length + entityIds.length === 0) return false;
    const after = this.kernel.snapshotObjectViewState();
    return this.ports.commitObjectViewState(
      brushIds.length + entityIds.length === 1 ? "Hide object" : "Hide objects",
      {
        ...after,
        hiddenBrushIds: [...new Set([...after.hiddenBrushIds, ...brushIds])],
        hiddenEntityIds: [...new Set([...after.hiddenEntityIds, ...entityIds])],
      },
      null,
    );
  }

  public isolateSelected(): boolean {
    const selection = this.kernel.selection;
    if (!selection || selection.faceId) return false;
    const visibleBrushIds = new Set(selectedBrushIds(selection));
    const visibleEntityIds = new Set(selectedPointEntityIds(selection));
    if (visibleBrushIds.size + visibleEntityIds.size === 0) return false;
    return this.ports.commitObjectViewState(
      "Isolate objects",
      {
        ...this.kernel.snapshotObjectViewState(),
        hiddenBrushIds: brushesInDocument(this.kernel.document)
          .map((brush) => brush.id)
          .filter((brushId) => !visibleBrushIds.has(brushId)),
        hiddenEntityIds: pointEntitiesInDocument(this.kernel.document)
          .map((entity) => entity.id)
          .filter((entityId) => !visibleEntityIds.has(entityId)),
      },
      selection,
    );
  }

  public showAll(): boolean {
    if (!this.canShowAll) return false;
    return this.ports.commitObjectViewState(
      "Show all objects",
      {
        ...this.kernel.snapshotObjectViewState(),
        hiddenBrushIds: [],
        hiddenEntityIds: [],
      },
      this.kernel.selection,
    );
  }

  public lockSelected(): boolean {
    const selection = this.kernel.selection;
    if (!selection || selection.faceId) return false;
    const brushIds = selectedBrushIds(selection);
    const entityIds = selectedPointEntityIds(selection);
    if (brushIds.length + entityIds.length === 0) return false;
    const before = this.kernel.snapshotObjectViewState();
    return this.ports.commitObjectViewState(
      brushIds.length + entityIds.length === 1 ? "Lock object" : "Lock objects",
      {
        ...before,
        lockedBrushIds: [...new Set([...before.lockedBrushIds, ...brushIds])],
        lockedEntityIds: [
          ...new Set([...before.lockedEntityIds, ...entityIds]),
        ],
      },
      null,
    );
  }

  public unlockAll(): boolean {
    if (!this.canUnlockAll) return false;
    return this.ports.commitObjectViewState(
      "Unlock all objects",
      {
        ...this.kernel.snapshotObjectViewState(),
        lockedBrushIds: [],
        lockedEntityIds: [],
      },
      this.kernel.selection,
    );
  }

  public select(selection: EditorSelection | null): void {
    if (selection) this.assertSelectionAvailable(selection);
    this.kernel.discardRepeatableCommands();
    this.kernel.selection = selection;
    this.kernel.notify(
      "selection",
      selection
        ? selection.faceId
          ? "Select face"
          : selection.entityId
            ? "Select entity"
            : "Select brush"
        : "Clear selection",
    );
  }

  /** Internal selection commit used by focused command domains that already own the label. */
  public setSelection(
    selection: EditorSelection | null,
    label: string,
  ): EditorSelection | null {
    if (selection) this.assertSelectionAvailable(selection);
    this.kernel.discardRepeatableCommands();
    this.kernel.selection = selection;
    this.kernel.notify("selection", label);
    return selection;
  }

  /** Locates every object implicated by an issue, including hidden or locked objects. */
  public selectIssue(issueId: string): EditorSelection | null {
    const issue = this.issues.find((candidate) => candidate.id === issueId);
    if (!issue) return null;
    this.kernel.discardRepeatableCommands();
    this.kernel.selection = selectionForEditorIssue(issue);
    this.kernel.notify("selection", `Select issue: ${issue.message}`);
    return this.kernel.selection;
  }
  public fixIssue(issueId: string): boolean {
    const result = applyEditorIssueFix(
      this.kernel.document,
      issueId,
      this.kernel.issueFixIds,
    );
    if (!result) return false;
    this.kernel.discardRepeatableCommands();
    this.ports.commitDocumentCandidate({
      label: result.label,
      baseDocumentRevision: this.kernel.document.revision,
      before: this.kernel.document,
      after: result.document,
      selectionBefore: this.kernel.selection,
      selectionAfter: result.removesObjects ? null : this.kernel.selection,
      document: result.document,
    });
    return true;
  }

  public isBrushUnavailable(brushId: BrushId): boolean {
    const state = this.objectViewState;
    return (
      state.hiddenBrushIds.includes(brushId) ||
      state.lockedBrushIds.includes(brushId)
    );
  }

  public isEntityUnavailable(entityId: EntityId): boolean {
    const state = this.objectViewState;
    return (
      state.hiddenEntityIds.includes(entityId) ||
      state.lockedEntityIds.includes(entityId)
    );
  }

  public assertSelectionAvailable(selection: EditorSelection): void {
    const hiddenOrLockedBrush = selectedBrushIds(selection).find((brushId) =>
      this.isBrushUnavailable(brushId),
    );
    if (hiddenOrLockedBrush) {
      throw new Error(
        `Cannot select hidden or locked brush ${hiddenOrLockedBrush}`,
      );
    }
    const hiddenOrLockedEntity = selectedPointEntityIds(selection).find(
      (entityId) => this.isEntityUnavailable(entityId),
    );
    if (hiddenOrLockedEntity) {
      throw new Error(
        `Cannot select hidden or locked point entity ${hiddenOrLockedEntity}`,
      );
    }
  }

  public editableObjectIds(): {
    readonly brushIds: readonly BrushId[];
    readonly entityIds: readonly EntityId[];
  } {
    const editingGroup = this.kernel.editingGroupId
      ? deriveEditorGroups(this.kernel.document).find(
          (group) => group.id === this.kernel.editingGroupId,
        )
      : null;
    const groupBrushIds = editingGroup ? new Set(editingGroup.brushIds) : null;
    const groupEntityIds = editingGroup
      ? new Set(editingGroup.pointEntityIds)
      : null;
    return {
      brushIds: brushesInDocument(this.kernel.document)
        .map((brush) => brush.id)
        .filter(
          (brushId) =>
            (!groupBrushIds || groupBrushIds.has(brushId)) &&
            !this.isBrushUnavailable(brushId),
        ),
      entityIds: pointEntitiesInDocument(this.kernel.document)
        .map((entity) => entity.id)
        .filter(
          (entityId) =>
            (!groupEntityIds || groupEntityIds.has(entityId)) &&
            !this.isEntityUnavailable(entityId),
        ),
    };
  }

  public setObjectSelection(
    brushIds: readonly BrushId[],
    entityIds: readonly EntityId[],
    label: string,
  ): EditorSelection | null {
    const selection = createObjectSelection(brushIds, entityIds);
    this.kernel.discardRepeatableCommands();
    this.kernel.selection = selection;
    const count = brushIds.length + entityIds.length;
    this.kernel.notify(
      "selection",
      count > 0 ? `${label} (${count})` : "Clear selection",
    );
    return selection;
  }

  /** Selects every currently editable brush and point entity without changing document history. */
  public selectAllEditable(): EditorSelection | null {
    const editable = this.editableObjectIds();
    return this.setObjectSelection(
      editable.brushIds,
      editable.entityIds,
      "Select all objects",
    );
  }

  /** Inverts the current object selection within the visible, unlocked editing context. */
  public invertObjectSelection(): EditorSelection | null {
    const editable = this.editableObjectIds();
    const selectedBrushes = new Set(
      this.kernel.selection?.faceId
        ? []
        : selectedBrushIds(this.kernel.selection),
    );
    const selectedEntities = new Set(
      this.kernel.selection?.faceId
        ? []
        : selectedPointEntityIds(this.kernel.selection),
    );
    return this.setObjectSelection(
      editable.brushIds.filter((brushId) => !selectedBrushes.has(brushId)),
      editable.entityIds.filter((entityId) => !selectedEntities.has(entityId)),
      "Invert object selection",
    );
  }

  private expandSelectionQueryGroups(
    brushIds: readonly BrushId[],
    entityIds: readonly EntityId[],
  ): EditorSelection | null {
    const brushes = new Set<BrushId>();
    const entities = new Set<EntityId>();
    const expandedGroups = new Map<
      string,
      ReturnType<typeof editorGroupForObject>
    >();
    const addGroupOrObject = (selection: EditorSelection): void => {
      const group = editorGroupForObject(
        this.kernel.document,
        selection,
        this.kernel.editingGroupId,
      );
      if (!group) {
        for (const brushId of selectedBrushIds(selection)) brushes.add(brushId);
        for (const entityId of selectedPointEntityIds(selection))
          entities.add(entityId);
        return;
      }
      expandedGroups.set(group.id, group);
    };
    for (const brushId of brushIds) addGroupOrObject({ brushId });
    for (const entityId of entityIds) addGroupOrObject({ entityId });
    for (const group of expandedGroups.values()) {
      if (!group) continue;
      const unavailable =
        group.brushIds.some((brushId) => this.isBrushUnavailable(brushId)) ||
        group.pointEntityIds.some((entityId) =>
          this.isEntityUnavailable(entityId),
        );
      if (unavailable) continue;
      for (const brushId of group.brushIds) brushes.add(brushId);
      for (const entityId of group.pointEntityIds) entities.add(entityId);
    }
    if (expandedGroups.size === 1 && brushes.size + entities.size > 0) {
      const group = [...expandedGroups.values()][0];
      if (
        group &&
        group.brushIds.length === brushes.size &&
        group.pointEntityIds.length === entities.size
      ) {
        return selectionForEditorGroup(group);
      }
    }
    return createObjectSelection([...brushes], [...entities]);
  }

  /**
   * Consumes the selected structural brushes and selects editable objects touching or contained by
   * their convex volumes. The deletion and resulting selection are one reversible transaction.
   */
  public selectWithSelectionBrushes(
    mode: SelectionBrushQueryMode,
    projection?: SelectionBrushProjection,
  ): SelectionBrushSelectionResult | null {
    const selection = this.kernel.selection;
    if (!selection || selection.faceId || selection.groupId) return null;
    const selectionBrushIds = selectedBrushIds(selection);
    if (
      selectionBrushIds.length === 0 ||
      selectedPointEntityIds(selection).length > 0
    )
      return null;
    for (const brushId of selectionBrushIds) {
      const owner = this.kernel.document.entities.find((entity) =>
        entity.primitives.some((brush) => brush.id === brushId),
      );
      if (
        !owner ||
        (owner.properties.classname !== "worldspawn" &&
          !isEditorGroupEntity(owner) &&
          !isEditorLayerEntity(owner))
      ) {
        throw new Error("Selection brushes must be structural brushes");
      }
    }
    const editable = this.editableObjectIds();
    const queried = querySelectionBrushes(
      this.kernel.document,
      selectionBrushIds,
      {
        mode,
        ...(projection ? { projection } : {}),
        candidateBrushIds: editable.brushIds,
        candidateEntityIds: editable.entityIds,
      },
    );
    const selectionAfter = this.expandSelectionQueryGroups(
      queried.brushIds,
      queried.entityIds,
    );
    this.kernel.discardRepeatableCommands();
    const after = removeBrushes(this.kernel.document, selectionBrushIds);
    const selectedBrushCount = selectedBrushIds(selectionAfter).length;
    const selectedEntityCount = selectedPointEntityIds(selectionAfter).length;
    const modeLabel =
      mode === "touching"
        ? "Select touching objects"
        : mode === "inside"
          ? "Select enclosed objects"
          : "Select projected objects";
    this.ports.commitDocumentCandidate({
      label: modeLabel,
      baseDocumentRevision: this.kernel.document.revision,
      before: this.kernel.document,
      after,
      selectionBefore: selection,
      selectionAfter,
      document: after,
    });
    return {
      removedBrushCount: selectionBrushIds.length,
      selectedBrushCount,
      selectedEntityCount,
      selection: selectionAfter,
    };
  }

  public selectBrush(
    brushId: BrushId,
    additive = false,
  ): EditorSelection | null {
    if (!findBrush(this.kernel.document, brushId))
      throw new Error(`Unknown brush ${brushId}`);
    if (this.isBrushUnavailable(brushId)) {
      throw new Error(`Cannot select hidden or locked brush ${brushId}`);
    }
    this.kernel.discardRepeatableCommands();
    this.kernel.selection = updateBrushSelection(
      this.kernel.selection,
      brushId,
      additive,
    );
    const count = selectedBrushIds(this.kernel.selection).length;
    this.kernel.notify(
      "selection",
      this.kernel.selection
        ? count > 1
          ? `Select ${count} brushes`
          : "Select brush"
        : "Clear selection",
    );
    return this.kernel.selection;
  }

  public selectPointEntity(
    entityId: EntityId,
    additive = false,
  ): EditorSelection | null {
    if (
      !pointEntitiesInDocument(this.kernel.document).some(
        (entity) => entity.id === entityId,
      )
    ) {
      throw new Error(`Unknown point entity ${entityId}`);
    }
    if (this.isEntityUnavailable(entityId)) {
      throw new Error(
        `Cannot select hidden or locked point entity ${entityId}`,
      );
    }
    this.kernel.discardRepeatableCommands();
    this.kernel.selection = updatePointEntitySelection(
      this.kernel.selection,
      entityId,
      additive,
    );
    const count = selectedPointEntityIds(this.kernel.selection).length;
    this.kernel.notify(
      "selection",
      this.kernel.selection
        ? count > 1
          ? `Select ${count} entities`
          : "Select entity"
        : "Clear selection",
    );
    return this.kernel.selection;
  }

  public selectFace(
    face: FaceSelection,
    additive = false,
  ): BrushSelection | null {
    return this.selectFaces(
      [face],
      additive,
      additive ? "Toggle face selection" : "Select face",
    );
  }

  public selectBrushFaces(
    brushId: BrushId,
    additive = false,
    primaryFaceId?: FaceId,
  ): BrushSelection | null {
    return this.selectFaces(
      facesOfBrush(this.kernel.document, brushId),
      additive,
      additive ? "Add brush faces" : "Select brush faces",
      primaryFaceId ? { brushId, faceId: primaryFaceId } : null,
    );
  }

  public selectConnectedCoplanarFaces(
    seed: FaceSelection,
    additive = false,
  ): BrushSelection | null {
    return this.selectFaces(
      connectedCoplanarFaces(this.kernel.document, seed),
      additive,
      additive ? "Add coplanar faces" : "Select coplanar faces",
      seed,
    );
  }

  public selectMatchingBrushFaces(
    seed: FaceSelection,
    brushIds: readonly BrushId[],
    additive = false,
  ): BrushSelection | null {
    return this.selectFaces(
      matchingBrushFaces(this.kernel.document, seed, brushIds),
      additive,
      additive ? "Add matching faces" : "Select matching faces",
      seed,
    );
  }

  public selectFaces(
    faces: readonly FaceSelection[],
    additive = false,
    label = "Select faces",
    primary: FaceSelection | null = faces.at(-1) ?? null,
  ): BrushSelection | null {
    for (const face of faces) {
      if (this.isBrushUnavailable(face.brushId)) {
        throw new Error(
          `Cannot select a face on hidden or locked brush ${face.brushId}`,
        );
      }
      const brush = findBrush(this.kernel.document, face.brushId);
      if (!brush?.faces.some((candidate) => candidate.id === face.faceId)) {
        throw new Error(`Unknown face ${face.faceId} on brush ${face.brushId}`);
      }
    }
    this.kernel.discardRepeatableCommands();
    this.kernel.selection = updateFaceSelection(
      this.kernel.selection,
      faces,
      additive,
      primary,
    );
    this.kernel.notify(
      "selection",
      this.kernel.selection ? label : "Clear selection",
    );
    return this.kernel.selection;
  }

  public selectFacesWithLasso(
    faces: readonly FaceSelection[],
    ensureSelected = false,
  ): BrushSelection | null {
    if (faces.length === 0)
      return this.kernel.selection?.brushId ? this.kernel.selection : null;
    for (const face of faces) {
      const brush = findBrush(this.kernel.document, face.brushId);
      if (!brush?.faces.some((candidate) => candidate.id === face.faceId)) {
        throw new Error(`Unknown face ${face.faceId} on brush ${face.brushId}`);
      }
    }
    const selected = new Map(
      selectedFaceReferences(this.kernel.selection).map(
        (face) => [faceSelectionKey(face), face] as const,
      ),
    );
    for (const face of faces) {
      const faceKey = faceSelectionKey(face);
      if (ensureSelected) selected.set(faceKey, face);
      else if (selected.has(faceKey)) selected.delete(faceKey);
      else selected.set(faceKey, face);
    }
    const primary =
      faces.toReversed().find((face) => selected.has(faceSelectionKey(face))) ??
      null;
    this.kernel.discardRepeatableCommands();
    this.kernel.selection = createFaceSelection(
      [...selected.values()],
      primary,
    );
    const count = selected.size;
    this.kernel.notify(
      "selection",
      count === 0
        ? "Clear face lasso selection"
        : `Lasso selected ${count} ${count === 1 ? "face" : "faces"}`,
    );
    return this.kernel.selection;
  }
}
