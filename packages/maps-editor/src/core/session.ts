import type { EditorIssue } from "./issues.js";
import type { EditorLayerId } from "./layers.js";
import type {
  EditorViewFilterObjectIds,
  EditorViewFilterState,
} from "./view-filters.js";
import type {
  EditorObjectViewState,
  EditorSelection,
  MapDocument,
} from "./types.js";
import type { ChangeListener } from "./session-common.js";
import { SessionKernel } from "./session-kernel.js";
import {
  SessionOrganizationCommands,
  type SessionReplaySeed,
  type SessionReplayTarget,
} from "./session-organization.js";
import { SessionSelectionCommands } from "./session-selection.js";
import { SessionTransformCommands } from "./session-transforms.js";
import { SessionGeometryCommands } from "./session-geometry.js";
import { SessionEntityCommands } from "./session-entities.js";
import { SessionObjectCommands } from "./session-objects.js";
import { SessionClipboardCommands } from "./session-clipboard.js";
import { SessionMaterialCommands } from "./session-materials.js";
import { SessionCommitCommands } from "./session-commits.js";

type MethodKey<T> = {
  [K in keyof T]-?: T[K] extends (...args: never[]) => unknown ? K : never;
}[keyof T];

/** Command domains share one kernel and commit coordinator. */
export class EditorSession implements SessionReplayTarget {
  private readonly kernel: SessionKernel;
  private readonly organization: SessionOrganizationCommands;
  private readonly selections: SessionSelectionCommands;
  private readonly transforms: SessionTransformCommands;
  private readonly geometry: SessionGeometryCommands;
  private readonly entities: SessionEntityCommands;
  private readonly objects: SessionObjectCommands;
  private readonly clipboard: SessionClipboardCommands;
  private readonly materials: SessionMaterialCommands;
  private readonly commits: SessionCommitCommands;

  public readonly setEntityClassVisible: SessionOrganizationCommands["setEntityClassVisible"];
  public readonly setAllEntityClassesVisible: SessionOrganizationCommands["setAllEntityClassesVisible"];
  public readonly setWorldBrushesVisible: SessionOrganizationCommands["setWorldBrushesVisible"];
  public readonly setSpecialBrushFilterVisible: SessionOrganizationCommands["setSpecialBrushFilterVisible"];
  public readonly clearRepeatableCommands: SessionOrganizationCommands["clearRepeatableCommands"];
  public readonly repeatLastCommands: SessionOrganizationCommands["repeatLastCommands"];
  public readonly replaceDocument: SessionOrganizationCommands["replaceDocument"];
  public readonly restoreDocument: SessionOrganizationCommands["restoreDocument"];
  public readonly setEditingGroup: SessionOrganizationCommands["setEditingGroup"];
  public readonly setActiveLayer: SessionOrganizationCommands["setActiveLayer"];
  public readonly createLayer: SessionOrganizationCommands["createLayer"];
  public readonly renameLayer: SessionOrganizationCommands["renameLayer"];
  public readonly setLayerFlag: SessionOrganizationCommands["setLayerFlag"];
  public readonly setAllLayersFlag: SessionOrganizationCommands["setAllLayersFlag"];
  public readonly isolateLayer: SessionOrganizationCommands["isolateLayer"];
  public readonly reorderLayer: SessionOrganizationCommands["reorderLayer"];
  public readonly removeLayer: SessionOrganizationCommands["removeLayer"];
  public readonly moveSelectedToLayer: SessionOrganizationCommands["moveSelectedToLayer"];
  public readonly selectAllInLayer: SessionOrganizationCommands["selectAllInLayer"];

