import {
  bspPlayerProfile,
  entityValue,
  tracePlayerHull,
  type ParsedWorld,
  type Vec3Tuple,
} from "../core/index.js";

function parseOrigin(value: string | undefined): Vec3Tuple | null {
  const parts = value?.trim().split(/\s+/).map(Number);
  if (
    !parts ||
    parts.length !== 3 ||
    parts.some((part) => !Number.isFinite(part))
  )
    return null;
  return [parts[0]!, parts[1]!, parts[2]!];
}

function grounded(
  world: ParsedWorld,
  origin: Vec3Tuple,
): { position: Vec3Tuple; floorNormal: Vec3Tuple } | null {
  for (const lift of [1, 2, 4, 8, 16, 32, 64]) {
    const start: Vec3Tuple = [origin[0], origin[1], origin[2] + lift];
    const occupancy = tracePlayerHull(world, start, start);
    if (occupancy.startSolid || occupancy.allSolid) continue;
    const end: Vec3Tuple = [
      start[0],
      start[1],
      Math.max(world.bounds.min[2] - 128, start[2] - 256),
    ];
    const trace = tracePlayerHull(world, start, end);
    if (
      !trace.startSolid &&
      !trace.allSolid &&
      trace.fraction < 1 &&
      trace.planeNormal[2] >= 0.7
    ) {
      return { position: trace.endPosition, floorNormal: trace.planeNormal };
    }
  }
  return null;
}

export interface GroundedWalkabilitySeed {
  readonly position: Vec3Tuple;
  readonly floorNormal: Vec3Tuple;
  readonly entityIndex: number | null;
}

export function walkabilitySeeds(
  world: ParsedWorld,
  seedOrigins?: readonly Vec3Tuple[],
): readonly GroundedWalkabilitySeed[] {
  const requested = seedOrigins
    ? seedOrigins.map((position) => ({ position, entityIndex: null }))
    : world.entities.flatMap((entity, entityIndex) => {
        const classname = entityValue(entity, "classname")?.toLowerCase();
        if (
          !classname ||
          !bspPlayerProfile(world.format).spawnClasses.has(classname)
        )
          return [];
        const position = parseOrigin(entityValue(entity, "origin"));
        return position ? [{ position, entityIndex }] : [];
      });
  return requested.flatMap(({ position, entityIndex }) => {
    const result = grounded(world, position);
    return result ? [{ ...result, entityIndex }] : [];
  });
}
