import { deriveBrush } from "./geometry.js";
import { dot, GEOMETRY_EPSILON } from "./math.js";
import {
  brushesInDocument,
  findBrush,
  type BrushId,
  type BrushSelection,
  type DerivedFace,
  type EditorSelection,
  type EntityId,
  type FaceId,
  type FaceSelection,
  type MapDocument,
  type Vec2,
  type Vec3,
} from "./types.js";

function faceKey(face: FaceSelection): string {
  return `${face.brushId}\u0000${face.faceId}`;
}

function encodedGeometryPoint(point: Vec3): string {
  return point
    .map((component) => Math.round(component / GEOMETRY_EPSILON))
    .join(",");
}

function faceGeometryKey(face: DerivedFace): string {
  return face.vertices.map(encodedGeometryPoint).toSorted().join("|");
}

export function selectedBrushIds(
  selection: EditorSelection | null,
): readonly BrushId[] {
  if (!selection || selection.faceId) return [];
  if (selection.brushId) return selection.brushIds ?? [selection.brushId];
  return selection.brushIds ?? [];
}

export function selectedPointEntityIds(
  selection: EditorSelection | null,
): readonly EntityId[] {
  if (!selection || selection.faceId) return [];
  if (selection.entityId) return selection.entityIds ?? [selection.entityId];
  return selection.entityIds ?? [];
}

export function isBrushSelected(
  selection: EditorSelection | null,
  brushId: BrushId,
): boolean {
  return selectedBrushIds(selection).includes(brushId);
}

export function isPointEntitySelected(
  selection: EditorSelection | null,
  entityId: EntityId,
): boolean {
  return selectedPointEntityIds(selection).includes(entityId);
}

export type ObjectSelectionPrimary =
  | { readonly kind: "brush"; readonly brushId: BrushId }
  | { readonly kind: "entity"; readonly entityId: EntityId };

export function createObjectSelection(
  brushIds: readonly BrushId[],
  entityIds: readonly EntityId[],
  primary: ObjectSelectionPrimary | null = null,
): EditorSelection | null {
  const brushes = [...new Set(brushIds)];
  const entities = [...new Set(entityIds)];
  if (brushes.length === 0 && entities.length === 0) return null;
  const resolvedPrimary =
    primary?.kind === "brush" && brushes.includes(primary.brushId)
      ? primary
      : primary?.kind === "entity" && entities.includes(primary.entityId)
        ? primary
        : entities.length > 0
          ? ({ kind: "entity", entityId: entities.at(-1)! } as const)
          : ({ kind: "brush", brushId: brushes.at(-1)! } as const);
  if (resolvedPrimary.kind === "entity") {
    return {
      entityId: resolvedPrimary.entityId,
      ...(entities.length > 1 ? { entityIds: entities } : {}),
      ...(brushes.length > 0 ? { brushIds: brushes } : {}),
    };
  }
  return {
    brushId: resolvedPrimary.brushId,
    ...(brushes.length > 1 ? { brushIds: brushes } : {}),
    ...(entities.length > 0 ? { entityIds: entities } : {}),
  };
}

export function createBrushSelection(
  brushIds: readonly BrushId[],
  primaryBrushId: BrushId | null = brushIds.at(-1) ?? null,
): BrushSelection | null {
  const result = createObjectSelection(
    brushIds,
    [],
    primaryBrushId ? { kind: "brush", brushId: primaryBrushId } : null,
  );
  return result as BrushSelection | null;
}

/** Replaces the object selection, or toggles the incoming brush as an additive selection gesture. */
export function updateBrushSelection(
  current: EditorSelection | null,
  brushId: BrushId,
  additive: boolean,
): EditorSelection | null {
  if (!additive || current?.faceId) return { brushId };
  const selected = new Set(selectedBrushIds(current));
  const entities = selectedPointEntityIds(current);
  if (selected.has(brushId)) selected.delete(brushId);
  else selected.add(brushId);
  return createObjectSelection(
    [...selected],
    entities,
    selected.has(brushId)
      ? { kind: "brush", brushId }
      : entities.length > 0
        ? { kind: "entity", entityId: entities.at(-1)! }
        : null,
  );
}

export function updatePointEntitySelection(
  current: EditorSelection | null,
  entityId: EntityId,
  additive: boolean,
): EditorSelection | null {
  if (!additive || current?.faceId) return { entityId };
  const brushes = selectedBrushIds(current);
  const selected = new Set(selectedPointEntityIds(current));
  if (selected.has(entityId)) selected.delete(entityId);
  else selected.add(entityId);
  return createObjectSelection(
    brushes,
    [...selected],
    selected.has(entityId)
      ? { kind: "entity", entityId }
      : brushes.length > 0
        ? { kind: "brush", brushId: brushes.at(-1)! }
        : null,
  );
}