  public readonly groupSelected: SessionSelectionCommands["groupSelected"];
  public readonly linkedDuplicateSelected: SessionSelectionCommands["linkedDuplicateSelected"];
  public readonly unlinkGroup: SessionSelectionCommands["unlinkGroup"];
  public readonly ungroupSelected: SessionSelectionCommands["ungroupSelected"];
  public readonly renameGroup: SessionSelectionCommands["renameGroup"];
  public readonly addSelectedToGroup: SessionSelectionCommands["addSelectedToGroup"];
  public readonly hideSelected: SessionSelectionCommands["hideSelected"];
  public readonly isolateSelected: SessionSelectionCommands["isolateSelected"];
  public readonly showAll: SessionSelectionCommands["showAll"];
  public readonly lockSelected: SessionSelectionCommands["lockSelected"];
  public readonly unlockAll: SessionSelectionCommands["unlockAll"];
  public readonly select: SessionSelectionCommands["select"];
  public readonly selectIssue: SessionSelectionCommands["selectIssue"];
  public readonly fixIssue: SessionSelectionCommands["fixIssue"];
  public readonly selectAllEditable: SessionSelectionCommands["selectAllEditable"];
  public readonly invertObjectSelection: SessionSelectionCommands["invertObjectSelection"];
  public readonly selectWithSelectionBrushes: SessionSelectionCommands["selectWithSelectionBrushes"];
  public readonly selectBrush: SessionSelectionCommands["selectBrush"];
  public readonly selectPointEntity: SessionSelectionCommands["selectPointEntity"];
  public readonly selectFace: SessionSelectionCommands["selectFace"];
  public readonly selectBrushFaces: SessionSelectionCommands["selectBrushFaces"];
  public readonly selectConnectedCoplanarFaces: SessionSelectionCommands["selectConnectedCoplanarFaces"];
  public readonly selectMatchingBrushFaces: SessionSelectionCommands["selectMatchingBrushFaces"];
  public readonly selectFaces: SessionSelectionCommands["selectFaces"];
  public readonly selectFacesWithLasso: SessionSelectionCommands["selectFacesWithLasso"];

  public readonly snapSelectionToGrid: SessionTransformCommands["snapSelectionToGrid"];
  public readonly translateSelected: SessionTransformCommands["translateSelected"];
  public readonly translate: SessionTransformCommands["translate"];
  public readonly createTranslationCandidate: SessionTransformCommands["createTranslationCandidate"];
  public readonly createBrushSetTranslationCandidate: SessionTransformCommands["createBrushSetTranslationCandidate"];
  public readonly createObjectTranslationCandidate: SessionTransformCommands["createObjectTranslationCandidate"];
  public readonly rotateSelected: SessionTransformCommands["rotateSelected"];
  public readonly createObjectRotationCandidate: SessionTransformCommands["createObjectRotationCandidate"];
  public readonly flipSelected: SessionTransformCommands["flipSelected"];
  public readonly createObjectFlipCandidate: SessionTransformCommands["createObjectFlipCandidate"];
  public readonly createRotationCandidate: SessionTransformCommands["createRotationCandidate"];
  public readonly createBrushSetRotationCandidate: SessionTransformCommands["createBrushSetRotationCandidate"];
  public readonly scaleSelected: SessionTransformCommands["scaleSelected"];
  public readonly createObjectScaleCandidate: SessionTransformCommands["createObjectScaleCandidate"];
  public readonly createScaleCandidate: SessionTransformCommands["createScaleCandidate"];
  public readonly createBrushSetScaleCandidate: SessionTransformCommands["createBrushSetScaleCandidate"];
  public readonly shearSelected: SessionTransformCommands["shearSelected"];
  public readonly createObjectShearCandidate: SessionTransformCommands["createObjectShearCandidate"];
  public readonly createShearCandidate: SessionTransformCommands["createShearCandidate"];
  public readonly createBrushSetShearCandidate: SessionTransformCommands["createBrushSetShearCandidate"];
  public readonly createBrushSetVertexRotationCandidate: SessionTransformCommands["createBrushSetVertexRotationCandidate"];
  public readonly createBrushSetVertexScaleCandidate: SessionTransformCommands["createBrushSetVertexScaleCandidate"];
  public readonly createBrushSetVertexShearCandidate: SessionTransformCommands["createBrushSetVertexShearCandidate"];
  public readonly moveSelectedVertices: SessionTransformCommands["moveSelectedVertices"];
  public readonly createVertexMoveCandidate: SessionTransformCommands["createVertexMoveCandidate"];
  public readonly createBrushSetVertexMoveCandidate: SessionTransformCommands["createBrushSetVertexMoveCandidate"];
  public readonly createVertexSnapCandidate: SessionTransformCommands["createVertexSnapCandidate"];
  public readonly createFaceSetTranslationCandidate: SessionTransformCommands["createFaceSetTranslationCandidate"];
  public readonly createVertexInsertionCandidate: SessionTransformCommands["createVertexInsertionCandidate"];
  public readonly deleteSelectedVertices: SessionTransformCommands["deleteSelectedVertices"];
  public readonly createVertexDeletionCandidate: SessionTransformCommands["createVertexDeletionCandidate"];
  public readonly createBrushSetVertexDeletionCandidate: SessionTransformCommands["createBrushSetVertexDeletionCandidate"];

