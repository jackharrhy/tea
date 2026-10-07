import {
  createBrushEntity as createBrushEntityInDocument,
  insertEntity,
  moveBrushesToEntity,
} from "./document.js";
import { editorLayerForSelection } from "./layers.js";
import { formatEntityOrigin, pointEntityDefinition } from "./point-entities.js";
import {
  createObjectSelection,
  selectedBrushIds,
  selectedPointEntityIds,
} from "./selection.js";
import type { EntityId, IdFactory, MapEntity, Vec3 } from "./types.js";
import type { DocumentEditCandidate } from "./session-common.js";
import type { SessionKernel } from "./session-kernel.js";

type SessionEntityKernel = Readonly<
  Pick<SessionKernel, "document" | "layerId" | "selection">
>;

export interface SessionEntityPorts {
  readonly commitDocumentCandidate: (candidate: DocumentEditCandidate) => void;
}

export class SessionEntityCommands {
  public constructor(
    private readonly kernel: SessionEntityKernel,
    private readonly ports: SessionEntityPorts,
  ) {}

  public createPointEntity(
    classname: string,
    origin: Vec3,
    ids: IdFactory,
    properties: Readonly<Record<string, string>> = {},
  ): boolean {
    const normalizedClassname = classname.trim();
    if (!normalizedClassname)
      throw new Error("A point entity requires a classname");
    const definition = pointEntityDefinition(normalizedClassname);
    const layerProperties: Record<string, string> =
      !properties["_tb_group"] && this.kernel.layerId
        ? { _tb_layer: this.kernel.layerId }
        : {};
    const entity: MapEntity = {
      id: ids.entity(),
      properties: {
        ...definition.defaults,
        ...layerProperties,
        ...properties,
        classname: normalizedClassname,
        origin: formatEntityOrigin(origin),
      },
      primitives: [],
    };
    const after = insertEntity(this.kernel.document, entity);
    this.ports.commitDocumentCandidate({
      label: `Create ${normalizedClassname}`,
      baseDocumentRevision: this.kernel.document.revision,
      before: this.kernel.document,
      after,
      selectionBefore: this.kernel.selection,
      selectionAfter: { entityId: entity.id },
      document: after,
    });
    return true;
  }

  public createBrushEntity(
    classname: string,
    ids: IdFactory,
    properties: Readonly<Record<string, string>> = {},
  ): boolean {
    if (!this.kernel.selection || this.kernel.selection.faceId) return false;
    const brushIds = selectedBrushIds(this.kernel.selection);
    if (brushIds.length === 0) return false;
    const normalizedClassname = classname.trim();
    if (!normalizedClassname)
      throw new Error("A brush entity requires a classname");
    const layer = editorLayerForSelection(
      this.kernel.document,
      this.kernel.selection,
    );
    const entity: MapEntity = {
      id: ids.entity(),
      properties: {
        ...(layer?.id ? { _tb_layer: layer.id } : {}),
        ...properties,
        classname: normalizedClassname,
      },
      primitives: [],
    };
    const after = createBrushEntityInDocument(
      this.kernel.document,
      brushIds,
      entity,
    );
    const selectionAfter = createObjectSelection(
      brushIds,
      selectedPointEntityIds(this.kernel.selection),
      { kind: "brush", brushId: brushIds.at(-1)! },
    );
    this.ports.commitDocumentCandidate({
      label: `Make ${normalizedClassname}`,
      baseDocumentRevision: this.kernel.document.revision,
      before: this.kernel.document,
      after,
      selectionBefore: this.kernel.selection,
      selectionAfter,
      document: after,
    });
    return true;
  }

  public moveSelectedBrushesToEntity(entityId: EntityId): boolean {
    if (!this.kernel.selection || this.kernel.selection.faceId) return false;
    const brushIds = selectedBrushIds(this.kernel.selection);
    if (brushIds.length === 0) return false;
    const after = moveBrushesToEntity(this.kernel.document, brushIds, entityId);
    this.ports.commitDocumentCandidate({
      label: "Move brushes to entity",
      baseDocumentRevision: this.kernel.document.revision,
      before: this.kernel.document,
      after,
      selectionBefore: this.kernel.selection,
      selectionAfter: this.kernel.selection,
      document: after,
    });
    return true;
  }

  public makeSelectedStructural(): boolean {
    if (!this.kernel.selection || this.kernel.selection.faceId) return false;
    const brushIds = selectedBrushIds(this.kernel.selection);
    if (brushIds.length === 0) return false;
    const layer = editorLayerForSelection(
      this.kernel.document,
      this.kernel.selection,
    );
    const target = layer?.id
      ? this.kernel.document.entities.find(
          (entity) => entity.id === layer.entityId,
        )
      : this.kernel.document.entities.find(
          (entity) =>
            entity.properties.classname?.toLowerCase() === "worldspawn",
        );
    if (!target) throw new Error("The map has no structural layer entity");
    const after = moveBrushesToEntity(
      this.kernel.document,
      brushIds,
      target.id,
      true,
    );
    this.ports.commitDocumentCandidate({
      label:
        brushIds.length === 1
          ? "Make brush structural"
          : "Make brushes structural",
      baseDocumentRevision: this.kernel.document.revision,
      before: this.kernel.document,
      after,
      selectionBefore: this.kernel.selection,
      selectionAfter: this.kernel.selection,
      document: after,
    });
    return true;
  }
}
