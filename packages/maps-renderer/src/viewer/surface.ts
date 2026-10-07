import type { ParsedWorld, Vec3Tuple } from "../core/index.js";

const VERTEX_STRIDE = 7;
const CELL_SIZE = 128;

interface SurfaceTriangle {
  readonly indexOffset: number;
  readonly materialName: string;
}

function vertex(world: ParsedWorld, index: number): Float32Array {
  return world.vertices.subarray(
    index * VERTEX_STRIDE,
    index * VERTEX_STRIDE + VERTEX_STRIDE,
  );
}

function downwardTriangleDistance(
  world: ParsedWorld,
  indexOffset: number,
  origin: Vec3Tuple,
  maximumDistance: number,
): number | undefined {
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
  const p = [edge2[1], -edge2[0], 0] as const;
  const determinant = edge1[0] * p[0] + edge1[1] * p[1];
  if (Math.abs(determinant) < 0.000_001) return undefined;
  const inverse = 1 / determinant;
  const fromFirst = [
    origin[0] - first[0]!,
    origin[1] - first[1]!,
    origin[2] - first[2]!,
  ] as const;
  const u =
    (fromFirst[0] * p[0] + fromFirst[1] * p[1] + fromFirst[2] * p[2]) * inverse;
  if (u < 0 || u > 1) return undefined;
  const q = [
    fromFirst[1] * edge1[2] - fromFirst[2] * edge1[1],
    fromFirst[2] * edge1[0] - fromFirst[0] * edge1[2],
    fromFirst[0] * edge1[1] - fromFirst[1] * edge1[0],
  ] as const;
  const v = -q[2] * inverse;
  if (v < 0 || u + v > 1) return undefined;
  const distance =
    (edge2[0] * q[0] + edge2[1] * q[1] + edge2[2] * q[2]) * inverse;
  return distance >= 0 && distance <= maximumDistance ? distance : undefined;
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export class WorldSurfaceIndex {
  private readonly cells = new Map<string, SurfaceTriangle[]>();
  private readonly world: ParsedWorld;

  public constructor(world: ParsedWorld) {
    this.world = world;
    for (const face of world.faces) {
      const model = world.models[face.modelIndex];
      if (
        !model ||
        (face.modelIndex !== 0 && !model.collidable) ||
        face.kind === "sky" ||
        face.kind === "water" ||
        face.kind === "tool"
      ) {
        continue;
      }
      const materialName = world.materials[face.materialIndex]?.name ?? "";
      for (
        let index = face.firstIndex;
        index < face.firstIndex + face.indexCount;
        index += 3
      ) {
        const first = vertex(
          world,
          world.indices[index] ?? world.vertices.length,
        );
        const second = vertex(
          world,
          world.indices[index + 1] ?? world.vertices.length,
        );
        const third = vertex(
          world,
          world.indices[index + 2] ?? world.vertices.length,
        );
        if (
          first.length < VERTEX_STRIDE ||
          second.length < VERTEX_STRIDE ||
          third.length < VERTEX_STRIDE
        ) {
          continue;
        }
        const minimumX = Math.floor(
          Math.min(first[0]!, second[0]!, third[0]!) / CELL_SIZE,
        );
        const maximumX = Math.floor(
          Math.max(first[0]!, second[0]!, third[0]!) / CELL_SIZE,
        );
        const minimumY = Math.floor(
          Math.min(first[1]!, second[1]!, third[1]!) / CELL_SIZE,
        );
        const maximumY = Math.floor(
          Math.max(first[1]!, second[1]!, third[1]!) / CELL_SIZE,
        );
        const triangle = { indexOffset: index, materialName };
        for (let x = minimumX; x <= maximumX; x += 1) {
          for (let y = minimumY; y <= maximumY; y += 1) {
            const key = cellKey(x, y);
            const cell = this.cells.get(key);
            if (cell) cell.push(triangle);
            else this.cells.set(key, [triangle]);
          }
        }
      }
    }
  }

  public textureBelow(origin: Vec3Tuple, maximumDistance = 80): string {
    const candidates =
      this.cells.get(
        cellKey(
          Math.floor(origin[0] / CELL_SIZE),
          Math.floor(origin[1] / CELL_SIZE),
        ),
      ) ?? [];
    let closestDistance = Number.POSITIVE_INFINITY;
    let closestMaterial = "";
    for (const triangle of candidates) {
      const distance = downwardTriangleDistance(
        this.world,
        triangle.indexOffset,
        origin,
        maximumDistance,
      );
      if (distance !== undefined && distance < closestDistance) {
        closestDistance = distance;
        closestMaterial = triangle.materialName;
      }
    }
    return closestMaterial;
  }
}

const surfaceIndices = new WeakMap<ParsedWorld, WorldSurfaceIndex>();

export function surfaceTextureBelow(
  world: ParsedWorld,
  origin: Vec3Tuple,
  maximumDistance = 80,
): string {
  let index = surfaceIndices.get(world);
  if (!index) {
    index = new WorldSurfaceIndex(world);
    surfaceIndices.set(world, index);
  }
  return index.textureBelow(origin, maximumDistance);
}
