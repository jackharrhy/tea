import {
  add,
  cross,
  distanceSquared,
  dot,
  GEOMETRY_EPSILON,
  intersectPlanes,
  normalize,
  planeFromPoints,
  scale,
  subtract,
  type Plane,
} from "./math.js";
import type {
  Bounds,
  DerivedBrush,
  DerivedEdge,
  DerivedFace,
  FaceId,
  GeometryDiagnostic,
  MapBrush,
  MapFace,
  Vec2,
  Vec3,
} from "./types.js";

interface FacePlane {
  readonly face: MapFace;
  readonly plane: Plane;
}

const derivedBrushCache = new WeakMap<MapBrush, DerivedBrush>();

export function textureCoordinates(face: MapFace, point: Vec3): Vec2 {
  const scaleU =
    Math.abs(face.projection.scale[0]) <= Number.EPSILON
      ? 1
      : face.projection.scale[0];
  const scaleV =
    Math.abs(face.projection.scale[1]) <= Number.EPSILON
      ? 1
      : face.projection.scale[1];
  return [
    dot(point, face.projection.uAxis) / scaleU + face.projection.offset[0],
    dot(point, face.projection.vAxis) / scaleV + face.projection.offset[1],
  ];
}

function uniquePoints(points: readonly Vec3[]): Vec3[] {
  const result: Vec3[] = [];
  const epsilonSquared = GEOMETRY_EPSILON * GEOMETRY_EPSILON;
  for (const point of points) {
    if (
      !result.some(
        (candidate) => distanceSquared(candidate, point) <= epsilonSquared,
      )
    ) {
      result.push(point);
    }
  }
  return result;
}

export function brushVertices(brush: MapBrush): readonly Vec3[] {
  return uniquePoints(
    deriveBrush(brush).faces.flatMap((face) => face.vertices),
  );
}

function encodeEdgePoint(point: Vec3): string {
  return point.map((value) => Math.round(value / GEOMETRY_EPSILON)).join(",");
}

function sortFaceVertices(vertices: readonly Vec3[], normal: Vec3): Vec3[] {
  const center = scale(
    vertices.reduce<Vec3>((sum, vertex) => add(sum, vertex), [0, 0, 0]),
    1 / vertices.length,
  );
  const helper: Vec3 = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const tangent = normalize(cross(helper, normal)) ?? [1, 0, 0];
  const bitangent = cross(normal, tangent);
  return vertices.toSorted((left, right) => {
    const leftDelta = subtract(left, center);
    const rightDelta = subtract(right, center);
    const leftAngle = Math.atan2(
      dot(leftDelta, bitangent),
      dot(leftDelta, tangent),
    );
    const rightAngle = Math.atan2(
      dot(rightDelta, bitangent),
      dot(rightDelta, tangent),
    );
    return leftAngle - rightAngle;
  });
}

function edgeKey(start: Vec3, end: Vec3): string {
  const left = encodeEdgePoint(start);
  const right = encodeEdgePoint(end);
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function boundsFor(points: readonly Vec3[]): Bounds | null {
  if (points.length === 0) return null;
  const minimum: [number, number, number] = [...points[0]!] as [
    number,
    number,
    number,
  ];
  const maximum: [number, number, number] = [...points[0]!] as [
    number,
    number,
    number,
  ];
  for (const point of points.slice(1)) {
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis]!, point[axis]!);
      maximum[axis] = Math.max(maximum[axis]!, point[axis]!);
    }
  }
  return { min: minimum, max: maximum };
}

