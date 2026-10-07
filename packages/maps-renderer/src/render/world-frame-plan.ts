/*
 * Draw ordering and surface classification are adapted from noclip.website's
 * Common/IdTech2 renderer. See docs/plan.md and THIRD_PARTY_NOTICES.md.
 */

import {
  isQuakePaletteFormat,
  type DrawBatch,
  type ParsedWorld,
  type Vec3Tuple,
} from "../core/index.js";

export interface WorldFramePlanOptions {
  readonly cameraPosition: Vec3Tuple;
  readonly includeSky: boolean;
  readonly worldFaceVisibility: Uint8Array | null;
  readonly batchCenters: ReadonlyMap<DrawBatch, Vec3Tuple>;
  readonly hasSprites: boolean;
  readonly hasWalkability: boolean;
}

export interface WorldFramePlan {
  readonly sky: readonly DrawBatch[];
  readonly opaque: readonly DrawBatch[];
  readonly translucent: readonly DrawBatch[];
  readonly worldFaceVisibility: Uint8Array | null;
  readonly hasSprites: boolean;
  readonly hasWalkability: boolean;
  readonly needsSkyPass: boolean;
  readonly needsWorldPass: boolean;
}

export function goldSrcTextureScrollSpeed(
  world: ParsedWorld,
  batch: DrawBatch,
): number {
  if (world.version !== 30 || batch.modelIndex === 0) return 0;
  const material = world.materials[batch.materialIndex];
  if (!material?.name.toLowerCase().startsWith("scroll")) return 0;
  return world.models[batch.modelIndex]?.textureScrollSpeed ?? 0;
}

export function isTranslucentWorldBatch(
  world: ParsedWorld,
  batch: DrawBatch,
): boolean {
  if (
    world.format === "quake2-bsp38" &&
    (world.materials[batch.materialIndex]?.opacity ?? 1) < 1
  ) {
    return true;
  }
  if (world.version !== 30 || batch.modelIndex === 0) return false;
  const mode = world.models[batch.modelIndex]?.renderMode;
  return mode === 1 || mode === 2 || mode === 3 || mode === 5;
}

export function translucentBatchRank(
  world: ParsedWorld,
  batch: DrawBatch,
): number {
  const mode = world.models[batch.modelIndex]?.renderMode;
  if (mode === 2) return 1;
  if (mode === 5) return 2;
  if (mode === 3) return 3;
  return 0;
}

export function createWorldBatchCenters(
  world: ParsedWorld,
): ReadonlyMap<DrawBatch, Vec3Tuple> {
  return new Map(
    world.batches.map(
      (batch) => [batch, worldBatchCenter(world, batch)] as const,
    ),
  );
}

export function worldRequiresContinuousAnimation(world: ParsedWorld): boolean {
  return (
    world.hasAnimatedLightmaps ||
    world.batches.some(
      (batch) =>
        world.models[batch.modelIndex]?.visible &&
        (batch.kind === "water" ||
          (batch.kind === "sky" && isQuakePaletteFormat(world.format)) ||
          goldSrcTextureScrollSpeed(world, batch) !== 0 ||
          (world.materials[batch.materialIndex]?.scrollSpeed ?? 0) !== 0 ||
          world.materials[batch.materialIndex]?.nextMaterialIndex != null),
    )
  );
}

export function createWorldFramePlan(
  world: ParsedWorld,
  options: WorldFramePlanOptions,
): WorldFramePlan {
  const visible = world.batches.filter(
    (batch) =>
      world.models[batch.modelIndex]?.visible &&
      (options.includeSky || batch.kind !== "sky") &&
      (batch.modelIndex !== 0 ||
        !options.worldFaceVisibility ||
        batch.faceIndices.some(
          (faceIndex) => options.worldFaceVisibility?.[faceIndex] !== 0,
        )),
  );
  const sky = visible.filter((batch) => batch.kind === "sky");
  const opaque = visible.filter(
    (batch) => batch.kind !== "sky" && !isTranslucentWorldBatch(world, batch),
  );
  const distanceSquared = (batch: DrawBatch) => {
    const center = options.batchCenters.get(batch);
    if (!center) return 0;
    const x = center[0] - options.cameraPosition[0];
    const y = center[1] - options.cameraPosition[1];
    const z = center[2] - options.cameraPosition[2];
    return x * x + y * y + z * z;
  };
  const translucent = visible
    .filter(
      (batch) => batch.kind !== "sky" && isTranslucentWorldBatch(world, batch),
    )
    .toSorted(
      (left, right) =>
        distanceSquared(right) - distanceSquared(left) ||
        translucentBatchRank(world, left) - translucentBatchRank(world, right),
    );
  const needsSkyPass = sky.length > 0;
  const needsWorldPass =
    opaque.length > 0 ||
    translucent.length > 0 ||
    options.hasSprites ||
    options.hasWalkability;
  return {
    sky,
    opaque,
    translucent,
    worldFaceVisibility: options.worldFaceVisibility,
    hasSprites: options.hasSprites,
    hasWalkability: options.hasWalkability,
    needsSkyPass,
    needsWorldPass,
  };
}

function worldBatchCenter(world: ParsedWorld, batch: DrawBatch): Vec3Tuple {
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let minimumZ = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  let maximumZ = Number.NEGATIVE_INFINITY;
  for (
    let offset = batch.firstIndex;
    offset < batch.firstIndex + batch.indexCount;
    offset += 1
  ) {
    const vertexIndex = world.indices[offset];
    if (vertexIndex === undefined) continue;
    const vertexOffset = vertexIndex * 7;
    const x = world.vertices[vertexOffset];
    const y = world.vertices[vertexOffset + 1];
    const z = world.vertices[vertexOffset + 2];
    if (x === undefined || y === undefined || z === undefined) continue;
    minimumX = Math.min(minimumX, x);
    minimumY = Math.min(minimumY, y);
    minimumZ = Math.min(minimumZ, z);
    maximumX = Math.max(maximumX, x);
    maximumY = Math.max(maximumY, y);
    maximumZ = Math.max(maximumZ, z);
  }
  if (Number.isFinite(minimumX)) {
    return [
      (minimumX + maximumX) * 0.5,
      (minimumY + maximumY) * 0.5,
      (minimumZ + maximumZ) * 0.5,
    ];
  }
  const bounds = world.models[batch.modelIndex]?.bounds ?? world.bounds;
  return [
    (bounds.min[0] + bounds.max[0]) * 0.5,
    (bounds.min[1] + bounds.max[1]) * 0.5,
    (bounds.min[2] + bounds.max[2]) * 0.5,
  ];
}
