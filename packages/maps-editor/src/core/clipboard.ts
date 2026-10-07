import { combinedBounds } from "./math.js";
import { findBrush, isMapBrush } from "./types.js";
import { deriveBrush } from "./geometry.js";
import { deriveEditorGroups, isEditorGroupEntity } from "./groups.js";
import { isEditorLayerEntity } from "./layers.js";
import { pointEntityBounds } from "./point-entities.js";
import { Vec2Schema, Vec3Schema } from "./runtime-schemas.js";
import { selectedBrushIds, selectedPointEntityIds } from "./selection.js";
import { serializeMap } from "./map-serializer.js";
import { z } from "zod";
import type {
  Bounds,
  EditorSelection,
  MapDocument,
  MapEntity,
  SurfaceAttributes,
  TextureProjection,
  Vec3,
} from "./types.js";

export const FACE_ATTRIBUTE_CLIPBOARD_HEADER =
  "// Worldview face attributes v1";

/** A portable, ID-free snapshot of one authored face's material and mapping attributes. */
export interface FaceAttributeClipboard {
  readonly type: "worldview-face-attributes";
  readonly version: 1;
  readonly material: string;
  /** Retained so a future rotated-paste mode has the source plane available. */
  readonly planePoints: readonly [Vec3, Vec3, Vec3];
  readonly projection: TextureProjection;
  /** Contents stay with the destination brush and are deliberately omitted. */
  readonly surface: Omit<SurfaceAttributes, "contents">;
}

function clonedVec3(value: Vec3): Vec3 {
  return [value[0], value[1], value[2]];
}

const FaceAttributeClipboardSchema = z.strictObject({
  type: z.literal("worldview-face-attributes"),
  version: z.literal(1),
  material: z.string().refine((material) => material.trim().length > 0, {
    message: "material must be a non-empty string",
  }),
  planePoints: z.tuple([Vec3Schema, Vec3Schema, Vec3Schema]),
  projection: z.strictObject({
    kind: z.enum(["axial", "valve-220"]),
    uAxis: Vec3Schema,
    vAxis: Vec3Schema,
    offset: Vec2Schema,
    rotationDegrees: z.number().finite(),
    scale: Vec2Schema.refine(
      (scale) =>
        scale.every((component) => Math.abs(component) > Number.EPSILON),
      { message: "scale components must be non-zero" },
    ),
  }),
  surface: z.strictObject({
    flags: z.number().finite().optional(),
    value: z.number().finite().optional(),
  }),
});

function faceAttributeClipboardFromUnknown(
  value: unknown,
): FaceAttributeClipboard {
  const result = FaceAttributeClipboardSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    const path = issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
    throw new Error(
      `Face attribute clipboard payload is invalid${path}: ${issue.message}`,
    );
  }
  const payload = result.data;
  return {
    type: "worldview-face-attributes",
    version: 1,
    material: payload.material,
    planePoints: payload.planePoints,
    projection: {
      kind: "valve-220",
      uAxis: payload.projection.uAxis,
      vAxis: payload.projection.vAxis,
      offset: payload.projection.offset,
      rotationDegrees: payload.projection.rotationDegrees,
      scale: payload.projection.scale,
    },
    surface: {
      ...(payload.surface.flags === undefined
        ? {}
        : { flags: payload.surface.flags }),
      ...(payload.surface.value === undefined
        ? {}
        : { value: payload.surface.value }),
    },
  };
}