  public readonly extrudeSelectedFace: SessionGeometryCommands["extrudeSelectedFace"];
  public readonly createFaceExtrusionCandidate: SessionGeometryCommands["createFaceExtrusionCandidate"];
  public readonly createFaceSetExtrusionCandidate: SessionGeometryCommands["createFaceSetExtrusionCandidate"];
  public readonly splitSelectedFace: SessionGeometryCommands["splitSelectedFace"];
  public readonly createFaceSetSplitCandidate: SessionGeometryCommands["createFaceSetSplitCandidate"];
  public readonly createFaceStampCandidate: SessionGeometryCommands["createFaceStampCandidate"];
  public readonly stampSelectedFace: SessionGeometryCommands["stampSelectedFace"];
  public readonly createBrush: SessionGeometryCommands["createBrush"];
  public readonly createClipCandidate: SessionGeometryCommands["createClipCandidate"];
  public readonly createBrushSetClipCandidate: SessionGeometryCommands["createBrushSetClipCandidate"];
  public readonly commitClipCandidate: SessionGeometryCommands["commitClipCandidate"];
  public readonly commitSequenceCandidate: SessionGeometryCommands["commitSequenceCandidate"];
  public readonly csgConvexMergeSelected: SessionGeometryCommands["csgConvexMergeSelected"];
  public readonly csgIntersectSelected: SessionGeometryCommands["csgIntersectSelected"];
  public readonly csgSubtractSelected: SessionGeometryCommands["csgSubtractSelected"];
  public readonly csgHollowSelected: SessionGeometryCommands["csgHollowSelected"];

  public readonly createPointEntity: SessionEntityCommands["createPointEntity"];
  public readonly createBrushEntity: SessionEntityCommands["createBrushEntity"];
  public readonly moveSelectedBrushesToEntity: SessionEntityCommands["moveSelectedBrushesToEntity"];
  public readonly makeSelectedStructural: SessionEntityCommands["makeSelectedStructural"];

  public readonly createBrushCandidate: SessionObjectCommands["createBrushCandidate"];
  public readonly createBrushesCandidate: SessionObjectCommands["createBrushesCandidate"];
  public readonly createSweepCandidate: SessionObjectCommands["createSweepCandidate"];
  public readonly sweepFaces: SessionObjectCommands["sweepFaces"];
  public readonly createDuplicationCandidate: SessionObjectCommands["createDuplicationCandidate"];
  public readonly createObjectDuplicationCandidate: SessionObjectCommands["createObjectDuplicationCandidate"];
  public readonly translateObjectDuplicationCandidate: SessionObjectCommands["translateObjectDuplicationCandidate"];
  public readonly translateBatchCreationCandidate: SessionObjectCommands["translateBatchCreationCandidate"];
  public readonly duplicateSelected: SessionObjectCommands["duplicateSelected"];
  public readonly createPasteCandidate: SessionClipboardCommands["createPasteCandidate"];
  public readonly pasteObjects: SessionClipboardCommands["pasteObjects"];
  public readonly deleteSelected: SessionObjectCommands["deleteSelected"];
  public readonly deleteBrush: SessionObjectCommands["deleteBrush"];
  public readonly setEntityProperty: SessionObjectCommands["setEntityProperty"];
  public readonly setEntityPropertyProtected: SessionObjectCommands["setEntityPropertyProtected"];
  public readonly applyMaterial: SessionObjectCommands["applyMaterial"];
  public readonly selectFacesUsingMaterial: SessionObjectCommands["selectFacesUsingMaterial"];
  public readonly selectBrushesUsingMaterial: SessionObjectCommands["selectBrushesUsingMaterial"];
  public readonly createMaterialReplacementCandidate: SessionObjectCommands["createMaterialReplacementCandidate"];
  public readonly replaceMaterial: SessionObjectCommands["replaceMaterial"];

