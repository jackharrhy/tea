import {
  DEFAULT_GOLDSRC_MOVEMENT,
  tracePlayerHull,
  type GoldSrcMovementConfig,
  type ParsedWorld,
  type Vec3Tuple,
} from "../core/index.js";
import { driveWalkability } from "./drive.js";
import { walkabilityWorldFingerprint } from "./fingerprint.js";
import { walkabilitySeeds, type GroundedWalkabilitySeed } from "./seeds.js";
import {
  WALKABILITY_FORMAT,
  WALKABILITY_VERSION,
  type GenerateWalkabilityOptions,
  type WalkabilityBoundary,
  type WalkabilityEdge,
  type WalkabilityMap,
  type WalkabilityNode,
  type WalkabilityParameters,
  type WalkabilityProgress,
  type WalkabilityTraversal,
} from "./types.js";

const CARDINAL_DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
const DIAGONAL_DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [Math.SQRT1_2, Math.SQRT1_2],
  [0, 1],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [-1, 0],
  [-Math.SQRT1_2, -Math.SQRT1_2],
  [0, -1],
  [Math.SQRT1_2, -Math.SQRT1_2],
];

interface MutableNode {
  readonly id: number;
  readonly position: Vec3Tuple;
  readonly floorNormal: Vec3Tuple;
  readonly ceilingOriginZ: number | null;
  seed: boolean;
}

interface SpatialIndex {
  readonly buckets: Map<string, number[]>;
  readonly size: number;
}

function finiteInRange(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  return Number.isFinite(value)
    ? Math.min(max, Math.max(min, value!))
    : fallback;
}

function normalizedParameters(
  options: GenerateWalkabilityOptions,
): WalkabilityParameters {
  const spacing = finiteInRange(options.spacing, 32, 8, 256);
  const mergeDistance = finiteInRange(
    options.mergeDistance,
    spacing * 0.34,
    1,
    spacing * 0.49,
  );
  const maximumNodes = Math.round(
    finiteInRange(options.maximumNodes, 200_000, 1, 200_000),
  );
  const fixedDeltaSeconds = finiteInRange(
    options.fixedDeltaSeconds,
    0.01,
    0.002,
    0.05,
  );
  const suppliedMovement = options.movement ?? {};
  const movement: GoldSrcMovementConfig = {
    gravity: finiteInRange(
      suppliedMovement.gravity,
      DEFAULT_GOLDSRC_MOVEMENT.gravity,
      1,
      4_000,
    ),
    stopSpeed: finiteInRange(
      suppliedMovement.stopSpeed,
      DEFAULT_GOLDSRC_MOVEMENT.stopSpeed,
      0,
      2_000,
    ),
    maxSpeed: finiteInRange(
      suppliedMovement.maxSpeed,
      DEFAULT_GOLDSRC_MOVEMENT.maxSpeed,
      1,
      2_000,
    ),
    accelerate: finiteInRange(
      suppliedMovement.accelerate,
      DEFAULT_GOLDSRC_MOVEMENT.accelerate,
      0,
      1_000,
    ),
    airAccelerate: finiteInRange(
      suppliedMovement.airAccelerate,
      DEFAULT_GOLDSRC_MOVEMENT.airAccelerate,
      0,
      1_000,
    ),
    friction: finiteInRange(
      suppliedMovement.friction,
      DEFAULT_GOLDSRC_MOVEMENT.friction,
      0,
      100,
    ),
    edgeFriction: finiteInRange(
      suppliedMovement.edgeFriction,
      DEFAULT_GOLDSRC_MOVEMENT.edgeFriction,
      0,
      100,
    ),
    stepSize: finiteInRange(
      suppliedMovement.stepSize,
      DEFAULT_GOLDSRC_MOVEMENT.stepSize,
      0,
      128,
    ),
  };
  return {
    spacing,
    mergeDistance,
    directions: options.directions === 4 ? 4 : 8,
    maximumNodes,
    allowJump: options.allowJump ?? true,
    jumpSeconds: finiteInRange(options.jumpSeconds, 1.6, 0.1, 5),
    fixedDeltaSeconds,
    movement,
  };
}

function bucketKey(position: Vec3Tuple, size: number): string {
  return `${Math.floor(position[0] / size)}:${Math.floor(position[1] / size)}:${Math.floor(position[2] / size)}`;
}

function addToSpatialIndex(index: SpatialIndex, node: MutableNode): void {
  const key = bucketKey(node.position, index.size);
  const bucket = index.buckets.get(key);
  if (bucket) bucket.push(node.id);
  else index.buckets.set(key, [node.id]);
}

