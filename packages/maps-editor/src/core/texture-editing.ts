import { deriveBrush, textureCoordinates } from "./geometry.js";
import {
  add,
  cross,
  dot,
  normalize,
  planeFromPoints,
  rotateAroundAxis,
  scale,
  subtract,
} from "./math.js";
import { defaultTextureProjection } from "./document-structure.js";
import type {
  BrushId,
  FaceId,
  MapBrush,
  MapFace,
  TextureProjection,
  Vec2,
  Vec3,
} from "./types.js";

export function setBrushMaterial(
  brush: MapBrush,
  material: string,
  faceId?: FaceId,
): MapBrush {
  return setBrushFaceMaterials(brush, material, faceId ? [faceId] : undefined);
}

export function setBrushFaceMaterials(
  brush: MapBrush,
  material: string,
  faceIds?: readonly FaceId[],
): MapBrush {
  const normalized = material.trim();
  if (normalized.length === 0 || /\s/.test(normalized)) {
    throw new Error(
      "A map material name must be a non-empty token without whitespace",
    );
  }
  const selected = faceIds ? new Set(faceIds) : null;
  for (const faceId of selected ?? []) {
    if (!brush.faces.some((face) => face.id === faceId)) {
      throw new Error(`Unknown face ${faceId} on brush ${brush.id}`);
    }
  }
  return {
    ...brush,
    revision: brush.revision + 1,
    faces: brush.faces.map((face) =>
      !selected || selected.has(face.id)
        ? { ...face, material: normalized }
        : face,
    ),
  };
}

export interface FaceTextureTransform {
  readonly offset: readonly [number, number];
  readonly rotationDegrees: number;
  readonly scale: readonly [number, number];
}

export interface FaceTextureTransformDelta {
  /** Relative translation in texture-space texels. */
  readonly offset: readonly [number, number];
  /** Relative in-plane rotation around the supplied world-space pivot. */
  readonly rotationDegrees: number;
  /** Multipliers applied to the existing Valve 220 U and V scales. */
  readonly scale: readonly [number, number];
}

export function setFaceTextureTransform(
  brush: MapBrush,
  faceId: FaceId,
  transform: FaceTextureTransform,
): MapBrush {
  const face = brush.faces.find((candidate) => candidate.id === faceId);
  if (!face) throw new Error(`Unknown face ${faceId} on brush ${brush.id}`);
  const values = [
    ...transform.offset,
    transform.rotationDegrees,
    ...transform.scale,
  ];
  if (!values.every(Number.isFinite))
    throw new Error("Texture transform values must be finite");
  if (transform.scale.some((value) => Math.abs(value) <= 1e-6)) {
    throw new Error("Texture scale cannot be zero");
  }
  const plane = planeFromPoints(face.planePoints);
  if (!plane) throw new Error(`Cannot transform the degenerate face ${faceId}`);
  const rotationDelta =
    ((transform.rotationDegrees - face.projection.rotationDegrees) * Math.PI) /
    180;
  return {
    ...brush,
    revision: brush.revision + 1,
    faces: brush.faces.map((candidate) =>
      candidate.id === faceId
        ? {
            ...candidate,
            projection: {
              ...candidate.projection,
              uAxis: rotateAroundAxis(
                candidate.projection.uAxis,
                plane.normal,
                rotationDelta,
              ),
              vAxis: rotateAroundAxis(
                candidate.projection.vAxis,
                plane.normal,
                rotationDelta,
              ),
              offset: transform.offset,
              rotationDegrees: transform.rotationDegrees,
              scale: transform.scale,
            },
          }
        : candidate,
    ),
  };
}

