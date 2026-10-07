import {
  brushVertices,
  deriveBrush,
  findBrush,
  selectedBrushIds,
  selectedFaceReferences,
  type Bounds,
  type BrushId,
  type EditorSelection,
  type FaceSelection,
  type MapDocument,
  type MapBrush,
  type TransformAxis,
  type Vec3,
} from "../core/index.js";
import type {
  EditorTool,
  EditorTopologyKind,
  EditorTransformDragEvent,
  EditorViewportKind,
} from "./types.js";

export interface TopologyHandle {
  readonly key: string;
  readonly kind: EditorTopologyKind;
  readonly center: Vec3;
  readonly vertices: readonly Vec3[];
  readonly brushIds: readonly BrushId[];
  readonly insertion?: true;
}

export interface FaceHandle {
  readonly selection: FaceSelection;
  readonly center: Vec3;
  readonly normal: Vec3;
  readonly vertices: readonly Vec3[];
}

export function availableTopologyHandles(
  document: MapDocument,
  selection: EditorSelection | null,
  kind: EditorTopologyKind,
): readonly TopologyHandle[] {
  if (!selection || selection.faceId) return [];
  const handles = new Map<string, TopologyHandle>();
  for (const brushId of selectedBrushIds(selection)) {
    const brush = findBrush(document, brushId);
    if (!brush) continue;
    const candidates: readonly TopologyHandle[] =
      kind === "vertex"
        ? brushVertices(brush).map((point) => ({
            kind,
            center: point,
            vertices: [point],
            key: topologyHandleKey(kind, [point]),
            brushIds: [brush.id],
          }))
        : deriveBrush(brush).edges.map((edge) => {
            const vertices = [edge.start, edge.end] as const;
            return {
              kind,
              vertices,
              key: topologyHandleKey(kind, vertices),
              brushIds: [brush.id],
              center: [
                (vertices[0][0] + vertices[1][0]) / 2,
                (vertices[0][1] + vertices[1][1]) / 2,
                (vertices[0][2] + vertices[1][2]) / 2,
              ],
            };
          });
    for (const handle of candidates) {
      const existing = handles.get(handle.key);
      handles.set(
        handle.key,
        existing
          ? {
              ...existing,
              brushIds: [...new Set([...existing.brushIds, brush.id])],
            }
          : handle,
      );
    }
  }
  return [...handles.values()];
}

export function availableFaceHandles(
  document: MapDocument,
  selection: EditorSelection | null,
): readonly FaceHandle[] {
  if (!selection) return [];
  const brushIds = selection.faceId
    ? [
        ...new Set(
          selectedFaceReferences(selection).map((face) => face.brushId),
        ),
      ]
    : selectedBrushIds(selection);
  return brushIds.flatMap((brushId) => {
    const brush = findBrush(document, brushId);
    if (!brush) return [];
    return brushFaceHandles(brush);
  });
}

export function brushFaceHandles(brush: MapBrush): readonly FaceHandle[] {
  return deriveBrush(brush).faces.map((face) => {
    const sum = face.vertices.reduce<[number, number, number]>(
      (total, point) => [
        total[0] + point[0],
        total[1] + point[1],
        total[2] + point[2],
      ],
      [0, 0, 0],
    );
    const center: Vec3 = [
      sum[0] / face.vertices.length,
      sum[1] / face.vertices.length,
      sum[2] / face.vertices.length,
    ];
    return {
      selection: { brushId: brush.id, faceId: face.faceId },
      center,
      normal: face.normal,
      vertices: face.vertices,
    };
  });
}

export type ScaleSide = -1 | 0 | 1;

export interface ScaleHandle {
  readonly point: Vec3;
  readonly axes: readonly TransformAxis[];
  readonly sides: readonly [ScaleSide, ScaleSide, ScaleSide];
}

export interface MovementTrace {
  readonly start: Vec3;
  readonly end: Vec3;
  readonly axisRestriction: TransformAxis | null;
}

export function encodedTopologyPoint(point: Vec3): string {
  return point.map((component) => Math.round(component / 0.001)).join(",");
}