function nearbyNodeIds(
  index: SpatialIndex,
  nodes: readonly MutableNode[],
  position: Vec3Tuple,
  radius: number,
): number[] {
  const result: number[] = [];
  const cellRadius = Math.ceil(radius / index.size);
  const centerX = Math.floor(position[0] / index.size);
  const centerY = Math.floor(position[1] / index.size);
  const centerZ = Math.floor(position[2] / index.size);
  for (let z = centerZ - cellRadius; z <= centerZ + cellRadius; z += 1) {
    for (let y = centerY - cellRadius; y <= centerY + cellRadius; y += 1) {
      for (let x = centerX - cellRadius; x <= centerX + cellRadius; x += 1) {
        const bucket = index.buckets.get(`${x}:${y}:${z}`);
        if (!bucket) continue;
        for (const id of bucket) if (nodes[id]) result.push(id);
      }
    }
  }
  return result;
}

function horizontalDistance(left: Vec3Tuple, right: Vec3Tuple): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function ceilingOriginZ(
  world: ParsedWorld,
  position: Vec3Tuple,
): number | null {
  const top = Math.max(world.bounds.max[2] + 512, position[2] + 512);
  const trace = tracePlayerHull(world, position, [
    position[0],
    position[1],
    top,
  ]);
  return !trace.startSolid &&
    !trace.allSolid &&
    trace.fraction < 1 &&
    trace.planeNormal[2] < -0.5
    ? trace.endPosition[2]
    : null;
}

function componentIds(
  nodeCount: number,
  edges: readonly WalkabilityEdge[],
): Int32Array {
  const parent = Int32Array.from({ length: nodeCount }, (_, index) => index);
  const find = (value: number): number => {
    let root = value;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[value] !== value) {
      const next = parent[value]!;
      parent[value] = root;
      value = next;
    }
    return root;
  };
  for (const edge of edges) {
    const left = find(edge.from);
    const right = find(edge.to);
    if (left !== right) parent[right] = left;
  }
  const components = new Map<number, number>();
  return Int32Array.from({ length: nodeCount }, (_, index) => {
    const root = find(index);
    let component = components.get(root);
    if (component === undefined) {
      component = components.size;
      components.set(root, component);
    }
    return component;
  });
}

async function defaultYield(): Promise<void> {
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
}

