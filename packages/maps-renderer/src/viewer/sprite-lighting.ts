import type { ParsedFace, ParsedWorld, Vec3Tuple } from "../core/index.js";

const TRACE_DISTANCE = 2048;
const VERTEX_STRIDE = 7;

interface LightHit {
  readonly distance: number;
  readonly face: ParsedFace;
  readonly lightmapU: number;
  readonly lightmapV: number;
}

function vertex(world: ParsedWorld, index: number): Float32Array {
  return world.vertices.subarray(
    index * VERTEX_STRIDE,
    index * VERTEX_STRIDE + VERTEX_STRIDE,
  );
}

function triangleLightHit(
  world: ParsedWorld,
  face: ParsedFace,
  indexOffset: number,
  origin: Vec3Tuple,
): LightHit | undefined {
  const first = vertex(
    world,
    world.indices[indexOffset] ?? world.vertices.length,
  );
  const second = vertex(
    world,
    world.indices[indexOffset + 1] ?? world.vertices.length,
  );
  const third = vertex(
    world,
    world.indices[indexOffset + 2] ?? world.vertices.length,
  );
  if (
    first.length < VERTEX_STRIDE ||
    second.length < VERTEX_STRIDE ||
    third.length < VERTEX_STRIDE
  )
    return undefined;

  const edge1 = [
    second[0]! - first[0]!,
    second[1]! - first[1]!,
    second[2]! - first[2]!,
  ] as const;
  const edge2 = [
    third[0]! - first[0]!,
    third[1]! - first[1]!,
    third[2]! - first[2]!,
  ] as const;
  // Möller-Trumbore with the GoldSrc light trace direction (straight down).
  const p = [edge2[1], -edge2[0], 0] as const;
  const determinant = edge1[0] * p[0] + edge1[1] * p[1];
  if (Math.abs(determinant) < 0.000_001) return undefined;
  const inverse = 1 / determinant;
  const fromFirst = [
    origin[0] - first[0]!,
    origin[1] - first[1]!,
    origin[2] - first[2]!,
  ] as const;
  const barycentricU =
    (fromFirst[0] * p[0] + fromFirst[1] * p[1] + fromFirst[2] * p[2]) * inverse;
  if (barycentricU < 0 || barycentricU > 1) return undefined;
  const q = [
    fromFirst[1] * edge1[2] - fromFirst[2] * edge1[1],
    fromFirst[2] * edge1[0] - fromFirst[0] * edge1[2],
    fromFirst[0] * edge1[1] - fromFirst[1] * edge1[0],
  ] as const;
  const barycentricV = -q[2] * inverse;
  if (barycentricV < 0 || barycentricU + barycentricV > 1) return undefined;
  const distance =
    (edge2[0] * q[0] + edge2[1] * q[1] + edge2[2] * q[2]) * inverse;
  if (distance < 0 || distance > TRACE_DISTANCE) return undefined;
  const barycentricW = 1 - barycentricU - barycentricV;
  return {
    distance,
    face,
    lightmapU:
      first[5]! * barycentricW +
      second[5]! * barycentricU +
      third[5]! * barycentricV,
    lightmapV:
      first[6]! * barycentricW +
      second[6]! * barycentricU +
      third[6]! * barycentricV,
  };
}

function hitColor(
  world: ParsedWorld,
  hit: LightHit,
): readonly [number, number, number] {
  const lightmap = hit.face.lightmap;
  if (!lightmap.samples) return [0, 0, 0];
  const x = Math.min(
    lightmap.width - 1,
    Math.max(0, Math.round(hit.lightmapU - lightmap.pageX - 0.5)),
  );
  const y = Math.min(
    lightmap.height - 1,
    Math.max(0, Math.round(hit.lightmapV - lightmap.pageY - 0.5)),
  );
  const bytesPerTexel = world.lightmapBytesPerTexel;
  const styleSize = lightmap.width * lightmap.height * bytesPerTexel;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (
    let styleIndex = 0;
    styleIndex < lightmap.styles.length;
    styleIndex += 1
  ) {
    const source =
      styleIndex * styleSize + (y * lightmap.width + x) * bytesPerTexel;
    if (bytesPerTexel === 1) {
      const gray = lightmap.samples[source] ?? 0;
      red += gray;
      green += gray;
      blue += gray;
    } else {
      red += lightmap.samples[source] ?? 0;
      green += lightmap.samples[source + 1] ?? 0;
      blue += lightmap.samples[source + 2] ?? 0;
    }
  }
  return [Math.min(255, red), Math.min(255, green), Math.min(255, blue)];
}

export function sampleWorldLight(
  world: ParsedWorld,
  origin: Vec3Tuple,
): readonly [number, number, number] {
  if (
    !world.faces.some((face) => face.modelIndex === 0 && face.lightmap.samples)
  ) {
    return [255, 255, 255];
  }
  let closest: LightHit | undefined;
  for (const face of world.faces) {
    if (
      face.modelIndex !== 0 ||
      face.kind === "sky" ||
      face.kind === "water" ||
      face.kind === "tool"
    ) {
      continue;
    }
    for (
      let index = face.firstIndex;
      index < face.firstIndex + face.indexCount;
      index += 3
    ) {
      const hit = triangleLightHit(world, face, index, origin);
      if (hit && (!closest || hit.distance < closest.distance)) closest = hit;
    }
  }
  return closest ? hitColor(world, closest) : [0, 0, 0];
}