export function topologyHandleKey(
  kind: EditorTopologyKind,
  vertices: readonly Vec3[],
): string {
  return `${kind}:${vertices.map(encodedTopologyPoint).toSorted().join("|")}`;
}

export function translatedTopologyHandle(
  handle: TopologyHandle,
  delta: Vec3,
): TopologyHandle {
  const translate = (point: Vec3): Vec3 => [
    point[0] + delta[0],
    point[1] + delta[1],
    point[2] + delta[2],
  ];
  const vertices = handle.vertices.map(translate);
  return {
    kind: handle.kind,
    vertices,
    center: translate(handle.center),
    key: topologyHandleKey(handle.kind, vertices),
    brushIds: handle.brushIds,
  };
}

export function topologyHandleVertices(
  handles: readonly TopologyHandle[],
): readonly Vec3[] {
  const unique = new Map<string, Vec3>();
  for (const vertex of handles.flatMap((handle) => handle.vertices)) {
    unique.set(encodedTopologyPoint(vertex), vertex);
  }
  return [...unique.values()];
}

export function topologyHandleBrushIds(
  handles: readonly TopologyHandle[],
): readonly BrushId[] {
  return [...new Set(handles.flatMap((handle) => handle.brushIds))];
}

export function topologyHandleBounds(
  handles: readonly TopologyHandle[],
): Bounds | null {
  const vertices = topologyHandleVertices(handles);
  if (vertices.length === 0) return null;
  return {
    min: [
      Math.min(...vertices.map((point) => point[0])),
      Math.min(...vertices.map((point) => point[1])),
      Math.min(...vertices.map((point) => point[2])),
    ],
    max: [
      Math.max(...vertices.map((point) => point[0])),
      Math.max(...vertices.map((point) => point[1])),
      Math.max(...vertices.map((point) => point[2])),
    ],
  };
}

export function isTransformTool(
  tool: EditorTool,
): tool is "rotate" | "scale" | "shear" {
  return tool === "rotate" || tool === "scale" || tool === "shear";
}

export function dominantAxis(vector: Vec3): 0 | 1 | 2 {
  const absolute = vector.map(Math.abs) as [number, number, number];
  return absolute[0] >= absolute[1] && absolute[0] >= absolute[2]
    ? 0
    : absolute[1] >= absolute[2]
      ? 1
      : 2;
}

export function transformTopologyPoint(
  point: Vec3,
  event: EditorTransformDragEvent,
): Vec3 {
  const relative: Vec3 = [
    point[0] - event.pivot[0],
    point[1] - event.pivot[1],
    point[2] - event.pivot[2],
  ];
  let transformed: Vec3;
  if (event.tool === "rotate") {
    const radians = (event.angleDegrees * Math.PI) / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    transformed =
      event.axis === 0
        ? [
            relative[0],
            relative[1] * cosine - relative[2] * sine,
            relative[1] * sine + relative[2] * cosine,
          ]
        : event.axis === 1
          ? [
              relative[0] * cosine + relative[2] * sine,
              relative[1],
              -relative[0] * sine + relative[2] * cosine,
            ]
          : [
              relative[0] * cosine - relative[1] * sine,
              relative[0] * sine + relative[1] * cosine,
              relative[2],
            ];
  } else if (event.tool === "scale") {
    transformed = [
      relative[0] * event.factors[0],
      relative[1] * event.factors[1],
      relative[2] * event.factors[2],
    ];
  } else {
    const offset = relative[event.sourceAxis] * event.factor;
    transformed = [
      relative[0] + (event.targetAxis === 0 ? offset : 0),
      relative[1] + (event.targetAxis === 1 ? offset : 0),
      relative[2] + (event.targetAxis === 2 ? offset : 0),
    ];
  }
  return [
    transformed[0] + event.pivot[0],
    transformed[1] + event.pivot[1],
    transformed[2] + event.pivot[2],
  ];
}

export function normalize(value: Vec3): Vec3 {
  const magnitude = Math.hypot(value[0], value[1], value[2]);
  return magnitude > 0
    ? [value[0] / magnitude, value[1] / magnitude, value[2] / magnitude]
    : [0, 0, -1];
}

export function cross(left: Vec3, right: Vec3): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

