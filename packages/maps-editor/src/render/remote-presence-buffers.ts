import type { EntityDefinitionCatalog } from "../core/index.js";
import { buildSelectionOverlayBuffers } from "./selection-overlay-buffers.js";
import type { EditorRemotePresenceOverlay } from "./types.js";

export function buildRemotePresenceBuffer(
  device: GPUDevice,
  presence: readonly EditorRemotePresenceOverlay[],
  entityDefinitions?: EntityDefinitionCatalog,
) {
  return buildSelectionOverlayBuffers(
    device,
    presence.map((participant) => ({
      key: participant.actorId,
      color: participant.color,
      document: participant.document,
      objectIds: [
        ...new Set([
          ...participant.selectedObjectIds,
          ...participant.previewObjectIds,
        ]),
      ],
      ...(participant.pointer ? { pointer: participant.pointer } : {}),
    })),
    entityDefinitions,
  );
}
