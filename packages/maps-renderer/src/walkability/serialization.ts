import { z } from "zod";

import type { ParsedWorld } from "../core/index.js";
import { walkabilityWorldFingerprint } from "./fingerprint.js";
import {
  WALKABILITY_FORMAT,
  WALKABILITY_VERSION,
  type WalkabilityMap,
} from "./types.js";

const finiteNumber = z.number().finite();
const nonNegativeInteger = z.number().int().nonnegative();
const Vec3TupleSchema = z.tuple([finiteNumber, finiteNumber, finiteNumber]);
const WalkabilityParametersSchema = z.strictObject({
  spacing: finiteNumber,
  mergeDistance: finiteNumber,
  directions: z.union([z.literal(4), z.literal(8)]),
  maximumNodes: z.number().int().positive(),
  allowJump: z.boolean(),
  jumpSeconds: finiteNumber,
  fixedDeltaSeconds: finiteNumber,
  movement: z.strictObject({
    gravity: finiteNumber,
    stopSpeed: finiteNumber,
    maxSpeed: finiteNumber,
    accelerate: finiteNumber,
    airAccelerate: finiteNumber,
    friction: finiteNumber,
    edgeFriction: finiteNumber,
    stepSize: finiteNumber,
  }),
});
const WalkabilitySeedSchema = z.strictObject({
  position: Vec3TupleSchema,
  entityIndex: nonNegativeInteger.nullable(),
});
const WalkabilityNodeSchema = z.strictObject({
  id: nonNegativeInteger,
  position: Vec3TupleSchema,
  floorNormal: Vec3TupleSchema,
  ceilingOriginZ: finiteNumber.nullable(),
  seed: z.boolean(),
  component: nonNegativeInteger,
});
const WalkabilityEdgeSchema = z.strictObject({
  from: nonNegativeInteger,
  to: nonNegativeInteger,
  traversal: z.enum(["walk", "jump", "drop"]),
});
const WalkabilityBoundarySchema = z.strictObject({
  from: nonNegativeInteger,
  target: Vec3TupleSchema,
  end: Vec3TupleSchema,
  attempt: z.enum(["walk", "jump"]),
});
const WalkabilityStatisticsSchema = z.strictObject({
  nodes: nonNegativeInteger,
  edges: nonNegativeInteger,
  walkEdges: nonNegativeInteger,
  jumpEdges: nonNegativeInteger,
  dropEdges: nonNegativeInteger,
  boundaries: nonNegativeInteger,
  components: nonNegativeInteger,
  truncated: z.boolean(),
});

export const WalkabilityMapSchema = z
  .strictObject({
    format: z.literal(WALKABILITY_FORMAT),
    version: z.literal(WALKABILITY_VERSION),
    worldFingerprint: z.string().min(1).max(256),
    parameters: WalkabilityParametersSchema,
    seeds: z.array(WalkabilitySeedSchema).max(200_000),
    nodes: z.array(WalkabilityNodeSchema).max(200_000),
    edges: z.array(WalkabilityEdgeSchema).max(2_000_000),
    boundaries: z.array(WalkabilityBoundarySchema).max(2_000_000),
    statistics: WalkabilityStatisticsSchema,
  })
  .superRefine((walkability, context) => {
    for (const [index, node] of walkability.nodes.entries()) {
      if (node.id !== index) {
        context.addIssue({
          code: "custom",
          path: ["nodes", index, "id"],
          message: `walkability.nodes[${index}].id must equal its index`,
        });
      }
    }
    for (const [index, edge] of walkability.edges.entries()) {
      if (!walkability.nodes[edge.from] || !walkability.nodes[edge.to]) {
        context.addIssue({
          code: "custom",
          path: ["edges", index],
          message: `walkability.edges[${index}] is out of range`,
        });
      }
    }
    for (const [index, boundary] of walkability.boundaries.entries()) {
      if (!walkability.nodes[boundary.from]) {
        context.addIssue({
          code: "custom",
          path: ["boundaries", index, "from"],
          message: `walkability.boundaries[${index}].from is out of range`,
        });
      }
    }
    const actualStatistics = {
      nodes: walkability.nodes.length,
      edges: walkability.edges.length,
      walkEdges: walkability.edges.filter((edge) => edge.traversal === "walk")
        .length,
      jumpEdges: walkability.edges.filter((edge) => edge.traversal === "jump")
        .length,
      dropEdges: walkability.edges.filter((edge) => edge.traversal === "drop")
        .length,
      boundaries: walkability.boundaries.length,
      components: walkability.nodes.reduce(
        (highest, node) => Math.max(highest, node.component + 1),
        0,
      ),
    };
    for (const [key, actual] of Object.entries(actualStatistics)) {
      if (
        walkability.statistics[key as keyof typeof actualStatistics] !== actual
      ) {
        context.addIssue({
          code: "custom",
          path: ["statistics", key],
          message: `walkability.statistics.${key} does not match its data`,
        });
      }
    }
  }) satisfies z.ZodType<WalkabilityMap>;

function validateWalkability(value: unknown): WalkabilityMap {
  const result = WalkabilityMapSchema.safeParse(value);
  if (!result.success) throw new TypeError(result.error.issues[0]!.message);
  return result.data;
}

export function serializeWalkability(walkability: WalkabilityMap): string {
  return `${JSON.stringify(validateWalkability(walkability))}\n`;
}

export function parseWalkability(source: string | object): WalkabilityMap {
  const value: unknown =
    typeof source === "string" ? JSON.parse(source) : source;
  return validateWalkability(value);
}

export function assertWalkabilityCompatible(
  world: ParsedWorld,
  walkability: WalkabilityMap,
): void {
  const expected = walkabilityWorldFingerprint(world);
  if (walkability.worldFingerprint !== expected) {
    throw new Error(
      `Walkability was generated for ${walkability.worldFingerprint}, but this map is ${expected}`,
    );
  }
}