export function dot(left: Vec3, right: Vec3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

export function addScaled(origin: Vec3, direction: Vec3, factor: number): Vec3 {
  return [
    origin[0] + direction[0] * factor,
    origin[1] + direction[1] * factor,
    origin[2] + direction[2] * factor,
  ];
}

export function dedupeHullPoints(points: readonly Vec3[]): readonly Vec3[] {
  const unique = new Map<string, Vec3>();
  for (const point of points) unique.set(encodedTopologyPoint(point), point);
  return [...unique.values()];
}

export function snapPointToPlane(
  point: Vec3,
  planePoint: Vec3,
  normal: Vec3,
  gridSize: number,
): Vec3 {
  const snapped = point.map(
    (component) => Math.round(component / gridSize) * gridSize,
  ) as [number, number, number];
  const distance = dot(normal, planePoint);
  return addScaled(snapped, normal, distance - dot(normal, snapped));
}

export function rectangleOnPlane(
  start: Vec3,
  end: Vec3,
  normal: Vec3,
): readonly Vec3[] {
  const helper: Vec3 = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const tangent = normalize(cross(helper, normal));
  const bitangent = normalize(cross(normal, tangent));
  const delta: Vec3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
  const tangentDelta = dot(delta, tangent);
  const bitangentDelta = dot(delta, bitangent);
  const tangentCorner = addScaled(start, tangent, tangentDelta);
  const bitangentCorner = addScaled(start, bitangent, bitangentDelta);
  return [
    start,
    tangentCorner,
    addScaled(tangentCorner, bitangent, bitangentDelta),
    bitangentCorner,
  ];
}

export function pointsFormPolygonOnPlane(
  points: readonly Vec3[],
  planePoint: Vec3,
  normal: Vec3,
): boolean {
  if (points.length < 3) return false;
  const distance = dot(normal, planePoint);
  if (points.some((point) => Math.abs(dot(normal, point) - distance) > 0.01))
    return false;
  const origin = points[0]!;
  for (let second = 1; second < points.length - 1; second += 1) {
    for (let third = second + 1; third < points.length; third += 1) {
      const firstEdge: Vec3 = [
        points[second]![0] - origin[0],
        points[second]![1] - origin[1],
        points[second]![2] - origin[2],
      ];
      const secondEdge: Vec3 = [
        points[third]![0] - origin[0],
        points[third]![1] - origin[1],
        points[third]![2] - origin[2],
      ];
      if (Math.hypot(...cross(firstEdge, secondEdge)) > 0.01) return true;
    }
  }
  return false;
}

export function inferClipPlane(
  points: readonly Vec3[],
  viewDirection: Vec3,
): readonly [Vec3, Vec3, Vec3] | null {
  if (points.length < 2) return null;
  const first = points[0]!;
  const second = points[1]!;
  const third = points[2] ?? addScaled(first, viewDirection, 64);
  const firstEdge: Vec3 = [
    second[0] - first[0],
    second[1] - first[1],
    second[2] - first[2],
  ];
  const secondEdge: Vec3 = [
    third[0] - first[0],
    third[1] - first[1],
    third[2] - first[2],
  ];
  if (Math.hypot(...cross(secondEdge, firstEdge)) <= 1e-6) return null;
  return [first, second, third];
}

export function rayPlaneIntersection(
  origin: Vec3,
  direction: Vec3,
  planePoint: Vec3,
  planeNormal: Vec3,
): Vec3 | null {
  const denominator =
    direction[0] * planeNormal[0] +
    direction[1] * planeNormal[1] +
    direction[2] * planeNormal[2];
  if (Math.abs(denominator) <= 1e-6) return null;
  const factor =
    ((planePoint[0] - origin[0]) * planeNormal[0] +
      (planePoint[1] - origin[1]) * planeNormal[1] +
      (planePoint[2] - origin[2]) * planeNormal[2]) /
    denominator;
  return addScaled(origin, direction, factor);
}

export function snappedDelta(start: Vec3, end: Vec3, gridSize: number): Vec3 {
  const snap = (value: number) => Math.round(value / gridSize) * gridSize;
  return [
    snap(end[0] - start[0]),
    snap(end[1] - start[1]),
    snap(end[2] - start[2]),
  ];
}

export function pointSegmentDistance(
  point: readonly [number, number],
  start: readonly [number, number],
  end: readonly [number, number],
): number {
  const deltaX = end[0] - start[0];
  const deltaY = end[1] - start[1];
  const denominator = deltaX * deltaX + deltaY * deltaY;
  const amount =
    denominator <= 1e-6
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point[0] - start[0]) * deltaX + (point[1] - start[1]) * deltaY) /
              denominator,
          ),
        );
  return Math.hypot(
    start[0] + deltaX * amount - point[0],
    start[1] + deltaY * amount - point[1],
  );
}

