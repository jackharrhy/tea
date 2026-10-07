import { entityValue } from "./entities.js";
import { invariant } from "./errors.js";
import type { ParsedModel, ParsedWorld, Vec3Tuple } from "./types.js";

export const BSP_CONTENTS_EMPTY = -1;
export const BSP_CONTENTS_SOLID = -2;
const DISTANCE_EPSILON = 1 / 32;

export interface ParsedBspCollision {
  /** Four floats per plane: normal XYZ, then distance. */
  readonly planes: Float32Array;
  /** Three integers per clipnode: plane index, front child, back child. */
  readonly clipnodes: Int32Array;
}

export interface HullTraceResult {
  readonly fraction: number;
  readonly endPosition: Vec3Tuple;
  readonly planeNormal: Vec3Tuple;
  readonly planeDistance: number;
  readonly startSolid: boolean;
  readonly allSolid: boolean;
  readonly contents: number;
}

export interface PlayerHullTraceResult extends HullTraceResult {
  readonly modelIndex: number;
}

interface MutableHullTrace {
  fraction: number;
  endPosition: Vec3Tuple;
  planeNormal: Vec3Tuple;
  planeDistance: number;
  startSolid: boolean;
  allSolid: boolean;
}

function interpolate(
  start: Vec3Tuple,
  end: Vec3Tuple,
  fraction: number,
): Vec3Tuple {
  return [
    start[0] + (end[0] - start[0]) * fraction,
    start[1] + (end[1] - start[1]) * fraction,
    start[2] + (end[2] - start[2]) * fraction,
  ];
}

function planeDifference(
  collision: ParsedBspCollision,
  planeIndex: number,
  point: Vec3Tuple,
): number {
  const offset = planeIndex * 4;
  return (
    collision.planes[offset]! * point[0] +
    collision.planes[offset + 1]! * point[1] +
    collision.planes[offset + 2]! * point[2] -
    collision.planes[offset + 3]!
  );
}

export function hullPointContents(
  collision: ParsedBspCollision,
  headNode: number,
  point: Vec3Tuple,
): number {
  let node = headNode;
  let visits = 0;
  const maximumVisits = Math.max(1, collision.clipnodes.length / 3 + 1);
  while (node >= 0) {
    visits += 1;
    invariant(
      visits <= maximumVisits,
      "BSP collision hull contains a clipnode cycle",
    );
    const offset = node * 3;
    const planeIndex = collision.clipnodes[offset];
    const front = collision.clipnodes[offset + 1];
    const back = collision.clipnodes[offset + 2];
    invariant(
      planeIndex !== undefined && front !== undefined && back !== undefined,
      `BSP collision references missing clipnode ${node}`,
    );
    node = planeDifference(collision, planeIndex, point) < 0 ? back : front;
  }
  return node;
}

/**
 * Sweeps a point through one pre-expanded BSP collision hull. Player hulls in BSP29/BSP30 are
 * authored Minkowski hulls, so tracing the player origin through hull 1 sweeps the standing box.
 */
export function traceBspHull(
  collision: ParsedBspCollision,
  headNode: number,
  start: Vec3Tuple,
  end: Vec3Tuple,
): HullTraceResult {
  const contents = hullPointContents(collision, headNode, end);
  if (headNode < 0) {
    const solid = headNode === BSP_CONTENTS_SOLID;
    return {
      fraction: solid ? 0 : 1,
      endPosition: solid ? start : end,
      planeNormal: [0, 0, 0],
      planeDistance: 0,
      startSolid: solid,
      allSolid: solid,
      contents,
    };
  }

  const trace: MutableHullTrace = {
    fraction: 1,
    endPosition: end,
    planeNormal: [0, 0, 0],
    planeDistance: 0,
    startSolid: false,
    allSolid: true,
  };
  let visits = 0;
  const maximumVisits = Math.max(64, (collision.clipnodes.length / 3) * 8);

  const visit = (
    node: number,
    startFraction: number,
    endFraction: number,
    segmentStart: Vec3Tuple,
    segmentEnd: Vec3Tuple,
  ): boolean => {
    visits += 1;
    invariant(
      visits <= maximumVisits,
      "BSP hull trace exceeded its validated traversal budget",
    );
    if (node < 0) {
      if (node !== BSP_CONTENTS_SOLID) trace.allSolid = false;
      else trace.startSolid = true;
      return true;
    }

    const offset = node * 3;
    const planeIndex = collision.clipnodes[offset]!;
    const children = [
      collision.clipnodes[offset + 1]!,
      collision.clipnodes[offset + 2]!,
    ] as const;
    const startDistance = planeDifference(collision, planeIndex, segmentStart);
    const endDistance = planeDifference(collision, planeIndex, segmentEnd);
    if (startDistance >= 0 && endDistance >= 0) {
      return visit(
        children[0],
        startFraction,
        endFraction,
        segmentStart,
        segmentEnd,
      );
    }
    if (startDistance < 0 && endDistance < 0) {
      return visit(
        children[1],
        startFraction,
        endFraction,
        segmentStart,
        segmentEnd,
      );
    }

    const side = startDistance < 0 ? 1 : 0;
    const denominator = startDistance - endDistance;
    const fraction = Math.min(
      1,
      Math.max(
        0,
        denominator === 0
          ? 0.5
          : (startDistance +
              (side === 1 ? DISTANCE_EPSILON : -DISTANCE_EPSILON)) /
              denominator,
      ),
    );
    const middleFraction =
      startFraction + (endFraction - startFraction) * fraction;
    const middle = interpolate(segmentStart, segmentEnd, fraction);
    if (
      !visit(
        children[side],
        startFraction,
        middleFraction,
        segmentStart,
        middle,
      )
    )
      return false;
    if (
      hullPointContents(collision, children[side ^ 1]!, middle) !==
      BSP_CONTENTS_SOLID
    ) {
      return visit(
        children[side ^ 1]!,
        middleFraction,
        endFraction,
        middle,
        segmentEnd,
      );
    }
    if (trace.allSolid) return false;

    const planeOffset = planeIndex * 4;
    const direction = side === 0 ? 1 : -1;
    trace.planeNormal = [
      collision.planes[planeOffset]! * direction,
      collision.planes[planeOffset + 1]! * direction,
      collision.planes[planeOffset + 2]! * direction,
    ];
    trace.planeDistance = collision.planes[planeOffset + 3]! * direction;
    trace.fraction = middleFraction;
    trace.endPosition = middle;
    return false;
  };

  visit(headNode, 0, 1, start, end);
  if (trace.fraction < 1)
    trace.endPosition = interpolate(start, end, trace.fraction);
  return { ...trace, contents };
}