export function serializeFaceAttributeClipboard(
  document: MapDocument,
  selection: EditorSelection | null,
): string | null {
  if (!selection?.brushId || !selection.faceId) return null;
  const face = findBrush(document, selection.brushId)?.faces.find(
    (candidate) => candidate.id === selection.faceId,
  );
  if (!face) throw new Error("The selected clipboard face no longer exists");
  const surface = { ...face.surface };
  delete surface.contents;
  const payload: FaceAttributeClipboard = {
    type: "worldview-face-attributes",
    version: 1,
    material: face.material,
    planePoints: [
      clonedVec3(face.planePoints[0]),
      clonedVec3(face.planePoints[1]),
      clonedVec3(face.planePoints[2]),
    ],
    projection: {
      kind: face.projection.kind,
      uAxis: clonedVec3(face.projection.uAxis),
      vAxis: clonedVec3(face.projection.vAxis),
      offset: [face.projection.offset[0], face.projection.offset[1]],
      rotationDegrees: face.projection.rotationDegrees,
      scale: [face.projection.scale[0], face.projection.scale[1]],
    },
    surface: { ...surface },
  };
  return `${FACE_ATTRIBUTE_CLIPBOARD_HEADER}\n${JSON.stringify(payload, null, 2)}`;
}

/** Parses a Worldview face payload, or returns null when the text is ordinary map/object data. */
export function parseFaceAttributeClipboard(
  text: string,
): FaceAttributeClipboard | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(FACE_ATTRIBUTE_CLIPBOARD_HEADER)) return null;
  const body = trimmed.slice(FACE_ATTRIBUTE_CLIPBOARD_HEADER.length).trim();
  if (!body) throw new Error("Face attribute clipboard payload is empty");
  try {
    return faceAttributeClipboardFromUnknown(JSON.parse(body));
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error("Face attribute clipboard payload is invalid JSON", {
        cause: error,
      });
    throw error;
  }
}

/** Builds a standalone, parseable map-text document containing only the selected source objects. */
export function createObjectClipboardDocument(
  document: MapDocument,
  selection: EditorSelection | null,
): MapDocument | null {
  if (!selection || selection.faceId) return null;
  const selectedBrushes = new Set(selectedBrushIds(selection));
  const selectedEntities = new Set(selectedPointEntityIds(selection));
  if (selectedBrushes.size + selectedEntities.size === 0) return null;
  const worldspawn = document.entities.find(
    (entity) => entity.properties.classname?.toLowerCase() === "worldspawn",
  );
  if (!worldspawn) throw new Error("The map has no worldspawn entity");

  const includedGroupIds = new Set(
    deriveEditorGroups(document)
      .filter(
        (group) =>
          group.brushIds.every((brushId) => selectedBrushes.has(brushId)) &&
          group.pointEntityIds.every((entityId) =>
            selectedEntities.has(entityId),
          ) &&
          group.brushIds.length + group.pointEntityIds.length > 0,
      )
      .map((group) => group.id),
  );
  const worldBrushes = [
    ...worldspawn.primitives.filter((brush) => selectedBrushes.has(brush.id)),
    ...document.entities.flatMap((entity) =>
      isEditorLayerEntity(entity) ||
      (isEditorGroupEntity(entity) &&
        !includedGroupIds.has(entity.properties["_tb_id"] ?? ""))
        ? entity.primitives.filter((brush) => selectedBrushes.has(brush.id))
        : [],
    ),
  ];

  const entities: MapEntity[] = [
    {
      id: worldspawn.id,
      properties: { classname: "worldspawn" },
      primitives: worldBrushes,
    },
  ];
  const foundBrushes = new Set(
    entities[0]!.primitives.map((brush) => brush.id),
  );
  const foundEntities = new Set<string>();
  for (const entity of document.entities) {
    if (entity.id === worldspawn.id) continue;
    if (isEditorLayerEntity(entity)) continue;
    if (isEditorGroupEntity(entity)) {
      const groupId = entity.properties["_tb_id"] ?? "";
      if (!includedGroupIds.has(groupId)) continue;
      const properties = { ...entity.properties };
      if (!includedGroupIds.has(properties["_tb_group"] ?? ""))
        delete properties["_tb_group"];
      delete properties["_tb_layer"];
      const brushes = entity.primitives.filter((brush) =>
        selectedBrushes.has(brush.id),
      );
      brushes.forEach((brush) => foundBrushes.add(brush.id));
      entities.push({ ...entity, properties, primitives: brushes });
      continue;
    }
    const brushes = entity.primitives.filter((brush) =>
      selectedBrushes.has(brush.id),
    );
    if (brushes.length > 0) {
      brushes.forEach((brush) => foundBrushes.add(brush.id));
      const properties = { ...entity.properties };
      if (!includedGroupIds.has(properties["_tb_group"] ?? ""))
        delete properties["_tb_group"];
      delete properties["_tb_layer"];
      entities.push({ ...entity, properties, primitives: brushes });
      continue;
    }
    if (selectedEntities.has(entity.id)) {
      if (entity.primitives.length > 0) {
        throw new Error(
          `Brush entity ${entity.id} cannot be copied as a point entity`,
        );
      }
      foundEntities.add(entity.id);
      const properties = { ...entity.properties };
      if (!includedGroupIds.has(properties["_tb_group"] ?? ""))
        delete properties["_tb_group"];
      delete properties["_tb_layer"];
      entities.push({ ...entity, properties, primitives: [] });
    }
  }
  if (foundBrushes.size !== selectedBrushes.size) {
    throw new Error("The clipboard selection contains an unknown brush");
  }
  if (foundEntities.size !== selectedEntities.size) {
    throw new Error("The clipboard selection contains an unknown point entity");
  }
  return { ...document, revision: 0, entities };
}

