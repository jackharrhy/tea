import { WorldviewError, type ParsedWorld } from "../core/index.js";
import {
  assertWalkabilityCompatible,
  parseWalkability,
  type WalkabilityMap,
} from "../walkability/index.js";
import { readBinarySource, type LoadAssetContext } from "./asset-source.js";
import type { BinarySource } from "./types.js";

export async function loadWalkabilitySource(
  world: ParsedWorld,
  source: BinarySource,
  context: LoadAssetContext,
): Promise<WalkabilityMap> {
  const bytes = await readBinarySource(
    source,
    "walkability",
    "Walkability sidecar",
    context,
  );
  context.signal.throwIfAborted();
  try {
    const walkability = parseWalkability(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    assertWalkabilityCompatible(world, walkability);
    return walkability;
  } catch (error) {
    if (context.signal.aborted) throw context.signal.reason;
    const reason = error instanceof Error ? error.message : String(error);
    throw new WorldviewError(
      "invalid-data",
      `walkability sidecar is invalid or incompatible: ${reason}`,
      { cause: error },
    );
  }
}