/** Applies a relative Valve 220 transform while preserving the pivot's UV coordinates. */
export function transformFaceTexture(
  brush: MapBrush,
  faceId: FaceId,
  transform: FaceTextureTransformDelta,
  pivot: Vec3,
): MapBrush {
  const face = brush.faces.find((candidate) => candidate.id === faceId);
  if (!face) throw new Error(`Unknown face ${faceId} on brush ${brush.id}`);
  const values = [
    ...transform.offset,
    transform.rotationDegrees,
    ...transform.scale,
    ...pivot,
  ];
  if (!values.every(Number.isFinite))
    throw new Error("Texture transform values must be finite");
  if (transform.scale.some((value) => Math.abs(value) <= 1e-6)) {
    throw new Error("Texture scale multiplier cannot be zero");
  }
  const plane = planeFromPoints(face.planePoints);
  if (!plane) throw new Error(`Cannot transform the degenerate face ${faceId}`);
  const angle = (transform.rotationDegrees * Math.PI) / 180;
  const uAxis = rotateAroundAxis(face.projection.uAxis, plane.normal, angle);
  const vAxis = rotateAroundAxis(face.projection.vAxis, plane.normal, angle);
  const scaleU = face.projection.scale[0] * transform.scale[0];
  const scaleV = face.projection.scale[1] * transform.scale[1];
  if (Math.abs(scaleU) <= 1e-6 || Math.abs(scaleV) <= 1e-6) {
    throw new Error("Texture scale cannot be zero");
  }
  const pivotCoordinates = textureCoordinates(face, pivot);
  const projection: TextureProjection = {
    ...face.projection,
    uAxis,
    vAxis,
    offset: [
      pivotCoordinates[0] + transform.offset[0] - dot(pivot, uAxis) / scaleU,
      pivotCoordinates[1] + transform.offset[1] - dot(pivot, vAxis) / scaleV,
    ],
    rotationDegrees:
      face.projection.rotationDegrees + transform.rotationDegrees,
    scale: [scaleU, scaleV],
  };
  return {
    ...brush,
    revision: brush.revision + 1,
    faces: brush.faces.map((candidate) =>
      candidate.id === faceId ? { ...candidate, projection } : candidate,
    ),
  };
}

export type FaceTextureAlignmentOperation =
  | "reset"
  | "world"
  | "flip-u"
  | "flip-v"
  | "rotate-ccw"
  | "rotate-cw"
  | "align-edge"
  | "justify-u-min"
  | "justify-u-max"
  | "justify-v-min"
  | "justify-v-max"
  | "fit-u"
  | "fit-v"
  | "auto-fit";

export type FaceTextureFitMode = "repeat" | "subdivide";

export interface FaceTextureAlignmentOptions {
  /** Texture dimensions in texels; required by justify and fit operations. */
  readonly textureSize?: Vec2;
  /** Per-material dimensions for selections containing several materials. */
  readonly textureSizeForMaterial?: (material: string) => Vec2 | null;
  /** Reverses edge, atlas slot, repeat, or subdivision cycling. */
  readonly direction?: 1 | -1;
  /** Ctrl/Command-style fit mode showing 1/n of a texture instead of n repeats. */
  readonly fitMode?: FaceTextureFitMode;
}

function parallelTextureProjection(normal: Vec3): TextureProjection {
  const fallback = defaultTextureProjection(normal);
  const projectedU: Vec3 = [
    fallback.uAxis[0] - normal[0] * dot(fallback.uAxis, normal),
    fallback.uAxis[1] - normal[1] * dot(fallback.uAxis, normal),
    fallback.uAxis[2] - normal[2] * dot(fallback.uAxis, normal),
  ];
  const uAxis = normalize(projectedU) ??
    normalize(cross([0, 0, 1], normal)) ?? [1, 0, 0];
  let vAxis = normalize(cross(normal, uAxis)) ?? [0, 1, 0];
  if (dot(vAxis, fallback.vAxis) < 0) vAxis = [-vAxis[0], -vAxis[1], -vAxis[2]];
  return {
    kind: "valve-220",
    uAxis,
    vAxis,
    offset: [0, 0],
    rotationDegrees: 0,
    scale: [1, 1],
  };
}

interface TextureBounds {
  readonly min: Vec2;
  readonly max: Vec2;
}

function textureBounds(
  face: MapFace,
  vertices: readonly Vec3[],
  projection: TextureProjection,
): TextureBounds {
  const projectedFace = { ...face, projection };
  const coordinates = vertices.map((vertex) =>
    textureCoordinates(projectedFace, vertex),
  );
  return {
    min: [
      Math.min(...coordinates.map((coordinate) => coordinate[0])),
      Math.min(...coordinates.map((coordinate) => coordinate[1])),
    ],
    max: [
      Math.max(...coordinates.map((coordinate) => coordinate[0])),
      Math.max(...coordinates.map((coordinate) => coordinate[1])),
    ],
  };
}

function faceCenter(vertices: readonly Vec3[]): Vec3 {
  return scale(
    vertices.reduce<Vec3>((sum, vertex) => add(sum, vertex), [0, 0, 0]),
    1 / vertices.length,
  );
}