function deriveBrushInternal(
  brush: MapBrush,
  vertexHints?: readonly Vec3[],
): DerivedBrush {
  const diagnostics: GeometryDiagnostic[] = [];
  if (brush.faces.length < 4) {
    diagnostics.push({
      severity: "error",
      code: "too-few-faces",
      message: `Brush ${brush.id} has fewer than four faces`,
    });
  }

  const facePlanes: FacePlane[] = [];
  for (const face of brush.faces) {
    const plane = planeFromPoints(face.planePoints);
    if (plane) facePlanes.push({ face, plane });
    else {
      diagnostics.push({
        severity: "error",
        code: "degenerate-plane",
        message: `Face ${face.id} does not define a plane`,
        faceId: face.id,
      });
    }
  }

  const hintedVertices = vertexHints ? uniquePoints(vertexHints) : [];
  const validHints =
    hintedVertices.length >= 4 &&
    hintedVertices.every((point) =>
      facePlanes.every(
        ({ plane }) =>
          dot(plane.normal, point) <= plane.distance + GEOMETRY_EPSILON,
      ),
    )
      ? hintedVertices
      : [];
  let uniqueVertices: Vec3[];
  if (validHints.length >= 4) {
    uniqueVertices = validHints;
  } else {
    const intersections: Vec3[] = [];
    for (let first = 0; first < facePlanes.length - 2; first += 1) {
      for (
        let second = first + 1;
        second < facePlanes.length - 1;
        second += 1
      ) {
        for (let third = second + 1; third < facePlanes.length; third += 1) {
          const point = intersectPlanes(
            facePlanes[first]!.plane,
            facePlanes[second]!.plane,
            facePlanes[third]!.plane,
          );
          if (
            point &&
            facePlanes.every(
              ({ plane }) =>
                dot(plane.normal, point) <= plane.distance + GEOMETRY_EPSILON,
            )
          ) {
            intersections.push(point);
          }
        }
      }
    }
    uniqueVertices = uniquePoints(intersections);
  }
  if (uniqueVertices.length === 0) {
    diagnostics.push({
      severity: "error",
      code: "empty-brush",
      message: `Brush ${brush.id} has no bounded interior`,
    });
  }

  const derivedFaces: DerivedFace[] = [];
  const mesh: number[] = [];
  const edges = new Map<string, DerivedEdge>();
  for (const { face, plane } of facePlanes) {
    const faceVertices = sortFaceVertices(
      uniqueVertices.filter(
        (vertex) =>
          Math.abs(dot(plane.normal, vertex) - plane.distance) <=
          GEOMETRY_EPSILON * 4,
      ),
      plane.normal,
    );
    if (faceVertices.length < 3) {
      diagnostics.push({
        severity: "error",
        code: "open-face",
        message: `Face ${face.id} does not bound a polygon`,
        faceId: face.id,
      });
      continue;
    }
    const uv = faceVertices.map((vertex) => textureCoordinates(face, vertex));
    derivedFaces.push({
      faceId: face.id,
      material: face.material,
      normal: plane.normal,
      distance: plane.distance,
      vertices: faceVertices,
      textureCoordinates: uv,
    });
    for (let index = 1; index < faceVertices.length - 1; index += 1) {
      for (const vertexIndex of [0, index, index + 1]) {
        const point = faceVertices[vertexIndex]!;
        const texture = uv[vertexIndex]!;
        mesh.push(
          point[0],
          point[1],
          point[2],
          plane.normal[0],
          plane.normal[1],
          plane.normal[2],
          texture[0],
          texture[1],
        );
      }
    }
    for (let index = 0; index < faceVertices.length; index += 1) {
      const start = faceVertices[index]!;
      const end = faceVertices[(index + 1) % faceVertices.length]!;
      edges.set(edgeKey(start, end), { start, end });
    }
  }

  if (
    uniqueVertices.some((vertex) =>
      vertex.some((value) => !Number.isFinite(value)),
    )
  ) {
    diagnostics.push({
      severity: "error",
      code: "unbounded-brush",
      message: `Brush ${brush.id} produced non-finite geometry`,
    });
  }

  const result: DerivedBrush = {
    brushId: brush.id,
    sourceRevision: brush.revision,
    valid: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    bounds: boundsFor(uniqueVertices),
    faces: derivedFaces,
    edges: [...edges.values()],
    vertices: new Float32Array(mesh),
    diagnostics,
  };
  derivedBrushCache.set(brush, result);
  return result;
}

export function deriveBrush(brush: MapBrush): DerivedBrush {
  return derivedBrushCache.get(brush) ?? deriveBrushInternal(brush);
}

/** Primes derived geometry when a trusted convex builder already knows every authored corner. */
export function deriveBrushFromVertices(
  brush: MapBrush,
  vertices: readonly Vec3[],
): DerivedBrush {
  return derivedBrushCache.get(brush) ?? deriveBrushInternal(brush, vertices);
}

export interface BrushRayHit {
  readonly brushId: MapBrush["id"];
  readonly faceId: FaceId;
  readonly distance: number;
  readonly point: Vec3;
}

export function intersectBrushRay(
  brush: MapBrush,
  origin: Vec3,
  direction: Vec3,
): BrushRayHit | null {
  let enter = 0;
  let exit = Number.POSITIVE_INFINITY;
  let enterFace: FaceId | null = null;
  let exitFace: FaceId | null = null;
  for (const face of brush.faces) {
    const plane = planeFromPoints(face.planePoints);
    if (!plane) return null;
    const denominator = dot(plane.normal, direction);
    const numerator = plane.distance - dot(plane.normal, origin);
    if (Math.abs(denominator) <= 1e-8) {
      if (numerator < 0) return null;
      continue;
    }
    const distance = numerator / denominator;
    if (denominator < 0) {
      if (distance > enter) {
        enter = distance;
        enterFace = face.id;
      }
    } else if (distance < exit) {
      exit = distance;
      exitFace = face.id;
    }
    if (enter > exit) return null;
  }
  const distance = enterFace ? enter : exit;
  const faceId = enterFace ?? exitFace;
  if (!faceId || distance < 0 || !Number.isFinite(distance)) return null;
  return {
    brushId: brush.id,
    faceId,
    distance,
    point: add(origin, scale(direction, distance)),
  };
}
