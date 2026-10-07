import type { FaceId, MapBrush, SurfaceAttributes } from "./types.js";

export function updateBrushFaceSurfaces(
  brush: MapBrush,
  faceIds: readonly FaceId[],
  update: (surface: SurfaceAttributes) => SurfaceAttributes,
): MapBrush {
  const selected = new Set(faceIds);
  for (const faceId of selected) {
    if (!brush.faces.some((face) => face.id === faceId)) {
      throw new Error(`Unknown face ${faceId} on brush ${brush.id}`);
    }
  }
  return {
    ...brush,
    revision: brush.revision + 1,
    faces: brush.faces.map((face) =>
      selected.has(face.id) ? { ...face, surface: update(face.surface) } : face,
    ),
  };
}

export function setSurfaceAttributeFlag(
  surface: SurfaceAttributes,
  field: "contents" | "flags",
  mask: number,
  enabled: boolean,
): SurfaceAttributes {
  if (!Number.isInteger(mask) || mask <= 0 || mask > 0x80000000) {
    throw new Error(
      "Surface flag masks must contain a positive 32-bit bit value",
    );
  }
  const current = (surface[field] ?? 0) >>> 0;
  const value = enabled ? (current | mask) >>> 0 : (current & ~mask) >>> 0;
  return { ...surface, [field]: value };
}

export function setSurfaceAttributeValue(
  surface: SurfaceAttributes,
  value: number,
): SurfaceAttributes {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    throw new Error("Surface values must be signed 32-bit integers");
  }
  return { ...surface, value };
}