export function selectedFaceReferences(
  selection: EditorSelection | null,
): readonly FaceSelection[] {
  if (!selection?.faceId) return [];
  return (
    selection.faces ?? [
      { brushId: selection.brushId, faceId: selection.faceId },
    ]
  );
}

export function isFaceSelected(
  selection: EditorSelection | null,
  brushId: BrushId,
  faceId: FaceId,
): boolean {
  return selectedFaceReferences(selection).some(
    (face) => face.brushId === brushId && face.faceId === faceId,
  );
}

export function createFaceSelection(
  faces: readonly FaceSelection[],
  primary: FaceSelection | null = faces.at(-1) ?? null,
): BrushSelection | null {
  const unique = new Map<string, FaceSelection>();
  for (const face of faces) unique.set(faceKey(face), face);
  if (unique.size === 0) return null;
  const normalized = [...unique.values()];
  const resolvedPrimary =
    primary && unique.has(faceKey(primary))
      ? unique.get(faceKey(primary))!
      : normalized.at(-1)!;
  return normalized.length === 1
    ? { brushId: resolvedPrimary.brushId, faceId: resolvedPrimary.faceId }
    : {
        brushId: resolvedPrimary.brushId,
        faceId: resolvedPrimary.faceId,
        faces: normalized,
      };
}

/** Replaces the face selection, or toggles the incoming faces as an additive selection gesture. */
export function updateFaceSelection(
  current: EditorSelection | null,
  incoming: readonly FaceSelection[],
  additive: boolean,
  primary: FaceSelection | null = incoming.at(-1) ?? null,
): BrushSelection | null {
  if (!additive || !current?.faceId)
    return createFaceSelection(incoming, primary);
  const existing = new Map(
    selectedFaceReferences(current).map(
      (face) => [faceKey(face), face] as const,
    ),
  );
  const additions = new Map(
    incoming.map((face) => [faceKey(face), face] as const),
  );
  const allAlreadySelected = [...additions].every(([key]) => existing.has(key));
  if (allAlreadySelected) {
    for (const key of additions.keys()) existing.delete(key);
    return createFaceSelection([...existing.values()]);
  }
  for (const [key, face] of additions) existing.set(key, face);
  return createFaceSelection([...existing.values()], primary);
}

export function facesOfBrush(
  document: MapDocument,
  brushId: BrushId,
): readonly FaceSelection[] {
  const brush = findBrush(document, brushId);
  return brush?.faces.map((face) => ({ brushId, faceId: face.id })) ?? [];
}

/** Finds faces with exactly the same derived polygon, including faces with opposing normals. */
export function matchingBrushFaces(
  document: MapDocument,
  seed: FaceSelection,
  brushIds: readonly BrushId[],
): readonly FaceSelection[] {
  const seedBrush = findBrush(document, seed.brushId);
  const seedFace = seedBrush
    ? deriveBrush(seedBrush).faces.find((face) => face.faceId === seed.faceId)
    : null;
  if (!seedFace) return [];
  const geometryKey = faceGeometryKey(seedFace);
  const matches = [...new Set([seed.brushId, ...brushIds])].flatMap(
    (brushId) => {
      const brush = findBrush(document, brushId);
      const face = brush
        ? deriveBrush(brush).faces.find(
            (candidate) => faceGeometryKey(candidate) === geometryKey,
          )
        : null;
      return face ? [{ brushId, faceId: face.faceId }] : [];
    },
  );
  return [seed, ...matches.filter((face) => faceKey(face) !== faceKey(seed))];
}

/**
 * Finds the faces that participate when a face is extruded through an object selection.
 * Same-facing faces need only be coplanar. Opposing faces must also overlap the seed polygon so
 * that unrelated brushes on the same plane are not pulled into a shared-seam extrusion.
 */
export function extrudableBrushFaces(
  document: MapDocument,
  seed: FaceSelection,
  brushIds: readonly BrushId[],
): readonly FaceSelection[] {
  const seedBrush = findBrush(document, seed.brushId);
  const seedFace = seedBrush
    ? deriveBrush(seedBrush).faces.find((face) => face.faceId === seed.faceId)
    : null;
  if (!seedFace) return [];

  const matches = [...new Set([seed.brushId, ...brushIds])].flatMap(
    (brushId) => {
      const brush = findBrush(document, brushId);
      if (!brush) return [];
      return deriveBrush(brush).faces.flatMap((face) => {
        const alignment = dot(seedFace.normal, face.normal);
        const sameFacing = alignment >= 1 - 1e-5;
        const opposing = alignment <= -1 + 1e-5;
        const coplanar = sameFacing
          ? Math.abs(seedFace.distance - face.distance) <= GEOMETRY_EPSILON * 4
          : opposing
            ? Math.abs(seedFace.distance + face.distance) <=
              GEOMETRY_EPSILON * 4
            : false;
        if (!coplanar || (opposing && !facesTouch(seedFace, face))) return [];
        return [{ brushId, faceId: face.faceId }];
      });
    },
  );
  const unique = new Map(matches.map((face) => [faceKey(face), face] as const));
  unique.delete(faceKey(seed));
  return [seed, ...unique.values()];
}