function rotateProjectionOnFace(
  face: MapFace,
  vertices: readonly Vec3[],
  normal: Vec3,
  projection: TextureProjection,
  angle: number,
): TextureProjection {
  const center = faceCenter(vertices);
  const centerCoordinates = textureCoordinates({ ...face, projection }, center);
  const uAxis = rotateAroundAxis(projection.uAxis, normal, angle);
  const vAxis = rotateAroundAxis(projection.vAxis, normal, angle);
  const scaleU =
    Math.abs(projection.scale[0]) <= Number.EPSILON ? 1 : projection.scale[0];
  const scaleV =
    Math.abs(projection.scale[1]) <= Number.EPSILON ? 1 : projection.scale[1];
  return {
    ...projection,
    uAxis,
    vAxis,
    offset: [
      centerCoordinates[0] - dot(center, uAxis) / scaleU,
      centerCoordinates[1] - dot(center, vAxis) / scaleV,
    ],
    rotationDegrees: projection.rotationDegrees + (angle * 180) / Math.PI,
  };
}

function edgeAlignmentAngle(
  vertices: readonly Vec3[],
  normal: Vec3,
  projection: TextureProjection,
  direction: 1 | -1,
  cycle: boolean,
): number {
  const projectedU = subtract(
    projection.uAxis,
    scale(normal, dot(projection.uAxis, normal)),
  );
  const current = normalize(projectedU);
  if (!current) throw new Error("Cannot align a degenerate texture axis");
  const angles: number[] = [];
  for (let index = 0; index < vertices.length; index += 1) {
    const edge = normalize(
      subtract(vertices[(index + 1) % vertices.length]!, vertices[index]!),
    );
    if (!edge) continue;
    const raw = Math.atan2(
      dot(normal, cross(current, edge)),
      dot(current, edge),
    );
    if (!angles.some((candidate) => Math.abs(candidate - raw) <= 1e-6))
      angles.push(raw);
  }
  if (angles.length === 0) throw new Error("Cannot align a face without edges");
  if (!cycle)
    return angles.toSorted(
      (left, right) => Math.abs(left) - Math.abs(right),
    )[0]!;
  const directed = angles.map((angle) => {
    if (direction > 0) return angle > 1e-6 ? angle : angle + Math.PI * 2;
    return angle < -1e-6 ? angle : angle - Math.PI * 2;
  });
  return directed.toSorted(
    (left, right) => Math.abs(left) - Math.abs(right),
  )[0]!;
}

function requireTextureSize(
  face: MapFace,
  options: FaceTextureAlignmentOptions,
): Vec2 {
  const size =
    options.textureSize ?? options.textureSizeForMaterial?.(face.material);
  if (
    !size ||
    size.some((component) => !Number.isFinite(component) || component <= 0)
  ) {
    throw new Error(
      `Texture dimensions for ${face.material} are required for this operation`,
    );
  }
  return size;
}

function wrapIndex(index: number, count: number): number {
  return ((index % count) + count) % count;
}

function justifyProjection(
  face: MapFace,
  vertices: readonly Vec3[],
  projection: TextureProjection,
  axis: 0 | 1,
  side: "min" | "max",
  textureDimension: number,
  direction: 1 | -1,
): TextureProjection {
  const bounds = textureBounds(face, vertices, projection);
  const span = bounds.max[axis] - bounds.min[axis];
  const current = bounds[side][axis];
  let target = side === "min" ? 0 : textureDimension;
  const slotCount = Math.max(1, Math.round(textureDimension / span));
  if (
    slotCount > 1 &&
    Number.isFinite(span) &&
    span > Number.EPSILON &&
    Math.abs(slotCount * span - textureDimension) <= 1e-5
  ) {
    const targets = Array.from({ length: slotCount }, (_, index) =>
      side === "min" ? index * span : textureDimension - index * span,
    );
    const currentIndex = targets.findIndex(
      (candidate) => Math.abs(candidate - current) <= 1e-5,
    );
    const nextIndex =
      currentIndex < 0
        ? direction > 0
          ? 0
          : targets.length - 1
        : wrapIndex(currentIndex + direction, targets.length);
    target = targets[nextIndex]!;
  }
  const offset = [...projection.offset] as [number, number];
  offset[axis] += target - current;
  return { ...projection, offset };
}

