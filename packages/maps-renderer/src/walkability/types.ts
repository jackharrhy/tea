import type { GoldSrcMovementConfig, Vec3Tuple } from "../core/index.js";

export const WALKABILITY_FORMAT = "tea-maps-walkability";
export const WALKABILITY_VERSION = 1;

export type WalkabilityTraversal = "walk" | "jump" | "drop";
export type WalkabilityAttempt = "walk" | "jump";

export interface WalkabilityParameters {
  readonly spacing: number;
  readonly mergeDistance: number;
  readonly directions: 4 | 8;
  readonly maximumNodes: number;
  readonly allowJump: boolean;
  readonly jumpSeconds: number;
  readonly fixedDeltaSeconds: number;
  readonly movement: GoldSrcMovementConfig;
}

export interface WalkabilitySeed {
  readonly position: Vec3Tuple;
  readonly entityIndex: number | null;
}

export interface WalkabilityNode {
  /** Stable index into `WalkabilityMap.nodes`. */
  readonly id: number;
  /** Standing player-hull origin, not eye position or the physical floor plane. */
  readonly position: Vec3Tuple;
  readonly floorNormal: Vec3Tuple;
  /** Highest standing-hull origin reached by an upward trace, or null when open overhead. */
  readonly ceilingOriginZ: number | null;
  readonly seed: boolean;
  /** Weakly connected component. Directed traversal is retained by the edges themselves. */
  readonly component: number;
}

export interface WalkabilityEdge {
  readonly from: number;
  readonly to: number;
  readonly traversal: WalkabilityTraversal;
}

export interface WalkabilityBoundary {
  readonly from: number;
  readonly target: Vec3Tuple;
  readonly end: Vec3Tuple;
  readonly attempt: WalkabilityAttempt;
}

export interface WalkabilityStatistics {
  readonly nodes: number;
  readonly edges: number;
  readonly walkEdges: number;
  readonly jumpEdges: number;
  readonly dropEdges: number;
  readonly boundaries: number;
  readonly components: number;
  readonly truncated: boolean;
}

export interface WalkabilityMap {
  readonly format: typeof WALKABILITY_FORMAT;
  readonly version: typeof WALKABILITY_VERSION;
  readonly worldFingerprint: string;
  readonly parameters: WalkabilityParameters;
  readonly seeds: readonly WalkabilitySeed[];
  readonly nodes: readonly WalkabilityNode[];
  readonly edges: readonly WalkabilityEdge[];
  readonly boundaries: readonly WalkabilityBoundary[];
  readonly statistics: WalkabilityStatistics;
}

export interface WalkabilityProgress {
  readonly expanded: number;
  readonly queued: number;
  readonly nodes: number;
  readonly edges: number;
  readonly boundaries: number;
}

export interface GenerateWalkabilityOptions {
  /** Horizontal sample spacing in world units, clamped to the range 8–256. */
  readonly spacing?: number;
  readonly mergeDistance?: number;
  readonly directions?: 4 | 8;
  /** Safety budget, clamped to the range 1–200,000. Defaults to 200,000. */
  readonly maximumNodes?: number;
  readonly allowJump?: boolean;
  readonly jumpSeconds?: number;
  readonly fixedDeltaSeconds?: number;
  readonly movement?: Partial<GoldSrcMovementConfig>;
  /** Replaces map player-start entities when supplied. Values are standing-hull origins. */
  readonly seedOrigins?: readonly Vec3Tuple[];
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: WalkabilityProgress) => void;
  /** Number of expanded nodes between cooperative yields. Zero disables yielding. */
  readonly yieldEvery?: number;
  readonly yieldControl?: () => void | Promise<void>;
}

export interface WalkabilityDriveResult {
  readonly reached: boolean;
  readonly end: Vec3Tuple;
  readonly floorNormal: Vec3Tuple;
  readonly horizontalDistance: number;
  readonly jumped: boolean;
}
