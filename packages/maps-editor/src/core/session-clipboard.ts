import { cloneBrush, insertBrushes, insertEntity } from "./document.js";
import { deriveBrush } from "./geometry.js";
import {
  deriveEditorGroups,
  isEditorGroupEntity,
  selectedEditorGroup,
} from "./groups.js";
import {
  normalizeSingleLinkedGroups,
  transformEditorGroupMetadata,
  translationAffineMatrix,
} from "./linked-groups.js";
import {
  deriveEditorLayers,
  findEditorLayer,
  isEditorLayerEntity,
  type EditorLayerId,
} from "./layers.js";
import { formatEntityOrigin, parseEntityOrigin } from "./point-entities.js";
import { createObjectSelection } from "./selection.js";
import type {
  BrushId,
  EntityId,
  IdFactory,
  MapDocument,
  MapEntity,
  Vec3,
} from "./types.js";
import { brushesInDocument } from "./types.js";
import type { DocumentEditCandidate } from "./session-common.js";
import type { SessionKernel } from "./session-kernel.js";

type SessionClipboardKernel = Readonly<
  Pick<SessionKernel, "document" | "layerId" | "selection">
>;

export interface SessionClipboardPorts {
  readonly commitDocumentCandidate: (candidate: DocumentEditCandidate) => void;
}

export class SessionClipboardCommands {
  public constructor(
    private readonly kernel: SessionClipboardKernel,
    private readonly ports: SessionClipboardPorts,
  ) {}