function fitProjectionToSpan(
  face: MapFace,
  vertices: readonly Vec3[],
  projection: TextureProjection,
  axis: 0 | 1,
  targetTexelSpan: number,
  textureDimension: number,
  anchorToMinimum = false,
): TextureProjection {
  const sourceAxis = axis === 0 ? projection.uAxis : projection.vAxis;
  const projected = vertices.map((vertex) => dot(vertex, sourceAxis));
  const worldSpan = Math.max(...projected) - Math.min(...projected);
  if (!Number.isFinite(worldSpan) || worldSpan <= Number.EPSILON) {
    throw new Error("Cannot fit a degenerate face texture axis");
  }
  const oldBounds = textureBounds(face, vertices, projection);
  const sign = projection.scale[axis] < 0 ? -1 : 1;
  const scaleValue = (sign * worldSpan) / targetTexelSpan;
  const nextScale = [...projection.scale] as [number, number];
  nextScale[axis] = scaleValue;
  const scaled: TextureProjection = { ...projection, scale: nextScale };
  const nextBounds = textureBounds(face, vertices, scaled);
  const offset = [...scaled.offset] as [number, number];
  if (anchorToMinimum) {
    offset[axis] -= nextBounds.min[axis];
  } else {
    const minimumAnchor =
      Math.round(oldBounds.min[axis] / textureDimension) * textureDimension;
    const maximumAnchor =
      Math.round(oldBounds.max[axis] / textureDimension) * textureDimension;
    const useMinimum =
      Math.abs(oldBounds.min[axis] - minimumAnchor) <=
      Math.abs(oldBounds.max[axis] - maximumAnchor);
    offset[axis] += useMinimum
      ? minimumAnchor - nextBounds.min[axis]
      : maximumAnchor - nextBounds.max[axis];
  }
  return { ...scaled, offset };
}

function fitProjection(
  face: MapFace,
  vertices: readonly Vec3[],
  projection: TextureProjection,
  axis: 0 | 1,
  textureDimension: number,
  options: FaceTextureAlignmentOptions,
): TextureProjection {
  const bounds = textureBounds(face, vertices, projection);
  const ratio = (bounds.max[axis] - bounds.min[axis]) / textureDimension;
  const direction = options.direction ?? 1;
  if (options.fitMode === "subdivide") {
    const current =
      ratio > Number.EPSILON && ratio <= 1 + 1e-5 ? Math.round(1 / ratio) : 0;
    const count = Math.max(
      1,
      current > 0 && Math.abs(1 / ratio - current) <= 1e-5
        ? current + direction
        : 1,
    );
    return fitProjectionToSpan(
      face,
      vertices,
      projection,
      axis,
      textureDimension / count,
      textureDimension,
    );
  }
  const current = ratio >= 1 - 1e-5 ? Math.round(ratio) : 0;
  const count = Math.max(
    1,
    current > 0 && Math.abs(ratio - current) <= 1e-5 ? current + direction : 1,
  );
  return fitProjectionToSpan(
    face,
    vertices,
    projection,
    axis,
    textureDimension * count,
    textureDimension,
  );
}

export function alignFaceTexture(
  brush: MapBrush,
  faceId: FaceId,
  operation: FaceTextureAlignmentOperation,
  options: FaceTextureAlignmentOptions = {},
): MapBrush {
  const face = brush.faces.find((candidate) => candidate.id === faceId);
  if (!face) throw new Error(`Unknown face ${faceId} on brush ${brush.id}`);
  const plane = planeFromPoints(face.planePoints);
  if (!plane) throw new Error(`Cannot align the degenerate face ${faceId}`);
  let projection: TextureProjection;
  if (operation === "reset")
    projection = parallelTextureProjection(plane.normal);
  else if (operation === "world")
    projection = defaultTextureProjection(plane.normal);
  else if (operation === "flip-u" || operation === "flip-v") {
    projection = {
      ...face.projection,
      scale:
        operation === "flip-u"
          ? [-face.projection.scale[0], face.projection.scale[1]]
          : [face.projection.scale[0], -face.projection.scale[1]],
    };
  } else if (operation === "rotate-ccw" || operation === "rotate-cw") {
    const delta = operation === "rotate-ccw" ? Math.PI / 2 : -Math.PI / 2;
    projection = {
      ...face.projection,
      uAxis: rotateAroundAxis(face.projection.uAxis, plane.normal, delta),
      vAxis: rotateAroundAxis(face.projection.vAxis, plane.normal, delta),
      rotationDegrees:
        face.projection.rotationDegrees +
        (operation === "rotate-ccw" ? 90 : -90),
    };
  } else {
    const vertices = deriveBrush(brush).faces.find(
      (candidate) => candidate.faceId === faceId,
    )?.vertices;
    if (!vertices || vertices.length < 3)
      throw new Error(`Cannot align the invalid face ${faceId}`);
    if (operation === "align-edge") {
      const angle = edgeAlignmentAngle(
        vertices,
        plane.normal,
        face.projection,
        options.direction ?? 1,
        true,
      );
      projection = rotateProjectionOnFace(
        face,
        vertices,
        plane.normal,
        face.projection,
        angle,
      );
    } else {
      const textureSize = requireTextureSize(face, options);
      if (operation.startsWith("justify-")) {
        const axis = operation.includes("-u-") ? 0 : 1;
        projection = justifyProjection(
          face,
          vertices,
          face.projection,
          axis,
          operation.endsWith("-min") ? "min" : "max",
          textureSize[axis],
          options.direction ?? 1,
        );
      } else if (operation === "fit-u" || operation === "fit-v") {
        const axis = operation === "fit-u" ? 0 : 1;
        projection = fitProjection(
          face,
          vertices,
          face.projection,
          axis,
          textureSize[axis],
          options,
        );
      } else {
        const angle = edgeAlignmentAngle(
          vertices,
          plane.normal,
          face.projection,
          options.direction ?? 1,
          false,
        );
        projection = rotateProjectionOnFace(
          face,
          vertices,
          plane.normal,
          face.projection,
          angle,
        );
        projection = fitProjectionToSpan(
          face,
          vertices,
          projection,
          0,
          textureSize[0],
          textureSize[0],
          true,
        );
        projection = fitProjectionToSpan(
          face,
          vertices,
          projection,
          1,
          textureSize[1],
          textureSize[1],
          true,
        );
      }
    }
  }
  return {
    ...brush,
    revision: brush.revision + 1,
    faces: brush.faces.map((candidate) =>
      candidate.id === faceId ? { ...candidate, projection } : candidate,
    ),
  };
}