  public readonly applyRemoteCollaborationOperation: SessionCommitCommands["applyRemoteCollaborationOperation"];
  public readonly setSelectedSurfaceFlag: SessionMaterialCommands["setSelectedSurfaceFlag"];
  public readonly setSelectedSurfaceValue: SessionMaterialCommands["setSelectedSurfaceValue"];
  public readonly createMaterialCandidate: SessionMaterialCommands["createMaterialCandidate"];
  public readonly applyTextureTransform: SessionMaterialCommands["applyTextureTransform"];
  public readonly setSelectedTextureProjectionField: SessionMaterialCommands["setSelectedTextureProjectionField"];
  public readonly alignTexture: SessionMaterialCommands["alignTexture"];
  public readonly createTextureAlignmentCandidate: SessionMaterialCommands["createTextureAlignmentCandidate"];
  public readonly transferFaceAttributes: SessionMaterialCommands["transferFaceAttributes"];
  public readonly pasteFaceAttributes: SessionMaterialCommands["pasteFaceAttributes"];
  public readonly createFaceAttributePasteCandidate: SessionMaterialCommands["createFaceAttributePasteCandidate"];
  public readonly createFaceAttributeTransferCandidate: SessionMaterialCommands["createFaceAttributeTransferCandidate"];
  public readonly createTextureTransformCandidate: SessionMaterialCommands["createTextureTransformCandidate"];
  public readonly createTextureTransformDeltaCandidate: SessionMaterialCommands["createTextureTransformDeltaCandidate"];
  public readonly commitCandidate: SessionCommitCommands["commitCandidate"];
  public readonly commitCreationCandidate: SessionCommitCommands["commitCreationCandidate"];
  public readonly commitBatchCreationCandidate: SessionCommitCommands["commitBatchCreationCandidate"];
  public readonly commitDocumentCandidate: SessionCommitCommands["commitDocumentCandidate"];
  public readonly undo: SessionCommitCommands["undo"];
  public readonly redo: SessionCommitCommands["redo"];

