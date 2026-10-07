import { cross } from "./math.js";
import type { TransformAxis } from "./document.js";
import type { EntityDefinitionCatalog } from "./entity-definitions.js";
import type {
  Bounds,
  EntityId,
  MapDocument,
  MapEntity,
  Vec3,
} from "./types.js";

export interface PointEntityDefinition {
  readonly classname: string;
  readonly label: string;
  readonly bounds: Bounds;
  readonly defaults?: Readonly<Record<string, string>>;
  readonly color?: readonly [number, number, number];
  readonly sprite?: string;
}

const SMALL_POINT_BOUNDS: Bounds = { min: [-8, -8, -8], max: [8, 8, 8] };
const STANDARD_POINT_BOUNDS: Bounds = {
  min: [-16, -16, -16],
  max: [16, 16, 16],
};
const PLAYER_BOUNDS: Bounds = { min: [-16, -16, -24], max: [16, 16, 32] };

export const BUILTIN_POINT_ENTITY_DEFINITIONS: readonly PointEntityDefinition[] =
  [
    {
      classname: "light",
      label: "Light",
      bounds: SMALL_POINT_BOUNDS,
      defaults: { light: "300" },
    },
    {
      classname: "info_player_start",
      label: "Player start",
      bounds: PLAYER_BOUNDS,
      defaults: { angle: "0" },
    },
    {
      classname: "info_player_deathmatch",
      label: "Deathmatch start",
      bounds: PLAYER_BOUNDS,
      defaults: { angle: "0" },
    },
    { classname: "info_null", label: "Info null", bounds: SMALL_POINT_BOUNDS },
    {
      classname: "info_target",
      label: "Info target",
      bounds: SMALL_POINT_BOUNDS,
    },
    {
      classname: "ambient_generic",
      label: "Ambient sound (GoldSrc)",
      bounds: SMALL_POINT_BOUNDS,
      defaults: { message: "" },
    },
  ] as const;

export function pointEntityDefinition(
  classname: string,
  catalog?: EntityDefinitionCatalog,
): PointEntityDefinition {
  const catalogDefinition = catalog?.find(classname);
  if (catalogDefinition?.kind === "point") {
    return {
      classname: catalogDefinition.classname,
      label: catalogDefinition.label,
      bounds: catalogDefinition.bounds ?? STANDARD_POINT_BOUNDS,
      defaults: Object.fromEntries(
        catalogDefinition.properties.flatMap((property) =>
          property.defaultValue === undefined
            ? []
            : [[property.key, property.defaultValue]],
        ),
      ),
      ...(catalogDefinition.color ? { color: catalogDefinition.color } : {}),
      ...(catalogDefinition.sprite ? { sprite: catalogDefinition.sprite } : {}),
    };
  }
  return (
    BUILTIN_POINT_ENTITY_DEFINITIONS.find(
      (definition) =>
        definition.classname.toLowerCase() === classname.trim().toLowerCase(),
    ) ?? {
      classname: classname.trim(),
      label: classname.trim() || "Custom point entity",
      bounds: STANDARD_POINT_BOUNDS,
    }
  );
}

export function parseEntityOrigin(entity: MapEntity): Vec3 | null {
  const components = entity.properties.origin?.trim().split(/\s+/).map(Number);
  return components?.length === 3 && components.every(Number.isFinite)
    ? ([components[0]!, components[1]!, components[2]!] as const)
    : null;
}

function formatCoordinate(value: number): string {
  const normalized = Math.abs(value) <= 1e-9 ? 0 : value;
  return Number(normalized.toFixed(6)).toString();
}

function parseAngles(
  value: string | undefined,
): [number, number, number] | null {
  const components = value?.trim().split(/\s+/).map(Number);
  return components?.length === 3 && components.every(Number.isFinite)
    ? [components[0]!, components[1]!, components[2]!]
    : null;
}

function formatAngles(angles: readonly [number, number, number]): string {
  return angles.map(formatCoordinate).join(" ");
}