interface DerivedFaceReference extends FaceSelection {
  readonly face: DerivedFace;
}

function projected(point: Vec3, droppedAxis: number): Vec2 {
  if (droppedAxis === 0) return [point[1], point[2]];
  if (droppedAxis === 1) return [point[0], point[2]];
  return [point[0], point[1]];
}

function orientation(first: Vec2, second: Vec2, third: Vec2): number {
  return (
    (second[0] - first[0]) * (third[1] - first[1]) -
    (second[1] - first[1]) * (third[0] - first[0])
  );
}

function onSegment(first: Vec2, point: Vec2, second: Vec2): boolean {
  const epsilon = GEOMETRY_EPSILON * 4;
  return (
    Math.abs(orientation(first, point, second)) <= epsilon &&
    point[0] >= Math.min(first[0], second[0]) - epsilon &&
    point[0] <= Math.max(first[0], second[0]) + epsilon &&
    point[1] >= Math.min(first[1], second[1]) - epsilon &&
    point[1] <= Math.max(first[1], second[1]) + epsilon
  );
}

function segmentsTouch(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  const epsilon = GEOMETRY_EPSILON * 4;
  if (
    ((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon)) &&
    ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))
  ) {
    return true;
  }
  return (
    onSegment(a, c, b) ||
    onSegment(a, d, b) ||
    onSegment(c, a, d) ||
    onSegment(c, b, d)
  );
}

function pointInsidePolygon(point: Vec2, polygon: readonly Vec2[]): boolean {
  let inside = false;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]!;
    const end = polygon[(index + 1) % polygon.length]!;
    if (onSegment(start, point, end)) return true;
    const crosses =
      start[1] > point[1] !== end[1] > point[1] &&
      point[0] <
        ((end[0] - start[0]) * (point[1] - start[1])) / (end[1] - start[1]) +
          start[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

function facesTouch(first: DerivedFace, second: DerivedFace): boolean {
  const normal = first.normal;
  const droppedAxis =
    Math.abs(normal[0]) >= Math.abs(normal[1]) &&
    Math.abs(normal[0]) >= Math.abs(normal[2])
      ? 0
      : Math.abs(normal[1]) >= Math.abs(normal[2])
        ? 1
        : 2;
  const left = first.vertices.map((point) => projected(point, droppedAxis));
  const right = second.vertices.map((point) => projected(point, droppedAxis));
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const leftStart = left[leftIndex]!;
    const leftEnd = left[(leftIndex + 1) % left.length]!;
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      if (
        segmentsTouch(
          leftStart,
          leftEnd,
          right[rightIndex]!,
          right[(rightIndex + 1) % right.length]!,
        )
      ) {
        return true;
      }
    }
  }
  return (
    pointInsidePolygon(left[0]!, right) || pointInsidePolygon(right[0]!, left)
  );
}

/** Finds the connected component of same-facing, coplanar face polygons containing the seed. */
export function connectedCoplanarFaces(
  document: MapDocument,
  seed: FaceSelection,
): readonly FaceSelection[] {
  const candidates: DerivedFaceReference[] = [];
  let seedFace: DerivedFace | null = null;
  for (const brush of brushesInDocument(document)) {
    for (const face of deriveBrush(brush).faces) {
      if (brush.id === seed.brushId && face.faceId === seed.faceId)
        seedFace = face;
      candidates.push({ brushId: brush.id, faceId: face.faceId, face });
    }
  }
  if (!seedFace) return [];
  const coplanar = candidates.filter(
    ({ face }) =>
      dot(seedFace!.normal, face.normal) >= 1 - 1e-5 &&
      Math.abs(seedFace!.distance - face.distance) <= GEOMETRY_EPSILON * 4,
  );
  const byKey = new Map(
    coplanar.map((candidate) => [faceKey(candidate), candidate] as const),
  );
  const connected = new Map<string, FaceSelection>();
  const queue = [byKey.get(faceKey(seed))].filter(
    (candidate): candidate is DerivedFaceReference => Boolean(candidate),
  );
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentKey = faceKey(current);
    if (connected.has(currentKey)) continue;
    connected.set(currentKey, {
      brushId: current.brushId,
      faceId: current.faceId,
    });
    for (const candidate of coplanar) {
      const candidateKey = faceKey(candidate);
      if (
        !connected.has(candidateKey) &&
        facesTouch(current.face, candidate.face)
      ) {
        queue.push(candidate);
      }
    }
  }
  return [...connected.values()];
}
