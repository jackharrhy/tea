import { invariant } from "./errors.js";
import type { Vec3Tuple } from "./types.js";

export interface ParsedBspTrace {
  /** Four floats per plane: normal XYZ, then distance. */
  readonly planes: Float32Array;
  /** Three integers per node: plane index, front child, back child. Negative children encode leaves. */
  readonly nodes: Int32Array;
  readonly leafContents: Int32Array;
  readonly headNode: number;
}

export interface SegmentTraceResult {
  readonly blocked: boolean;
  readonly crossesWaterBoundary: boolean;
}

const CONTENTS_EMPTY = -1;
const CONTENTS_SOLID = -2;
const CONTENTS_WATER = -3;
const CONTENTS_LAVA = -5;

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

function planeDistance(
  trace: ParsedBspTrace,
  planeIndex: number,
  point: Vec3Tuple,
): number {
  const offset = planeIndex * 4;
  return (
    trace.planes[offset]! * point[0] +
    trace.planes[offset + 1]! * point[1] +
    trace.planes[offset + 2]! * point[2] -
    trace.planes[offset + 3]!
  );
}

export function findBspLeaf(
  trace: ParsedBspTrace | null,
  point: Vec3Tuple,
): number | null {
  if (!trace || trace.headNode < 0) return null;
  let node = trace.headNode;
  let visits = 0;
  const maximumVisits = Math.max(1, trace.nodes.length / 3 + 1);
  while (node >= 0) {
    visits += 1;
    invariant(
      visits <= maximumVisits,
      "BSP point query exceeded its validated traversal budget",
    );
    const offset = node * 3;
    const planeIndex = trace.nodes[offset];
    const frontChild = trace.nodes[offset + 1];
    const backChild = trace.nodes[offset + 2];
    invariant(
      planeIndex !== undefined &&
        frontChild !== undefined &&
        backChild !== undefined,
      `BSP point query references missing node ${node}`,
    );
    node =
      planeDistance(trace, planeIndex, point) >= 0 ? frontChild : backChild;
  }
  return -node - 1;
}

/**
 * Traces a point segment through the world BSP. This intentionally models only static world
 * obstruction and liquid-boundary detection for audio; it is not a gameplay collision API.
 */
export function traceWorldSegment(
  trace: ParsedBspTrace | null,
  start: Vec3Tuple,
  end: Vec3Tuple,
): SegmentTraceResult {
  if (!trace || trace.headNode < 0)
    return { blocked: false, crossesWaterBoundary: false };
  let sawOpen = false;
  let sawLiquid = false;
  let blocked = false;
  const stack: Array<{
    node: number;
    startFraction: number;
    endFraction: number;
    start: Vec3Tuple;
    end: Vec3Tuple;
  }> = [{ node: trace.headNode, startFraction: 0, endFraction: 1, start, end }];
  let visits = 0;
  const maximumVisits = Math.max(
    64,
    (trace.nodes.length / 3) * 4 + trace.leafContents.length * 2,
  );

  while (stack.length > 0 && !blocked) {
    const item = stack.pop()!;
    visits += 1;
    invariant(
      visits <= maximumVisits,
      "BSP trace exceeded its validated traversal budget",
    );
    if (item.node < 0) {
      const leafIndex = -item.node - 1;
      const contents = trace.leafContents[leafIndex];
      invariant(
        contents !== undefined,
        `BSP trace references missing leaf ${leafIndex}`,
      );
      if (contents === CONTENTS_SOLID) blocked = true;
      else if (contents === CONTENTS_EMPTY) sawOpen = true;
      else if (contents <= CONTENTS_WATER && contents >= CONTENTS_LAVA)
        sawLiquid = true;
      continue;
    }

    const nodeOffset = item.node * 3;
    const planeIndex = trace.nodes[nodeOffset];
    const frontChild = trace.nodes[nodeOffset + 1];
    const backChild = trace.nodes[nodeOffset + 2];
    invariant(
      planeIndex !== undefined &&
        frontChild !== undefined &&
        backChild !== undefined,
      `BSP trace references missing node ${item.node}`,
    );
    const startDistance = planeDistance(trace, planeIndex, item.start);
    const endDistance = planeDistance(trace, planeIndex, item.end);
    if (startDistance >= 0 && endDistance >= 0) {
      stack.push({ ...item, node: frontChild });
      continue;
    }
    if (startDistance < 0 && endDistance < 0) {
      stack.push({ ...item, node: backChild });
      continue;
    }

    const denominator = startDistance - endDistance;
    const fraction =
      denominator === 0
        ? 0.5
        : Math.min(1, Math.max(0, startDistance / denominator));
    const middleFraction =
      item.startFraction + (item.endFraction - item.startFraction) * fraction;
    const middle = interpolate(item.start, item.end, fraction);
    const nearChild = startDistance >= 0 ? frontChild : backChild;
    const farChild = startDistance >= 0 ? backChild : frontChild;
    stack.push({
      node: farChild,
      startFraction: middleFraction,
      endFraction: item.endFraction,
      start: middle,
      end: item.end,
    });
    stack.push({
      node: nearChild,
      startFraction: item.startFraction,
      endFraction: middleFraction,
      start: item.start,
      end: middle,
    });
  }

  return { blocked, crossesWaterBoundary: sawOpen && sawLiquid };
}

export function validateBspTrace(trace: ParsedBspTrace): void {
  invariant(
    trace.planes.length % 4 === 0,
    "BSP trace plane data is misaligned",
  );
  invariant(trace.nodes.length % 3 === 0, "BSP trace node data is misaligned");
  const planeCount = trace.planes.length / 4;
  const nodeCount = trace.nodes.length / 3;
  invariant(
    trace.headNode >= 0 && trace.headNode < nodeCount,
    "BSP trace head node is invalid",
  );
  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
    const offset = nodeIndex * 3;
    const planeIndex = trace.nodes[offset]!;
    invariant(
      planeIndex >= 0 && planeIndex < planeCount,
      `BSP node ${nodeIndex} has an invalid plane`,
    );
    for (const child of [trace.nodes[offset + 1]!, trace.nodes[offset + 2]!]) {
      if (child >= 0)
        invariant(
          child < nodeCount,
          `BSP node ${nodeIndex} has an invalid child`,
        );
      else {
        const leafIndex = -child - 1;
        invariant(
          leafIndex >= 0 && leafIndex < trace.leafContents.length,
          `BSP node ${nodeIndex} has an invalid leaf`,
        );
      }
    }
  }

  const state = new Uint8Array(nodeCount);
  const stack: Array<{ node: number; leaving: boolean }> = [
    { node: trace.headNode, leaving: false },
  ];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.node < 0) continue;
    if (current.leaving) {
      state[current.node] = 2;
      continue;
    }
    invariant(
      state[current.node] !== 1,
      "BSP trace tree contains a node cycle",
    );
    if (state[current.node] === 2) continue;
    state[current.node] = 1;
    stack.push({ node: current.node, leaving: true });
    const offset = current.node * 3;
    stack.push({ node: trace.nodes[offset + 2]!, leaving: false });
    stack.push({ node: trace.nodes[offset + 1]!, leaving: false });
  }
}
