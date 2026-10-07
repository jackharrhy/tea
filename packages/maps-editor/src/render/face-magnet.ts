import type { FaceHandle } from "./viewport-geometry.js";
import { dot } from "./viewport-geometry.js";

export interface FaceMagnet {
  readonly distance: number;
  readonly face: FaceHandle;
}
/** Narrow spatial candidates to parallel planes with overlapping or touching footprints. */
export function faceMagnets(
  source: FaceHandle,
  targets: readonly FaceHandle[],
): FaceMagnet[] {
  const dropped = [0, 1, 2].reduce((a, b) =>
    Math.abs(source.normal[a]!) > Math.abs(source.normal[b]!) ? a : b,
  );
  const axes = [0, 1, 2].filter((axis) => axis !== dropped);
  return targets.flatMap((face) => {
    if (Math.abs(dot(source.normal, face.normal)) < 0.99999) return [];
    const distance =
      dot(face.center, source.normal) - dot(source.center, source.normal);
    const moved = source.vertices.map((point) =>
      point.map((value, axis) => value + source.normal[axis]! * distance),
    );
    // Allow shared edges as well as overlapping footprints, so a brush can align with the
    // side of its supporting platform. Separated footprints remain ineligible.
    if (
      axes.some(
        (axis) =>
          Math.min(...moved.map((p) => p[axis]!)) >
            Math.max(...face.vertices.map((p) => p[axis]!)) + 0.001 ||
          Math.max(...moved.map((p) => p[axis]!)) <
            Math.min(...face.vertices.map((p) => p[axis]!)) - 0.001,
      )
    )
      return [];
    return [{ distance, face }];
  });
}
export function pickFaceMagnet(
  raw: number,
  pixelsPerWorld: number,
  candidates: readonly FaceMagnet[],
  previous: FaceMagnet | null,
): FaceMagnet | null {
  const scale = Math.max(0.001, pixelsPerWorld);
  if (previous && Math.abs(raw - previous.distance) * scale <= 14)
    return previous;
  let best: FaceMagnet | null = null;
  for (const candidate of candidates) {
    const error = Math.abs(raw - candidate.distance) * scale;
    if (error <= 7 && (!best || error < Math.abs(raw - best.distance) * scale))
      best = candidate;
  }
  return best;
}

/** Highlight every nearby alignment, independently of the single magnetic drag constraint. */
export function alignedFaces(
  distance: number,
  pixelsPerWorld: number,
  candidates: readonly FaceMagnet[],
): readonly FaceHandle[] {
  const tolerance = 7 / Math.max(0.001, pixelsPerWorld);
  return candidates
    .filter((candidate) => Math.abs(candidate.distance - distance) <= tolerance)
    .map((candidate) => candidate.face);
}
