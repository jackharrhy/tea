import type { BrushId, FaceSelection, MapDocument } from "./types.js";

export interface EditorMaterialUsage {
  readonly material: string;
  readonly faceCount: number;
  readonly brushCount: number;
}

function normalizedMaterial(material: string): string {
  return material.trim().toLowerCase();
}

/** Reports deterministic face and brush usage counts, grouping material names case-insensitively. */
export function materialUsageInDocument(
  document: MapDocument,
): readonly EditorMaterialUsage[] {
  const usages = new Map<
    string,
    { material: string; faceCount: number; brushIds: Set<BrushId> }
  >();
  for (const entity of document.entities) {
    for (const brush of entity.primitives) {
      if (brush.kind !== "brush") continue;
      for (const face of brush.faces) {
        const key = normalizedMaterial(face.material);
        if (!key) continue;
        const usage = usages.get(key) ?? {
          material: face.material.trim(),
          faceCount: 0,
          brushIds: new Set<BrushId>(),
        };
        usage.faceCount += 1;
        usage.brushIds.add(brush.id);
        usages.set(key, usage);
      }
    }
  }
  return [...usages.values()]
    .map(({ material, faceCount, brushIds }) => ({
      material,
      faceCount,
      brushCount: brushIds.size,
    }))
    .toSorted((left, right) => left.material.localeCompare(right.material));
}

export function faceReferencesWithMaterial(
  document: MapDocument,
  material: string,
  brushIds?: ReadonlySet<BrushId>,
): readonly FaceSelection[] {
  const normalized = normalizedMaterial(material);
  if (!normalized) return [];
  return document.entities.flatMap((entity) =>
    entity.primitives
      .filter((brush) => brush.kind === "brush")
      .flatMap((brush) =>
        brushIds && !brushIds.has(brush.id)
          ? []
          : brush.faces.flatMap((face) =>
              normalizedMaterial(face.material) === normalized
                ? [{ brushId: brush.id, faceId: face.id }]
                : [],
            ),
      ),
  );
}

export function brushIdsWithMaterial(
  document: MapDocument,
  material: string,
  brushIds?: ReadonlySet<BrushId>,
): readonly BrushId[] {
  const matches = faceReferencesWithMaterial(document, material, brushIds);
  return [...new Set(matches.map((face) => face.brushId))];
}
