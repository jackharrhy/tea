import type {
  MapBrush,
  MapBrushDef,
  MapDocument,
  MapEntity,
  MapFace,
  MapPatch,
  MapPrimitive,
  SurfaceAttributes,
  Vec3,
} from "./types.js";

function scalar(value: number): string {
  if (!Number.isFinite(value))
    throw new Error("Cannot serialize a non-finite number");
  const corrected = Math.abs(value) < 1e-9 ? 0 : value;
  return Number.isInteger(corrected)
    ? String(corrected)
    : corrected.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function point(value: Vec3): string {
  return `( ${scalar(value[0])} ${scalar(value[1])} ${scalar(value[2])} )`;
}

function quote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}"`;
}

function surfaceSuffixFor(surface: SurfaceAttributes): string {
  if (
    surface.contents === undefined &&
    surface.flags === undefined &&
    surface.value === undefined
  )
    return "";
  return ` ${scalar(surface.contents ?? 0)} ${scalar(surface.flags ?? 0)} ${scalar(surface.value ?? 0)}`;
}

export function serializeMapFace(face: MapFace, valve220: boolean): string {
  const prefix = `${point(face.planePoints[0])} ${point(face.planePoints[1])} ${point(face.planePoints[2])} ${face.material}`;
  if (!valve220) {
    return `${prefix} ${scalar(face.projection.offset[0])} ${scalar(face.projection.offset[1])} ${scalar(face.projection.rotationDegrees)} ${scalar(face.projection.scale[0])} ${scalar(face.projection.scale[1])}${surfaceSuffixFor(face.surface)}`;
  }
  const u = face.projection.uAxis;
  const v = face.projection.vAxis;
  return `${prefix} [ ${scalar(u[0])} ${scalar(u[1])} ${scalar(u[2])} ${scalar(face.projection.offset[0])} ] [ ${scalar(v[0])} ${scalar(v[1])} ${scalar(v[2])} ${scalar(face.projection.offset[1])} ] ${scalar(face.projection.rotationDegrees)} ${scalar(face.projection.scale[0])} ${scalar(face.projection.scale[1])}${surfaceSuffixFor(face.surface)}`;
}

export function serializeMapBrush(brush: MapBrush, valve220: boolean): string {
  return [
    "{",
    ...brush.faces.map((face) => serializeMapFace(face, valve220)),
    "}",
  ].join("\n");
}

function serializeBrushDefFace(face: MapBrushDef["faces"][number]): string {
  const [u, v] = face.textureMatrix;
  return `${point(face.planePoints[0])} ${point(face.planePoints[1])} ${point(face.planePoints[2])} ( ( ${scalar(u[0])} ${scalar(u[1])} ${scalar(u[2])} ) ( ${scalar(v[0])} ${scalar(v[1])} ${scalar(v[2])} ) ) ${face.material}${surfaceSuffixFor(face.surface)}`;
}

export function serializeMapBrushDef(brush: MapBrushDef): string {
  return [
    "{",
    "brushDef",
    "{",
    ...brush.faces.map(serializeBrushDefFace),
    "}",
    "}",
  ].join("\n");
}

export function serializeMapPatch(patch: MapPatch): string {
  const rows = patch.controlPoints.map(
    (row) =>
      `( ${row
        .map(
          ({ position, uv }) =>
            `( ${scalar(position[0])} ${scalar(position[1])} ${scalar(position[2])} ${scalar(uv[0])} ${scalar(uv[1])} )`,
        )
        .join(" ")} )`,
  );
  return [
    "{",
    "patchDef2",
    "{",
    patch.material,
    `( ${scalar(patch.dimensions[0])} ${scalar(patch.dimensions[1])} ${patch.subdivisions.map(scalar).join(" ")} )`,
    "(",
    ...rows,
    ")",
    "}",
    "}",
  ].join("\n");
}

export function serializeMapPrimitive(
  primitive: MapPrimitive,
  valve220: boolean,
): string {
  switch (primitive.kind) {
    case "brush":
      return serializeMapBrush(primitive, valve220);
    case "brush-def":
      return serializeMapBrushDef(primitive);
    case "patch":
      return serializeMapPatch(primitive);
  }
}

export function serializeMapEntity(
  entity: MapEntity,
  valve220: boolean,
): string {
  return [
    "{",
    ...Object.entries(entity.properties).map(
      ([key, value]) => `${quote(key)} ${quote(value)}`,
    ),
    ...entity.primitives.map((primitive) =>
      serializeMapPrimitive(primitive, valve220),
    ),
    "}",
  ].join("\n");
}

export function serializeMap(document: MapDocument): string {
  const output: string[] = [];
  const valve220 = document.faceSyntax === "valve-220";
  for (const entity of document.entities) {
    output.push("{");
    for (const [key, value] of Object.entries(entity.properties)) {
      output.push(`${quote(key)} ${quote(value)}`);
    }
    for (const primitive of entity.primitives)
      output.push(...serializeMapPrimitive(primitive, valve220).split("\n"));
    output.push("}");
  }
  return `${output.join("\n")}\n`;
}