export function creationBounds(
  start: Vec3,
  end: Vec3,
  kind: EditorViewportKind,
  gridSize: number,
  referenceBounds: Bounds | null,
  equalVisibleAxes: boolean,
  equalAllAxes: boolean,
): Bounds | null {
  const snap = (value: number) => Math.round(value / gridSize) * gridSize;
  const first = start.map(snap) as [number, number, number];
  const second = end.map(snap) as [number, number, number];
  let min: [number, number, number];
  let max: [number, number, number];
  if (kind === "perspective") {
    min = [
      Math.min(first[0], second[0]),
      Math.min(first[1], second[1]),
      first[2],
    ];
    max = [
      Math.max(first[0], second[0]),
      Math.max(first[1], second[1]),
      first[2] + gridSize,
    ];
  } else if (kind === "xy") {
    min = [
      Math.min(first[0], second[0]),
      Math.min(first[1], second[1]),
      snap(referenceBounds?.min[2] ?? 0),
    ];
    max = [
      Math.max(first[0], second[0]),
      Math.max(first[1], second[1]),
      snap(referenceBounds?.max[2] ?? gridSize),
    ];
  } else if (kind === "xz") {
    min = [
      Math.min(first[0], second[0]),
      snap(referenceBounds?.min[1] ?? 0),
      Math.min(first[2], second[2]),
    ];
    max = [
      Math.max(first[0], second[0]),
      snap(referenceBounds?.max[1] ?? gridSize),
      Math.max(first[2], second[2]),
    ];
  } else {
    min = [
      snap(referenceBounds?.min[0] ?? 0),
      Math.min(first[1], second[1]),
      Math.min(first[2], second[2]),
    ];
    max = [
      snap(referenceBounds?.max[0] ?? gridSize),
      Math.max(first[1], second[1]),
      Math.max(first[2], second[2]),
    ];
  }
  const visibleAxes =
    kind === "perspective" || kind === "xy"
      ? ([0, 1] as const)
      : kind === "xz"
        ? ([0, 2] as const)
        : ([1, 2] as const);
  const hiddenAxis = ([0, 1, 2] as const).find(
    (axis) => !visibleAxes.some((visibleAxis) => visibleAxis === axis),
  );
  if (
    hiddenAxis !== undefined &&
    max[hiddenAxis] - min[hiddenAxis] < gridSize
  ) {
    max[hiddenAxis] = min[hiddenAxis] + gridSize;
  }
  if (equalVisibleAxes) {
    const size = Math.max(
      ...visibleAxes.map((axis) => Math.abs(second[axis] - first[axis])),
    );
    for (const axis of visibleAxes) {
      const target = first[axis] + (second[axis] < first[axis] ? -size : size);
      min[axis] = Math.min(first[axis], target);
      max[axis] = Math.max(first[axis], target);
    }
  }
  if (kind === "perspective" && equalAllAxes) {
    const size = Math.max(max[0] - min[0], max[1] - min[1], gridSize);
    min[2] = first[2];
    max[2] = first[2] + size;
  }
  if (visibleAxes.some((axis) => max[axis] - min[axis] < gridSize)) return null;
  return { min, max };
}

export function constructionPlane(
  kind: EditorViewportKind,
  coordinate = 0,
): {
  readonly point: Vec3;
  readonly normal: Vec3;
} {
  if (kind === "xz") return { point: [0, coordinate, 0], normal: [0, 1, 0] };
  if (kind === "yz") return { point: [coordinate, 0, 0], normal: [1, 0, 0] };
  return { point: [0, 0, coordinate], normal: [0, 0, 1] };
}