  /** Clones every object in a parseable clipboard map with fresh IDs as one document transaction. */
  public createPasteCandidate(
    clipboard: MapDocument,
    ids: IdFactory,
    delta: Vec3 = [0, 0, 0],
    textureLock = true,
    targetGroupId: string | null = null,
    targetLayerId: EditorLayerId = this.kernel.layerId,
  ): DocumentEditCandidate | null {
    if (!delta.every(Number.isFinite))
      throw new Error("Clipboard translation must be finite");
    const sourceWorldspawn = clipboard.entities.find(
      (entity) => entity.properties.classname?.toLowerCase() === "worldspawn",
    );
    if (!sourceWorldspawn)
      throw new Error("Clipboard map has no worldspawn entity");
    const destinationWorldspawn = this.kernel.document.entities.find(
      (entity) => entity.properties.classname?.toLowerCase() === "worldspawn",
    );
    if (!destinationWorldspawn)
      throw new Error("The map has no worldspawn entity");
    const destinationGroup = targetGroupId
      ? deriveEditorGroups(this.kernel.document).find(
          (group) => group.id === targetGroupId,
        )
      : null;
    if (targetGroupId && !destinationGroup)
      throw new Error(`Unknown group ${targetGroupId}`);
    const destinationLayer = targetGroupId
      ? null
      : findEditorLayer(this.kernel.document, targetLayerId);
    if (!targetGroupId && !destinationLayer) {
      throw new Error(
        targetLayerId === null
          ? "Default Layer is missing"
          : `Unknown layer ${targetLayerId}`,
      );
    }
    const destinationBrushEntity = destinationGroup
      ? this.kernel.document.entities.find(
          (entity) => entity.id === destinationGroup.entityId,
        )!
      : destinationLayer?.id
        ? this.kernel.document.entities.find(
            (entity) => entity.id === destinationLayer.entityId,
          )!
        : destinationWorldspawn;
    const pointEntities = clipboard.entities.filter(
      (entity) =>
        entity.id !== sourceWorldspawn.id &&
        entity.primitives.length === 0 &&
        !isEditorGroupEntity(entity) &&
        !isEditorLayerEntity(entity),
    );
    const existingNumericGroupIds = [
      ...deriveEditorGroups(this.kernel.document).map((group) => group.id),
      ...deriveEditorLayers(this.kernel.document).flatMap((layer) =>
        layer.id ? [layer.id] : [],
      ),
    ]
      .map((id) => Number.parseInt(id, 10))
      .filter(Number.isFinite);
    let nextGroupId =
      (existingNumericGroupIds.length > 0
        ? Math.max(...existingNumericGroupIds)
        : 0) + 1;
    const groupIdMap = new Map(
      deriveEditorGroups(clipboard).map(
        (group) => [group.id, String(nextGroupId++)] as const,
      ),
    );
    const clipboardBrushes = brushesInDocument(clipboard);
    for (const brush of clipboardBrushes) {
      const derived = deriveBrush(brush);
      if (!derived.valid) {
        throw new Error(
          `Clipboard brush ${brush.id} is invalid: ${derived.diagnostics
            .map((diagnostic) => diagnostic.message)
            .join("; ")}`,
        );
      }
    }
    const brushCount = clipboardBrushes.length;
    if (brushCount + pointEntities.length === 0) return null;
    if (brushCount + pointEntities.length > 1024) {
      throw new Error("A clipboard may contain at most 1024 objects");
    }

    const pastedBrushIds: BrushId[] = [];
    const pastedEntityIds: EntityId[] = [];
    const worldBrushes = [
      ...sourceWorldspawn.primitives,
      ...clipboard.entities
        .filter(isEditorLayerEntity)
        .flatMap((entity) => entity.primitives),
    ]
      .filter((primitive) => primitive.kind === "brush")
      .map((brush) => {
        const clone = cloneBrush(brush, ids, delta, textureLock);
        pastedBrushIds.push(clone.id);
        return clone;
      });
    let after = insertBrushes(
      this.kernel.document,
      worldBrushes.map((brush, index) => ({
        entityId: destinationBrushEntity.id,
        insertionIndex: destinationBrushEntity.primitives.length + index,
        brush,
      })),
    );
    for (const sourceEntity of clipboard.entities) {
      if (sourceEntity.id === sourceWorldspawn.id) continue;
      if (isEditorLayerEntity(sourceEntity)) continue;
      const properties = { ...sourceEntity.properties };
      if (isEditorGroupEntity(sourceEntity)) {
        const mappedId = groupIdMap.get(properties["_tb_id"] ?? "");
        if (!mappedId)
          throw new Error(
            `Clipboard group ${sourceEntity.id} has no persistent ID`,
          );
        properties["_tb_id"] = mappedId;
      }
      if (properties["_tb_group"]) {
        const mappedParent = groupIdMap.get(properties["_tb_group"]);
        if (mappedParent) properties["_tb_group"] = mappedParent;
        else if (targetGroupId) properties["_tb_group"] = targetGroupId;
        else delete properties["_tb_group"];
      } else if (targetGroupId) properties["_tb_group"] = targetGroupId;
      if (properties["_tb_group"]) delete properties["_tb_layer"];
      else if (targetLayerId) properties["_tb_layer"] = targetLayerId;
      else delete properties["_tb_layer"];
      if ("origin" in properties) {
        const origin = parseEntityOrigin(sourceEntity);
        if (!origin)
          throw new Error(
            `Clipboard entity ${sourceEntity.id} has an invalid origin`,
          );
        properties.origin = formatEntityOrigin([
          origin[0] + delta[0],
          origin[1] + delta[1],
          origin[2] + delta[2],
        ]);
      } else if (
        sourceEntity.primitives.length === 0 &&
        !isEditorGroupEntity(sourceEntity)
      ) {
        throw new Error(
          `Clipboard point entity ${sourceEntity.id} has no origin`,
        );
      }
      const brushes = sourceEntity.primitives
        .filter((primitive) => primitive.kind === "brush")
        .map((brush) => {
          const clone = cloneBrush(brush, ids, delta, textureLock);
          pastedBrushIds.push(clone.id);
          return clone;
        });
      const entity: MapEntity = {
        id: ids.entity(),
        properties,
        primitives: brushes,
      };
      after = insertEntity(after, entity);
      if (brushes.length === 0 && !isEditorGroupEntity(entity))
        pastedEntityIds.push(entity.id);
    }
    for (const pastedGroupId of groupIdMap.values()) {
      after = transformEditorGroupMetadata(
        after,
        pastedGroupId,
        translationAffineMatrix(delta),
      );
    }
    after = normalizeSingleLinkedGroups(after);
    after = { ...after, revision: this.kernel.document.revision + 1 };
    let selectionAfter = createObjectSelection(
      pastedBrushIds,
      pastedEntityIds,
      pastedEntityIds.length > 0
        ? { kind: "entity", entityId: pastedEntityIds.at(-1)! }
        : { kind: "brush", brushId: pastedBrushIds.at(-1)! },
    );
    const selectedPastedGroup = selectedEditorGroup(after, selectionAfter);
    if (selectionAfter && selectedPastedGroup) {
      selectionAfter = { ...selectionAfter, groupId: selectedPastedGroup.id };
    }
    const count = pastedBrushIds.length + pastedEntityIds.length;
    return {
      label: count === 1 ? "Paste object" : "Paste objects",
      baseDocumentRevision: this.kernel.document.revision,
      before: this.kernel.document,
      after,
      selectionBefore: this.kernel.selection,
      selectionAfter,
      document: after,
    };
  }

  public pasteObjects(
    clipboard: MapDocument,
    ids: IdFactory,
    delta: Vec3 = [0, 0, 0],
    textureLock = true,
    targetGroupId: string | null = null,
    targetLayerId: EditorLayerId = this.kernel.layerId,
  ): boolean {
    const candidate = this.createPasteCandidate(
      clipboard,
      ids,
      delta,
      textureLock,
      targetGroupId,
      targetLayerId,
    );
    if (!candidate) return false;
    this.ports.commitDocumentCandidate(candidate);
    return true;
  }
}
