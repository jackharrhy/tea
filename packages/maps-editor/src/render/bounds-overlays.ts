import {
  selectedBrushIds,
  selectedPointEntityIds,
  type Bounds,
  type EditorSelection,
  type Vec3,
} from "../core/index.js";

const GUIDE_LENGTH = 1_024;
const GUIDE_FADE_START = GUIDE_LENGTH * 0.15;

export function selectionContainsHoveredObject(
  selection: EditorSelection | null,
  hoverSelection: EditorSelection | null,
): boolean {
  if (!selection || !hoverSelection || selection.faceId) return false;
  const brushes = new Set(selectedBrushIds(selection));
  if (hoverSelection.brushId && brushes.has(hoverSelection.brushId))
    return true;
  if (selectedBrushIds(hoverSelection).some((brushId) => brushes.has(brushId)))
    return true;
  const entities = new Set(selectedPointEntityIds(selection));
  return selectedPointEntityIds(hoverSelection).some((entityId) =>
    entities.has(entityId),
  );
}

export function appendBoundsWireframe(
  lines: number[],
  bounds: Bounds,
  color: Vec3,
  offset: Vec3 = [0, 0, 0],
): void {
  const corners: Vec3[] = [
    [bounds.min[0], bounds.min[1], bounds.min[2]],
    [bounds.max[0], bounds.min[1], bounds.min[2]],
    [bounds.min[0], bounds.max[1], bounds.min[2]],
    [bounds.max[0], bounds.max[1], bounds.min[2]],
    [bounds.min[0], bounds.min[1], bounds.max[2]],
    [bounds.max[0], bounds.min[1], bounds.max[2]],
    [bounds.min[0], bounds.max[1], bounds.max[2]],
    [bounds.max[0], bounds.max[1], bounds.max[2]],
  ];
  for (const [startIndex, endIndex] of [
    [0, 1],
    [0, 2],
    [0, 4],
    [1, 3],
    [1, 5],
    [2, 3],
    [2, 6],
    [3, 7],
    [4, 5],
    [4, 6],
    [5, 7],
    [6, 7],
  ] as const) {
    const start = corners[startIndex]!;
    const end = corners[endIndex]!;
    lines.push(
      start[0] + offset[0],
      start[1] + offset[1],
      start[2] + offset[2],
      ...color,
      end[0] + offset[0],
      end[1] + offset[1],
      end[2] + offset[2],
      ...color,
    );
  }
}

export function appendSelectionBoundsGuide(
  lines: number[],
  bounds: Bounds,
  color: Vec3,
  fadeColor: Vec3,
  guideTint: Vec3 = color,
): void {
  appendBoundsWireframe(lines, bounds, color);
  // A light red source fades to transparent in the dedicated premultiplied-alpha pipeline.
  const guideColor: Vec3 = [
    0.35 + guideTint[0] * 0.65,
    0.35 + guideTint[1] * 0.65,
    0.35 + guideTint[2] * 0.65,
  ];
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const corner: Vec3 = [x, y, z];
        for (const axis of [0, 1, 2] as const) {
          const direction = corner[axis] === bounds.min[axis] ? -1 : 1;
          const fadeStart = [...corner] as [number, number, number];
          const end = [...corner] as [number, number, number];
          fadeStart[axis] += direction * GUIDE_FADE_START;
          end[axis] += direction * GUIDE_LENGTH;
          lines.push(
            ...corner,
            ...guideColor,
            ...fadeStart,
            ...guideColor,
            ...fadeStart,
            ...guideColor,
            ...end,
            ...fadeColor,
          );
        }
      }
    }
  }
}