export async function generateWalkability(
  world: ParsedWorld,
  options: GenerateWalkabilityOptions = {},
): Promise<WalkabilityMap> {
  if (
    !world.collision ||
    !world.models[0] ||
    (world.models[0].headnodes[1] ?? -1) < 0
  ) {
    throw new Error(
      "Walkability generation requires a standing player collision hull",
    );
  }
  const parameters = normalizedParameters(options);
  const groundedSeeds = walkabilitySeeds(world, options.seedOrigins);
  if (groundedSeeds.length === 0) {
    throw new Error(
      "Walkability generation could not find a valid player seed",
    );
  }
  options.signal?.throwIfAborted();

  const nodes: MutableNode[] = [];
  const edges: WalkabilityEdge[] = [];
  const boundaries: WalkabilityBoundary[] = [];
  const queue: number[] = [];
  const spatial: SpatialIndex = {
    buckets: new Map(),
    size: parameters.spacing,
  };
  const edgeKeys = new Set<string>();
  const directions =
    parameters.directions === 4 ? CARDINAL_DIRECTIONS : DIAGONAL_DIRECTIONS;
  const directionalCosine = Math.cos(Math.PI / parameters.directions);
  const nearbyRadius = parameters.spacing * 1.6;
  let truncated = false;

  const findMerge = (position: Vec3Tuple): number | null => {
    let closest: number | null = null;
    let closestDistance = Infinity;
    for (const id of nearbyNodeIds(
      spatial,
      nodes,
      position,
      parameters.mergeDistance * 2,
    )) {
      const node = nodes[id]!;
      if (
        Math.abs(node.position[2] - position[2]) >
        Math.max(18, parameters.mergeDistance)
      )
        continue;
      const distance = horizontalDistance(node.position, position);
      if (distance <= parameters.mergeDistance && distance < closestDistance) {
        closest = id;
        closestDistance = distance;
      }
    }
    return closest;
  };

  const addNode = (
    position: Vec3Tuple,
    floorNormal: Vec3Tuple,
    seed: boolean,
  ): number | null => {
    const existing = findMerge(position);
    if (existing !== null) {
      if (seed) nodes[existing]!.seed = true;
      return existing;
    }
    if (nodes.length >= parameters.maximumNodes) {
      truncated = true;
      return null;
    }
    const node: MutableNode = {
      id: nodes.length,
      position,
      floorNormal,
      ceilingOriginZ: ceilingOriginZ(world, position),
      seed,
    };
    nodes.push(node);
    addToSpatialIndex(spatial, node);
    queue.push(node.id);
    return node.id;
  };

  const addEdge = (
    from: number,
    to: number,
    traversal: WalkabilityTraversal,
  ): void => {
    if (from === to) return;
    const key = `${from}:${to}:${traversal}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ from, to, traversal });
  };

  for (const seed of groundedSeeds)
    addNode(seed.position, seed.floorNormal, true);

  const progress = (expanded: number): WalkabilityProgress => ({
    expanded,
    queued: queue.length - expanded,
    nodes: nodes.length,
    edges: edges.length,
    boundaries: boundaries.length,
  });
  const drive = (
    from: MutableNode,
    target: Vec3Tuple,
    attempt: "walk" | "jump",
  ) =>
    driveWalkability(world, from.position, target, attempt, {
      movement: parameters.movement,
      fixedDeltaSeconds: parameters.fixedDeltaSeconds,
      maximumSeconds: parameters.jumpSeconds,
      targetTolerance: Math.max(
        0.5,
        Math.min(4, parameters.mergeDistance * 0.5),
      ),
    });

  let expanded = 0;
  while (expanded < queue.length) {
    if (truncated) break;
    options.signal?.throwIfAborted();
    const from = nodes[queue[expanded]!]!;
    expanded += 1;

    for (const direction of directions) {
      let candidate: MutableNode | undefined;
      let candidateDistance = Infinity;
      for (const id of nearbyNodeIds(
        spatial,
        nodes,
        from.position,
        nearbyRadius,
      )) {
        if (id === from.id) continue;
        const node = nodes[id]!;
        const dx = node.position[0] - from.position[0];
        const dy = node.position[1] - from.position[1];
        const distance = Math.hypot(dx, dy);
        if (
          distance <= parameters.mergeDistance ||
          distance > nearbyRadius ||
          Math.abs(node.position[2] - from.position[2]) > 96 ||
          (dx * direction[0] + dy * direction[1]) / distance < directionalCosine
        ) {
          continue;
        }
        if (distance < candidateDistance) {
          candidate = node;
          candidateDistance = distance;
        }
      }

      const target: Vec3Tuple = candidate
        ? candidate.position
        : [
            from.position[0] + direction[0] * parameters.spacing,
            from.position[1] + direction[1] * parameters.spacing,
            from.position[2],
          ];
      if (
        target[0] < world.bounds.min[0] ||
        target[0] > world.bounds.max[0] ||
        target[1] < world.bounds.min[1] ||
        target[1] > world.bounds.max[1]
      ) {
        continue;
      }

      const walk = drive(from, target, "walk");
      let connected = false;
      if (walk.reached) {
        const to = candidate?.id ?? addNode(walk.end, walk.floorNormal, false);
        if (to !== null && to !== undefined) {
          addEdge(
            from.id,
            to,
            walk.end[2] < from.position[2] - parameters.movement.stepSize
              ? "drop"
              : "walk",
          );
          connected = true;
        }
      } else {
        let boundaryFrom = from.id;
        if (walk.horizontalDistance >= parameters.spacing * 0.35) {
          const partial = addNode(walk.end, walk.floorNormal, false);
          if (partial !== null) {
            addEdge(
              from.id,
              partial,
              walk.end[2] < from.position[2] - parameters.movement.stepSize
                ? "drop"
                : "walk",
            );
            boundaryFrom = partial;
          }
        }
        boundaries.push({
          from: boundaryFrom,
          target,
          end: walk.end,
          attempt: "walk",
        });
      }

      if (!connected && parameters.allowJump) {
        const jump = drive(from, target, "jump");
        if (jump.reached && jump.jumped) {
          const to =
            candidate?.id ?? addNode(jump.end, jump.floorNormal, false);
          if (to !== null && to !== undefined) {
            addEdge(from.id, to, "jump");
            connected = true;
          }
        }
        if (!connected)
          boundaries.push({
            from: from.id,
            target,
            end: jump.end,
            attempt: "jump",
          });
      }
    }

    const yieldEvery = Math.max(0, Math.floor(options.yieldEvery ?? 32));
    if (yieldEvery > 0 && expanded % yieldEvery === 0) {
      options.onProgress?.(progress(expanded));
      await (options.yieldControl?.() ?? defaultYield());
    }
  }

  const components = componentIds(nodes.length, edges);
  const finalNodes: WalkabilityNode[] = nodes.map((node) => ({
    id: node.id,
    position: node.position,
    floorNormal: node.floorNormal,
    ceilingOriginZ: node.ceilingOriginZ,
    seed: node.seed,
    component: components[node.id] ?? 0,
  }));
  let componentCount = 0;
  for (const component of components)
    componentCount = Math.max(componentCount, component + 1);
  const seeds = groundedSeeds.map((seed: GroundedWalkabilitySeed) => ({
    position: seed.position,
    entityIndex: seed.entityIndex,
  }));
  options.onProgress?.(progress(expanded));
  return {
    format: WALKABILITY_FORMAT,
    version: WALKABILITY_VERSION,
    worldFingerprint: walkabilityWorldFingerprint(world),
    parameters,
    seeds,
    nodes: finalNodes,
    edges,
    boundaries,
    statistics: {
      nodes: finalNodes.length,
      edges: edges.length,
      walkEdges: edges.filter((edge) => edge.traversal === "walk").length,
      jumpEdges: edges.filter((edge) => edge.traversal === "jump").length,
      dropEdges: edges.filter((edge) => edge.traversal === "drop").length,
      boundaries: boundaries.length,
      components: componentCount,
      truncated,
    },
  };
}