  public constructor(document: MapDocument) {
    this.kernel = new SessionKernel(document);

    this.organization = new SessionOrganizationCommands(this.kernel, {
      select: (selection) => this.selections.select(selection),
      commitDocumentCandidate: (candidate) =>
        this.commits.commitDocumentCandidate(candidate),
      createReplayTarget: (replayDocument, seed) => {
        const replay = new EditorSession(replayDocument);
        replay.seedReplay(seed);
        return replay;
      },
    });
    this.selections = new SessionSelectionCommands(this.kernel, {
      objectViewState: () => this.organization.objectViewState,
      commitDocumentCandidate: (candidate) =>
        this.commits.commitDocumentCandidate(candidate),
      commitObjectViewState: (label, state, selectionAfter) =>
        this.commits.commitObjectViewState(label, state, selectionAfter),
    });
    this.transforms = new SessionTransformCommands(this.kernel, {
      commitCandidate: (candidate) => this.commits.commitCandidate(candidate),
      commitDocumentCandidate: (candidate) =>
        this.commits.commitDocumentCandidate(candidate),
    });
    this.geometry = new SessionGeometryCommands(this.kernel, {
      commitCandidate: (candidate) => this.commits.commitCandidate(candidate),
      commitDocumentCandidate: (candidate) =>
        this.commits.commitDocumentCandidate(candidate),
      commitCreationCandidate: (candidate) =>
        this.commits.commitCreationCandidate(candidate),
      commitBatchCreationCandidate: (candidate) =>
        this.commits.commitBatchCreationCandidate(candidate),
      createBrushCandidate: (brush, entityId) =>
        this.objects.createBrushCandidate(brush, entityId),
      commitMutation: (mutation) => this.commits.commitMutation(mutation),
      hasLinkedEditingGroup: (candidateDocument) =>
        this.organization.hasLinkedEditingGroup(candidateDocument),
      isBrushUnavailable: (brushId) =>
        this.selections.isBrushUnavailable(brushId),
    });
    this.entities = new SessionEntityCommands(this.kernel, {
      commitDocumentCandidate: (candidate) =>
        this.commits.commitDocumentCandidate(candidate),
    });
    this.materials = new SessionMaterialCommands(this.kernel, {
      commitCandidate: (candidate) => this.commits.commitCandidate(candidate),
    });
    this.clipboard = new SessionClipboardCommands(this.kernel, {
      commitDocumentCandidate: (candidate) =>
        this.commits.commitDocumentCandidate(candidate),
    });
    this.objects = new SessionObjectCommands(this.kernel, {
      activeLayerEntity: (candidateDocument) =>
        this.organization.activeLayerEntity(candidateDocument),
      commitCandidate: (candidate) => this.commits.commitCandidate(candidate),
      commitDocumentCandidate: (candidate) =>
        this.commits.commitDocumentCandidate(candidate),
      commitBatchCreationCandidate: (candidate) =>
        this.commits.commitBatchCreationCandidate(candidate),
      commitMutation: (mutation) => this.commits.commitMutation(mutation),
      createMaterialCandidate: (material, selection) =>
        this.materials.createMaterialCandidate(material, selection),
      createPasteCandidate: (
        clipboard,
        ids,
        delta,
        textureLock,
        targetGroupId,
        targetLayerId,
      ) =>
        this.clipboard.createPasteCandidate(
          clipboard,
          ids,
          delta,
          textureLock,
          targetGroupId,
          targetLayerId,
        ),
      hasLinkedEditingGroup: (candidateDocument) =>
        this.organization.hasLinkedEditingGroup(candidateDocument),
      editableObjectIds: () => this.selections.editableObjectIds(),
      setObjectSelection: (brushIds, entityIds, label) =>
        this.selections.setObjectSelection(brushIds, entityIds, label),
      setSelection: (selection, label) =>
        this.selections.setSelection(selection, label),
    });
    this.commits = new SessionCommitCommands(this.kernel, {
      hasLinkedEditingGroup: (candidateDocument) =>
        this.organization.hasLinkedEditingGroup(candidateDocument),
      synchronizeEditingGroup: (candidateDocument) =>
        this.organization.synchronizeEditingGroup(candidateDocument),
    });

    this.setEntityClassVisible = this.bind(
      this.organization,
      "setEntityClassVisible",
    );
    this.setAllEntityClassesVisible = this.bind(
      this.organization,
      "setAllEntityClassesVisible",
    );
    this.setWorldBrushesVisible = this.bind(
      this.organization,
      "setWorldBrushesVisible",
    );
    this.setSpecialBrushFilterVisible = this.bind(
      this.organization,
      "setSpecialBrushFilterVisible",
    );
    this.clearRepeatableCommands = this.bind(
      this.organization,
      "clearRepeatableCommands",
    );
    this.repeatLastCommands = this.bind(
      this.organization,
      "repeatLastCommands",
    );
    this.replaceDocument = this.bind(this.organization, "replaceDocument");
    this.restoreDocument = this.bind(this.organization, "restoreDocument");
    this.setEditingGroup = this.bind(this.organization, "setEditingGroup");
    this.setActiveLayer = this.bind(this.organization, "setActiveLayer");
    this.createLayer = this.bind(this.organization, "createLayer");
    this.renameLayer = this.bind(this.organization, "renameLayer");
    this.setLayerFlag = this.bind(this.organization, "setLayerFlag");
    this.setAllLayersFlag = this.bind(this.organization, "setAllLayersFlag");
    this.isolateLayer = this.bind(this.organization, "isolateLayer");
    this.reorderLayer = this.bind(this.organization, "reorderLayer");
    this.removeLayer = this.bind(this.organization, "removeLayer");
    this.moveSelectedToLayer = this.bind(
      this.organization,
      "moveSelectedToLayer",
    );
    this.selectAllInLayer = this.bind(this.organization, "selectAllInLayer");

    this.groupSelected = this.bind(this.selections, "groupSelected");
    this.linkedDuplicateSelected = this.bind(
      this.selections,
      "linkedDuplicateSelected",
    );
    this.unlinkGroup = this.bind(this.selections, "unlinkGroup");
    this.ungroupSelected = this.bind(this.selections, "ungroupSelected");
    this.renameGroup = this.bind(this.selections, "renameGroup");
    this.addSelectedToGroup = this.bind(this.selections, "addSelectedToGroup");
    this.hideSelected = this.bind(this.selections, "hideSelected");
    this.isolateSelected = this.bind(this.selections, "isolateSelected");
    this.showAll = this.bind(this.selections, "showAll");
    this.lockSelected = this.bind(this.selections, "lockSelected");
    this.unlockAll = this.bind(this.selections, "unlockAll");
    this.select = this.bind(this.selections, "select");
    this.selectIssue = this.bind(this.selections, "selectIssue");
    this.fixIssue = this.bind(this.selections, "fixIssue");
    this.selectAllEditable = this.bind(this.selections, "selectAllEditable");
    this.invertObjectSelection = this.bind(
      this.selections,
      "invertObjectSelection",
    );
    this.selectWithSelectionBrushes = this.bind(
      this.selections,
      "selectWithSelectionBrushes",
    );
    this.selectBrush = this.bind(this.selections, "selectBrush");
    this.selectPointEntity = this.bind(this.selections, "selectPointEntity");
    this.selectFace = this.bind(this.selections, "selectFace");
    this.selectBrushFaces = this.bind(this.selections, "selectBrushFaces");
    this.selectConnectedCoplanarFaces = this.bind(
      this.selections,
      "selectConnectedCoplanarFaces",
    );
    this.selectMatchingBrushFaces = this.bind(
      this.selections,
      "selectMatchingBrushFaces",
    );
    this.selectFaces = this.bind(this.selections, "selectFaces");
    this.selectFacesWithLasso = this.bind(
      this.selections,
      "selectFacesWithLasso",
    );

    this.snapSelectionToGrid = this.bind(
      this.transforms,
      "snapSelectionToGrid",
    );
    this.translateSelected = this.bind(this.transforms, "translateSelected");
    this.translate = this.bind(this.transforms, "translate");
    this.createTranslationCandidate = this.bind(
      this.transforms,
      "createTranslationCandidate",
    );
    this.createBrushSetTranslationCandidate = this.bind(
      this.transforms,
      "createBrushSetTranslationCandidate",
    );
    this.createObjectTranslationCandidate = this.bind(
      this.transforms,
      "createObjectTranslationCandidate",
    );
    this.rotateSelected = this.bind(this.transforms, "rotateSelected");
    this.createObjectRotationCandidate = this.bind(
      this.transforms,
      "createObjectRotationCandidate",
    );
    this.flipSelected = this.bind(this.transforms, "flipSelected");
    this.createObjectFlipCandidate = this.bind(
      this.transforms,
      "createObjectFlipCandidate",
    );
    this.createRotationCandidate = this.bind(
      this.transforms,
      "createRotationCandidate",
    );
    this.createBrushSetRotationCandidate = this.bind(
      this.transforms,
      "createBrushSetRotationCandidate",
    );
    this.scaleSelected = this.bind(this.transforms, "scaleSelected");
    this.createObjectScaleCandidate = this.bind(
      this.transforms,
      "createObjectScaleCandidate",
    );
    this.createScaleCandidate = this.bind(
      this.transforms,
      "createScaleCandidate",
    );
    this.createBrushSetScaleCandidate = this.bind(
      this.transforms,
      "createBrushSetScaleCandidate",
    );
    this.shearSelected = this.bind(this.transforms, "shearSelected");
    this.createObjectShearCandidate = this.bind(
      this.transforms,
      "createObjectShearCandidate",
    );
    this.createShearCandidate = this.bind(
      this.transforms,
      "createShearCandidate",
    );
    this.createBrushSetShearCandidate = this.bind(
      this.transforms,
      "createBrushSetShearCandidate",
    );
    this.createBrushSetVertexRotationCandidate = this.bind(
      this.transforms,
      "createBrushSetVertexRotationCandidate",
    );
    this.createBrushSetVertexScaleCandidate = this.bind(
      this.transforms,
      "createBrushSetVertexScaleCandidate",
    );
    this.createBrushSetVertexShearCandidate = this.bind(
      this.transforms,
      "createBrushSetVertexShearCandidate",
    );
    this.moveSelectedVertices = this.bind(
      this.transforms,
      "moveSelectedVertices",
    );
    this.createVertexMoveCandidate = this.bind(
      this.transforms,
      "createVertexMoveCandidate",
    );
    this.createBrushSetVertexMoveCandidate = this.bind(
      this.transforms,
      "createBrushSetVertexMoveCandidate",
    );
    this.createVertexSnapCandidate = this.bind(
      this.transforms,
      "createVertexSnapCandidate",
    );
    this.createFaceSetTranslationCandidate = this.bind(
      this.transforms,
      "createFaceSetTranslationCandidate",
    );
    this.createVertexInsertionCandidate = this.bind(
      this.transforms,
      "createVertexInsertionCandidate",
    );
    this.deleteSelectedVertices = this.bind(
      this.transforms,
      "deleteSelectedVertices",
    );
    this.createVertexDeletionCandidate = this.bind(
      this.transforms,
      "createVertexDeletionCandidate",
    );
    this.createBrushSetVertexDeletionCandidate = this.bind(
      this.transforms,
      "createBrushSetVertexDeletionCandidate",
    );

    this.extrudeSelectedFace = this.bind(this.geometry, "extrudeSelectedFace");
    this.createFaceExtrusionCandidate = this.bind(
      this.geometry,
      "createFaceExtrusionCandidate",
    );
    this.createFaceSetExtrusionCandidate = this.bind(
      this.geometry,
      "createFaceSetExtrusionCandidate",
    );
    this.splitSelectedFace = this.bind(this.geometry, "splitSelectedFace");
    this.createFaceSetSplitCandidate = this.bind(
      this.geometry,
      "createFaceSetSplitCandidate",
    );
    this.createFaceStampCandidate = this.bind(
      this.geometry,
      "createFaceStampCandidate",
    );
    this.stampSelectedFace = this.bind(this.geometry, "stampSelectedFace");
    this.createBrush = this.bind(this.geometry, "createBrush");
    this.createClipCandidate = this.bind(this.geometry, "createClipCandidate");
    this.createBrushSetClipCandidate = this.bind(
      this.geometry,
      "createBrushSetClipCandidate",
    );
    this.commitClipCandidate = this.bind(this.geometry, "commitClipCandidate");
    this.commitSequenceCandidate = this.bind(
      this.geometry,
      "commitSequenceCandidate",
    );
    this.csgConvexMergeSelected = this.bind(
      this.geometry,
      "csgConvexMergeSelected",
    );
    this.csgIntersectSelected = this.bind(
      this.geometry,
      "csgIntersectSelected",
    );
    this.csgSubtractSelected = this.bind(this.geometry, "csgSubtractSelected");
    this.csgHollowSelected = this.bind(this.geometry, "csgHollowSelected");

    this.createBrushCandidate = this.bind(this.objects, "createBrushCandidate");
    this.createBrushesCandidate = this.bind(
      this.objects,
      "createBrushesCandidate",
    );
    this.createSweepCandidate = this.bind(this.objects, "createSweepCandidate");
    this.sweepFaces = this.bind(this.objects, "sweepFaces");
    this.createDuplicationCandidate = this.bind(
      this.objects,
      "createDuplicationCandidate",
    );
    this.createObjectDuplicationCandidate = this.bind(
      this.objects,
      "createObjectDuplicationCandidate",
    );
    this.translateObjectDuplicationCandidate = this.bind(
      this.objects,
      "translateObjectDuplicationCandidate",
    );
    this.translateBatchCreationCandidate = this.bind(
      this.objects,
      "translateBatchCreationCandidate",
    );
    this.duplicateSelected = this.bind(this.objects, "duplicateSelected");
    this.createPasteCandidate = this.bind(
      this.clipboard,
      "createPasteCandidate",
    );
    this.pasteObjects = this.bind(this.clipboard, "pasteObjects");
    this.deleteSelected = this.bind(this.objects, "deleteSelected");
    this.deleteBrush = this.bind(this.objects, "deleteBrush");
    this.setEntityProperty = this.bind(this.objects, "setEntityProperty");
    this.setEntityPropertyProtected = this.bind(
      this.objects,
      "setEntityPropertyProtected",
    );
    this.applyMaterial = this.bind(this.objects, "applyMaterial");
    this.selectFacesUsingMaterial = this.bind(
      this.objects,
      "selectFacesUsingMaterial",
    );
    this.selectBrushesUsingMaterial = this.bind(
      this.objects,
      "selectBrushesUsingMaterial",
    );
    this.createMaterialReplacementCandidate = this.bind(
      this.objects,
      "createMaterialReplacementCandidate",
    );
    this.replaceMaterial = this.bind(this.objects, "replaceMaterial");

    this.applyRemoteCollaborationOperation = this.bind(
      this.commits,
      "applyRemoteCollaborationOperation",
    );
    this.setSelectedSurfaceFlag = this.bind(
      this.materials,
      "setSelectedSurfaceFlag",
    );
    this.setSelectedSurfaceValue = this.bind(
      this.materials,
      "setSelectedSurfaceValue",
    );
    this.createMaterialCandidate = this.bind(
      this.materials,
      "createMaterialCandidate",
    );
    this.applyTextureTransform = this.bind(
      this.materials,
      "applyTextureTransform",
    );
    this.setSelectedTextureProjectionField = this.bind(
      this.materials,
      "setSelectedTextureProjectionField",
    );
    this.alignTexture = this.bind(this.materials, "alignTexture");
    this.createTextureAlignmentCandidate = this.bind(
      this.materials,
      "createTextureAlignmentCandidate",
    );
    this.transferFaceAttributes = this.bind(
      this.materials,
      "transferFaceAttributes",
    );
    this.pasteFaceAttributes = this.bind(this.materials, "pasteFaceAttributes");
    this.createFaceAttributePasteCandidate = this.bind(
      this.materials,
      "createFaceAttributePasteCandidate",
    );
    this.createFaceAttributeTransferCandidate = this.bind(
      this.materials,
      "createFaceAttributeTransferCandidate",
    );
    this.createTextureTransformCandidate = this.bind(
      this.materials,
      "createTextureTransformCandidate",
    );
    this.createTextureTransformDeltaCandidate = this.bind(
      this.materials,
      "createTextureTransformDeltaCandidate",
    );
    this.commitCandidate = this.bind(this.commits, "commitCandidate");
    this.commitCreationCandidate = this.bind(
      this.commits,
      "commitCreationCandidate",
    );
    this.commitBatchCreationCandidate = this.bind(
      this.commits,
      "commitBatchCreationCandidate",
    );
    this.commitDocumentCandidate = this.bind(
      this.commits,
      "commitDocumentCandidate",
    );
    this.undo = this.bind(this.commits, "undo");
    this.redo = this.bind(this.commits, "redo");

    this.createPointEntity = this.bind(this.entities, "createPointEntity");
    this.createBrushEntity = this.bind(this.entities, "createBrushEntity");
    this.moveSelectedBrushesToEntity = this.bind(
      this.entities,
      "moveSelectedBrushesToEntity",
    );
    this.makeSelectedStructural = this.bind(
      this.entities,
      "makeSelectedStructural",
    );
  }