function normalizeHeading(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export type PointEntityTransformMatrix = readonly [Vec3, Vec3, Vec3];
type Matrix3 = PointEntityTransformMatrix;

type EntityOrientation =
  | {
      readonly kind: "angle";
      readonly key: "angle";
      readonly value: number;
    }
  | {
      readonly kind: "euler" | "mangle";
      readonly key: "angles" | "mangle";
      readonly value: [number, number, number];
    };

function entityOrientation(entity: MapEntity): EntityOrientation | null {
  const classname = entity.properties.classname?.trim().toLowerCase() ?? "";
  const mangle = parseAngles(entity.properties.mangle);
  if (classname.startsWith("light") && mangle) {
    return { kind: "mangle", key: "mangle", value: mangle };
  }
  const angles = parseAngles(entity.properties.angles);
  if (angles) return { kind: "euler", key: "angles", value: angles };
  if (mangle) return { kind: "euler", key: "mangle", value: mangle };
  const angle = Number(entity.properties.angle);
  return Number.isFinite(angle)
    ? { kind: "angle", key: "angle", value: angle }
    : null;
}

function multiplyMatrixVector(matrix: Matrix3, vector: Vec3): Vec3 {
  const multiplyRow = (row: Vec3) =>
    row[0] * vector[0] + row[1] * vector[1] + row[2] * vector[2];
  return [
    multiplyRow(matrix[0]),
    multiplyRow(matrix[1]),
    multiplyRow(matrix[2]),
  ];
}

function multiplyMatrices(left: Matrix3, right: Matrix3): Matrix3 {
  const cell = (row: 0 | 1 | 2, column: 0 | 1 | 2) =>
    left[row][0] * right[0][column] +
    left[row][1] * right[1][column] +
    left[row][2] * right[2][column];
  return [
    [cell(0, 0), cell(0, 1), cell(0, 2)],
    [cell(1, 0), cell(1, 1), cell(1, 2)],
    [cell(2, 0), cell(2, 1), cell(2, 2)],
  ];
}

function normalizeVector(vector: Vec3): Vec3 {
  const length = Math.hypot(...vector);
  if (length <= 1e-9)
    throw new Error("Point entity orientation collapsed during transform");
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function matrixColumn(matrix: Matrix3, column: 0 | 1 | 2): Vec3 {
  return [matrix[0][column], matrix[1][column], matrix[2][column]];
}

function matrixFromColumns(x: Vec3, y: Vec3, z: Vec3): Matrix3 {
  return [
    [x[0], y[0], z[0]],
    [x[1], y[1], z[1]],
    [x[2], y[2], z[2]],
  ];
}

function rotationMatrix(axis: TransformAxis, degrees: number): Matrix3 {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return axis === 0
    ? [
        [1, 0, 0],
        [0, cosine, -sine],
        [0, sine, cosine],
      ]
    : axis === 1
      ? [
          [cosine, 0, sine],
          [0, 1, 0],
          [-sine, 0, cosine],
        ]
      : [
          [cosine, -sine, 0],
          [sine, cosine, 0],
          [0, 0, 1],
        ];
}

function flipMatrix(axis: TransformAxis): Matrix3 {
  const factors: [number, number, number] = [1, 1, 1];
  factors[axis] = -1;
  return [
    [factors[0], 0, 0],
    [0, factors[1], 0],
    [0, 0, factors[2]],
  ];
}

function transformOrigin(origin: Vec3, pivot: Vec3, matrix: Matrix3): Vec3 {
  const relative: Vec3 = [
    origin[0] - pivot[0],
    origin[1] - pivot[1],
    origin[2] - pivot[2],
  ];
  const transformed = multiplyMatrixVector(matrix, relative);
  return [
    transformed[0] + pivot[0],
    transformed[1] + pivot[1],
    transformed[2] + pivot[2],
  ];
}

function eulerMatrix(
  rollDegrees: number,
  pitchDegrees: number,
  yawDegrees: number,
): Matrix3 {
  const roll = (rollDegrees * Math.PI) / 180;
  const pitch = (pitchDegrees * Math.PI) / 180;
  const yaw = (yawDegrees * Math.PI) / 180;
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  return [
    [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
    [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
    [-sp, cp * sr, cp * cr],
  ];
}

function eulerDegrees(matrix: Matrix3): [number, number, number] {
  const pitch = Math.asin(Math.max(-1, Math.min(1, -matrix[2][0])));
  const cosine = Math.cos(pitch);
  const roll =
    Math.abs(cosine) > 1e-8 ? Math.atan2(matrix[2][1], matrix[2][2]) : 0;
  const yaw =
    Math.abs(cosine) > 1e-8
      ? Math.atan2(matrix[1][0], matrix[0][0])
      : Math.atan2(-matrix[0][1], matrix[1][1]);
  return [roll, pitch, yaw].map((value) => (value * 180) / Math.PI) as [
    number,
    number,
    number,
  ];
}

function applyOrientationTransform(
  entity: MapEntity,
  transformation: Matrix3,
): Readonly<Record<string, string>> {
  const orientation = entityOrientation(entity);
  if (!orientation) return {};
  if (orientation.kind === "angle") {
    const radians = (orientation.value * Math.PI) / 180;
    const direction: Vec3 =
      orientation.value === -1
        ? [0, 0, 1]
        : orientation.value === -2
          ? [0, 0, -1]
          : [Math.cos(radians), Math.sin(radians), 0];
    const transformed = normalizeVector(
      multiplyMatrixVector(transformation, direction),
    );
    if (transformed[2] > 0.9) return { [orientation.key]: "-1" };
    if (transformed[2] < -0.9) return { [orientation.key]: "-2" };
    const heading = normalizeHeading(
      (Math.atan2(transformed[1], transformed[0]) * 180) / Math.PI,
    );
    return { [orientation.key]: formatCoordinate(heading) };
  }

  const [first, second, roll] = orientation.value;
  const yaw = orientation.kind === "mangle" ? first : second;
  const pitch = orientation.kind === "mangle" ? -second : first;
  const composed = multiplyMatrices(
    transformation,
    eulerMatrix(roll, pitch, yaw),
  );
  const positiveX = normalizeVector(matrixColumn(composed, 0));
  const transformedPositiveZ = normalizeVector(matrixColumn(composed, 2));
  const positiveY = normalizeVector(cross(transformedPositiveZ, positiveX));
  const positiveZ = normalizeVector(cross(positiveX, positiveY));
  const [newRoll, newPitch, newYaw] = eulerDegrees(
    matrixFromColumns(positiveX, positiveY, positiveZ),
  );
  const value: [number, number, number] =
    orientation.kind === "mangle"
      ? [newYaw, -newPitch, newRoll]
      : [newPitch, newYaw, newRoll];
  return { [orientation.key]: formatAngles(value) };
}

function replaceEntityProperties(
  entity: MapEntity,
  properties: Readonly<Record<string, string>>,
): MapEntity {
  return { ...entity, properties: { ...entity.properties, ...properties } };
}

export function formatEntityOrigin(origin: Vec3): string {
  if (!origin.every(Number.isFinite))
    throw new Error("Point entity origin must be finite");
  return origin.map(formatCoordinate).join(" ");
}

/** Returns the horizontal model heading described by TrenchBroom's Quake entity rules. */
export function pointEntityYawDegrees(entity: MapEntity): number | null {
  const orientation = entityOrientation(entity);
  if (!orientation) return null;
  if (orientation.kind === "angle") {
    return orientation.value === -1 || orientation.value === -2
      ? null
      : normalizeHeading(orientation.value);
  }
  return normalizeHeading(
    orientation.kind === "mangle" ? orientation.value[0] : orientation.value[1],
  );
}

/** Applies a general invertible affine transform to a point entity and its supported heading. */
export function transformPointEntityAffine(
  entity: MapEntity,
  linear: PointEntityTransformMatrix,
  translation: Vec3,
  updateAngles = true,
): MapEntity {
  if (![...linear.flat(), ...translation].every(Number.isFinite)) {
    throw new Error("Point entity affine transform values must be finite");
  }
  const origin = parseEntityOrigin(entity);
  if (!origin || entity.primitives.length > 0) {
    throw new Error(`Entity ${entity.id} is not a point entity`);
  }
  const transformedOrigin = multiplyMatrixVector(linear, origin);
  const properties: Record<string, string> = {
    origin: formatEntityOrigin([
      transformedOrigin[0] + translation[0],
      transformedOrigin[1] + translation[1],
      transformedOrigin[2] + translation[2],
    ]),
  };
  if (updateAngles)
    Object.assign(properties, applyOrientationTransform(entity, linear));
  return replaceEntityProperties(entity, properties);
}

/** Rotates a point entity's origin and, optionally, its supported orientation property. */
export function rotatePointEntity(
  entity: MapEntity,
  pivot: Vec3,
  axis: TransformAxis,
  degrees: number,
  updateAngles = true,
): MapEntity {
  if (![...pivot, degrees].every(Number.isFinite)) {
    throw new Error("Point entity rotation values must be finite");
  }
  const origin = parseEntityOrigin(entity);
  if (!origin || entity.primitives.length > 0)
    throw new Error(`Entity ${entity.id} is not a point entity`);
  const relativeBounds = pointEntityDefinition(
    entity.properties.classname ?? "",
  ).bounds;
  if (
    Math.abs(relativeBounds.min[0] + relativeBounds.max[0]) > 1e-9 ||
    Math.abs(relativeBounds.min[1] + relativeBounds.max[1]) > 1e-9
  ) {
    throw new Error(
      `Point entity ${entity.id} cannot rotate because its bounds are not centered in XY`,
    );
  }
  const properties: Record<string, string> = {
    origin: formatEntityOrigin(
      transformOrigin(origin, pivot, rotationMatrix(axis, degrees)),
    ),
  };
  if (updateAngles) {
    Object.assign(
      properties,
      applyOrientationTransform(entity, rotationMatrix(axis, degrees)),
    );
  }
  return replaceEntityProperties(entity, properties);
}

/** Mirrors a point entity about an axis-aligned plane and adapts its horizontal heading. */
export function flipPointEntity(
  entity: MapEntity,
  pivot: Vec3,
  axis: TransformAxis,
  updateAngles = true,
): MapEntity {
  if (!pivot.every(Number.isFinite))
    throw new Error("Point entity flip pivot must be finite");
  const origin = parseEntityOrigin(entity);
  if (!origin || entity.primitives.length > 0)
    throw new Error(`Entity ${entity.id} is not a point entity`);
  const transformation = flipMatrix(axis);
  const properties: Record<string, string> = {
    origin: formatEntityOrigin(transformOrigin(origin, pivot, transformation)),
  };
  if (updateAngles)
    Object.assign(
      properties,
      applyOrientationTransform(entity, transformation),
    );
  return replaceEntityProperties(entity, properties);
}

export function pointEntityBounds(
  entity: MapEntity,
  catalog?: EntityDefinitionCatalog,
): Bounds | null {
  if (entity.primitives.length > 0) return null;
  const origin = parseEntityOrigin(entity);
  if (!origin) return null;
  const relative = pointEntityDefinition(
    entity.properties.classname ?? "",
    catalog,
  ).bounds;
  return {
    min: [
      origin[0] + relative.min[0],
      origin[1] + relative.min[1],
      origin[2] + relative.min[2],
    ],
    max: [
      origin[0] + relative.max[0],
      origin[1] + relative.max[1],
      origin[2] + relative.max[2],
    ],
  };
}

export function pointEntitiesInDocument(
  document: MapDocument,
  catalog?: EntityDefinitionCatalog,
): readonly MapEntity[] {
  return document.entities.filter(
    (entity) => pointEntityBounds(entity, catalog) !== null,
  );
}

export interface PointEntityRayHit {
  readonly entityId: EntityId;
  readonly distance: number;
  readonly point: Vec3;
}

export function intersectPointEntityRay(
  entity: MapEntity,
  origin: Vec3,
  direction: Vec3,
  catalog?: EntityDefinitionCatalog,
): PointEntityRayHit | null {
  const bounds = pointEntityBounds(entity, catalog);
  if (!bounds) return null;
  let enter = 0;
  let exit = Number.POSITIVE_INFINITY;
  for (const axis of [0, 1, 2] as const) {
    if (Math.abs(direction[axis]) <= 1e-9) {
      if (origin[axis] < bounds.min[axis] || origin[axis] > bounds.max[axis])
        return null;
      continue;
    }
    const first = (bounds.min[axis] - origin[axis]) / direction[axis];
    const second = (bounds.max[axis] - origin[axis]) / direction[axis];
    enter = Math.max(enter, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
    if (enter > exit) return null;
  }
  if (exit < 0) return null;
  const distance = Math.max(0, enter);
  return {
    entityId: entity.id,
    distance,
    point: [
      origin[0] + direction[0] * distance,
      origin[1] + direction[1] * distance,
      origin[2] + direction[2] * distance,
    ],
  };
}