function modelOrigin(
  world: Pick<ParsedWorld, "entities">,
  model: ParsedModel,
): Vec3Tuple {
  const entity =
    model.entityIndex === null ? undefined : world.entities[model.entityIndex];
  const value = entity ? entityValue(entity, "origin") : undefined;
  const components = value?.trim().split(/\s+/).map(Number);
  if (
    !components ||
    components.length !== 3 ||
    components.some((part) => !Number.isFinite(part))
  ) {
    return [0, 0, 0];
  }
  return [components[0]!, components[1]!, components[2]!];
}

function subtract(point: Vec3Tuple, offset: Vec3Tuple): Vec3Tuple {
  return [point[0] - offset[0], point[1] - offset[1], point[2] - offset[2]];
}

/** Sweeps the standing player hull through the world and supported static brush submodels. */
export function tracePlayerHull(
  world: Pick<ParsedWorld, "collision" | "models" | "entities">,
  start: Vec3Tuple,
  end: Vec3Tuple,
): PlayerHullTraceResult {
  const collision = world.collision;
  const clear: PlayerHullTraceResult = {
    fraction: 1,
    endPosition: end,
    planeNormal: [0, 0, 0],
    planeDistance: 0,
    startSolid: false,
    allSolid: false,
    contents: BSP_CONTENTS_EMPTY,
    modelIndex: -1,
  };
  if (!collision) return clear;

  let closest = clear;
  let anyStartSolid = false;
  for (const [modelIndex, model] of world.models.entries()) {
    if (modelIndex !== 0 && !model.collidable) continue;
    const headNode = model.headnodes[1] ?? BSP_CONTENTS_EMPTY;
    if (headNode === BSP_CONTENTS_EMPTY) continue;
    const origin = modelOrigin(world, model);
    const localStart = subtract(start, origin);
    const localEnd = subtract(end, origin);
    const result = traceBspHull(collision, headNode, localStart, localEnd);
    anyStartSolid ||= result.startSolid;
    if (
      result.allSolid ||
      result.fraction < closest.fraction ||
      (result.startSolid && !closest.startSolid)
    ) {
      closest = {
        ...result,
        endPosition: interpolate(start, end, result.fraction),
        modelIndex,
      };
    }
  }
  return anyStartSolid && !closest.startSolid
    ? { ...closest, startSolid: true }
    : closest;
}

export function validateBspCollision(
  collision: ParsedBspCollision,
  headNodes: readonly number[],
): void {
  invariant(
    collision.planes.length % 4 === 0,
    "BSP collision plane data is misaligned",
  );
  invariant(
    collision.clipnodes.length % 3 === 0,
    "BSP clipnode data is misaligned",
  );
  const planeCount = collision.planes.length / 4;
  const nodeCount = collision.clipnodes.length / 3;
  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
    const offset = nodeIndex * 3;
    const planeIndex = collision.clipnodes[offset]!;
    invariant(
      planeIndex >= 0 && planeIndex < planeCount,
      `BSP clipnode ${nodeIndex} has an invalid plane`,
    );
    for (const child of [
      collision.clipnodes[offset + 1]!,
      collision.clipnodes[offset + 2]!,
    ]) {
      invariant(
        child < nodeCount,
        `BSP clipnode ${nodeIndex} has an invalid child`,
      );
    }
  }

  for (const headNode of headNodes) {
    if (headNode < 0) continue;
    invariant(
      headNode < nodeCount,
      `BSP collision hull has invalid headnode ${headNode}`,
    );
    const visiting = new Uint8Array(nodeCount);
    const stack: Array<{ node: number; leaving: boolean }> = [
      { node: headNode, leaving: false },
    ];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current.node < 0) continue;
      if (current.leaving) {
        visiting[current.node] = 2;
        continue;
      }
      invariant(
        visiting[current.node] !== 1,
        "BSP collision hull contains a clipnode cycle",
      );
      if (visiting[current.node] === 2) continue;
      visiting[current.node] = 1;
      stack.push({ node: current.node, leaving: true });
      const offset = current.node * 3;
      stack.push({ node: collision.clipnodes[offset + 2]!, leaving: false });
      stack.push({ node: collision.clipnodes[offset + 1]!, leaving: false });
    }
  }
}