/** Returns editor-compatible map text so object selections can cross documents and editors. */
export function serializeObjectClipboard(
  document: MapDocument,
  selection: EditorSelection | null,
): string | null {
  const clipboard = createObjectClipboardDocument(document, selection);
  return clipboard ? serializeMap(clipboard) : null;
}

export function objectClipboardBounds(document: MapDocument): Bounds | null {
  const bounds = [
    ...document.entities.flatMap((entity) =>
      entity.primitives.filter(isMapBrush).flatMap((brush) => {
        const derived = deriveBrush(brush);
        return derived.valid && derived.bounds ? [derived.bounds] : [];
      }),
    ),
    ...document.entities.flatMap((entity) => {
      if (entity.primitives.length > 0) return [];
      const entityBounds = pointEntityBounds(entity);
      return entityBounds ? [entityBounds] : [];
    }),
  ];
  return combinedBounds(bounds);
}

/** Places the clipboard center at a pointer, resting one bounds side on a hit surface when supplied. */
export function objectClipboardPasteOffset(
  document: MapDocument,
  point: Vec3,
  surfaceNormal: Vec3 | null = null,
  gridSize = 1,
): Vec3 | null {
  const bounds = objectClipboardBounds(document);
  if (!bounds) return null;
  const center: Vec3 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  const delta: [number, number, number] = [
    point[0] - center[0],
    point[1] - center[1],
    point[2] - center[2],
  ];
  if (surfaceNormal) {
    const support: Vec3 = [
      surfaceNormal[0] >= 0 ? bounds.min[0] : bounds.max[0],
      surfaceNormal[1] >= 0 ? bounds.min[1] : bounds.max[1],
      surfaceNormal[2] >= 0 ? bounds.min[2] : bounds.max[2],
    ];
    const currentSupport: Vec3 = [
      support[0] + delta[0],
      support[1] + delta[1],
      support[2] + delta[2],
    ];
    const normalLengthSquared = surfaceNormal.reduce(
      (sum, component) => sum + component * component,
      0,
    );
    if (normalLengthSquared > Number.EPSILON) {
      const correction =
        surfaceNormal.reduce(
          (sum, component, axis) =>
            sum + component * (point[axis]! - currentSupport[axis]!),
          0,
        ) / normalLengthSquared;
      delta[0] += surfaceNormal[0] * correction;
      delta[1] += surfaceNormal[1] * correction;
      delta[2] += surfaceNormal[2] * correction;
    }
  }
  const snapSize = Math.max(Number.EPSILON, gridSize);
  for (let axis = 0; axis < 3; axis += 1) {
    if (surfaceNormal && Math.abs(surfaceNormal[axis]!) > 1e-5) continue;
    const translatedMin = bounds.min[axis]! + delta[axis]!;
    delta[axis] =
      delta[axis]! +
      Math.round(translatedMin / snapSize) * snapSize -
      translatedMin;
  }
  return delta;
}