export type FaceAttributeTransferMode = "project" | "rotate" | "material";

/** The authored face data needed for material and projection transfer; runtime IDs are irrelevant. */
export type FaceAttributeSource = Pick<
  MapFace,
  "planePoints" | "material" | "projection" | "surface"
>;

function rotatedProjectionOntoFace(
  source: FaceAttributeSource,
  target: MapFace,
): TextureProjection {
  const sourcePlane = planeFromPoints(source.planePoints);
  const targetPlane = planeFromPoints(target.planePoints);
  if (!sourcePlane || !targetPlane)
    throw new Error("Cannot transfer from a degenerate face");
  const alignment = Math.max(
    -1,
    Math.min(1, dot(sourcePlane.normal, targetPlane.normal)),
  );
  let axis = normalize(cross(sourcePlane.normal, targetPlane.normal));
  let angle = Math.acos(alignment);
  if (!axis) {
    if (alignment >= 0) {
      axis = source.projection.uAxis;
      angle = 0;
    } else {
      axis = normalize(source.projection.uAxis) ?? [1, 0, 0];
      angle = Math.PI;
    }
  }
  return {
    ...source.projection,
    uAxis: rotateAroundAxis(source.projection.uAxis, axis, angle),
    vAxis: rotateAroundAxis(source.projection.vAxis, axis, angle),
    offset: [...source.projection.offset] as readonly [number, number],
    scale: [...source.projection.scale] as readonly [number, number],
  };
}

/** Transfers material and optional Valve 220 face attributes while preserving target contents. */
export function transferFaceAttributes(
  brush: MapBrush,
  faceId: FaceId,
  source: FaceAttributeSource,
  mode: FaceAttributeTransferMode,
): MapBrush {
  const target = brush.faces.find((face) => face.id === faceId);
  if (!target) throw new Error(`Unknown face ${faceId} on brush ${brush.id}`);
  const sourceSurface = { ...source.surface };
  delete sourceSurface.contents;
  const targetContents =
    target.surface.contents === undefined
      ? {}
      : { contents: target.surface.contents };
  const projection =
    mode === "material"
      ? target.projection
      : mode === "rotate"
        ? rotatedProjectionOntoFace(source, target)
        : {
            ...source.projection,
            uAxis: [...source.projection.uAxis] as Vec3,
            vAxis: [...source.projection.vAxis] as Vec3,
            offset: [...source.projection.offset] as readonly [number, number],
            scale: [...source.projection.scale] as readonly [number, number],
          };
  return {
    ...brush,
    revision: brush.revision + 1,
    faces: brush.faces.map((face) =>
      face.id === faceId
        ? {
            ...face,
            material: source.material,
            projection,
            surface:
              mode === "material"
                ? face.surface
                : { ...sourceSurface, ...targetContents },
          }
        : face,
    ),
  };
}

export type { BrushId, FaceId };