  public get document(): MapDocument {
    return this.kernel.document;
  }

  public get selection(): EditorSelection | null {
    return this.kernel.selection;
  }

  public get issues(): readonly EditorIssue[] {
    return this.organization.issues;
  }

  public get objectViewState(): EditorObjectViewState {
    return this.organization.objectViewState;
  }

  public objectViewStateFor(document: MapDocument): EditorObjectViewState {
    return this.organization.objectViewStateFor(document);
  }

  public get viewFilters(): EditorViewFilterState {
    return this.organization.viewFilters;
  }

  public get filteredObjectIds(): EditorViewFilterObjectIds {
    return this.organization.filteredObjectIds;
  }

  public get canShowAll(): boolean {
    return this.organization.canShowAll;
  }

  public get canUnlockAll(): boolean {
    return this.organization.canUnlockAll;
  }

  public get canUndo(): boolean {
    return this.organization.canUndo;
  }

  public get canRedo(): boolean {
    return this.organization.canRedo;
  }

  public get undoLabel(): string | null {
    return this.organization.undoLabel;
  }

  public get redoLabel(): string | null {
    return this.organization.redoLabel;
  }

  public get canRepeatCommands(): boolean {
    return this.organization.canRepeatCommands;
  }

  public get repeatCommandCount(): number {
    return this.organization.repeatCommandCount;
  }

  public get repeatCommandLabels(): readonly string[] {
    return this.organization.repeatCommandLabels;
  }

  public get editingGroup(): string | null {
    return this.organization.editingGroup;
  }

  public get activeLayerId(): EditorLayerId {
    return this.organization.activeLayerId;
  }

  public subscribe(listener: ChangeListener): () => void {
    return this.kernel.subscribe(listener);
  }

  private bind<T extends object, K extends MethodKey<T>>(
    domain: T,
    key: K,
  ): T[K] {
    const command = domain[key];
    if (typeof command !== "function")
      throw new Error(`Session command ${String(key)} is missing`);
    return command.bind(domain) as T[K];
  }

  private seedReplay(seed: SessionReplaySeed): void {
    this.kernel.selection = seed.selection;
    this.kernel.layerId = seed.activeLayerId;
    this.kernel.editingGroupId = seed.editingGroupId;
    this.kernel.suppressRepeatRecording = true;
  }
}

export type { FaceTextureProjectionField } from "./session-materials.js";
export type {
  BrushBatchClipCandidate,
  BrushBatchCreationCandidate,
  BrushBatchEditCandidate,
  BrushClipCandidate,
  BrushClipEdit,
  BrushClipMode,
  BrushCreationCandidate,
  BrushEdit,
  BrushEditCandidate,
  BrushSequenceCandidate,
  DocumentEditCandidate,
  EditorRepeatableCommand,
  EditorSessionChange,
  SelectionBrushSelectionResult,
  SweepCandidate,
} from "./session-common.js";
