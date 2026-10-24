import {
  entityValue,
  parseGoldSrcSprite,
  spriteReference,
  MapsError,
  type ParsedGoldSrcSprite,
  type ParsedWorld,
  type SpriteReference,
  type Vec3Tuple,
  type WorldSpriteAssetPlan,
} from "../core/index.js";
import type { LoadedSpriteEntity } from "../render/assets.js";
import {
  abortIfNeeded,
  readBinarySource,
  spriteUrl,
  type LoadAssetContext,
} from "./asset-source.js";
import { sampleWorldLight } from "./sprite-lighting.js";
import type { BinarySource, WarningDetail, WorldSource } from "./types.js";

export interface LoadedSpriteAssets {
  readonly sprites: readonly LoadedSpriteEntity[];
  readonly missingSprites: readonly string[];
  readonly warnings: readonly WarningDetail[];
}

interface RequestedSprite {
  readonly entity: ParsedWorld["entities"][number];
  readonly entityIndex: number;
  readonly reference: SpriteReference;
}

function vectorValue(
  value: string | undefined,
  fallback: Vec3Tuple = [0, 0, 0],
): Vec3Tuple {
  if (!value) return fallback;
  const values = value.trim().split(/\s+/).map(Number);
  if (
    values.length < 3 ||
    values.slice(0, 3).some((part) => !Number.isFinite(part))
  ) {
    return fallback;
  }
  return [values[0]!, values[1]!, values[2]!];
}

function numberValue(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function spriteRenderColor(
  value: string | undefined,
): readonly [number, number, number] {
  const parsed = vectorValue(value, [255, 255, 255]);
  if (parsed[0] === 0 && parsed[1] === 0 && parsed[2] === 0)
    return [255, 255, 255];
  return parsed.map((part) => Math.min(255, Math.max(0, part))) as [
    number,
    number,
    number,
  ];
}

function requestedSprites(
  world: ParsedWorld,
  plans: readonly WorldSpriteAssetPlan[],
): RequestedSprite[] {
  return plans.flatMap((plan) =>
    plan.entityIndices.flatMap((entityIndex) => {
      const entity = world.entities[entityIndex];
      return entity ? [{ entity, entityIndex, reference: plan.reference }] : [];
    }),
  );
}

function explicitSpriteSources(source: WorldSource): Map<string, BinarySource> {
  const explicit = new Map<string, BinarySource>();
  for (const [path, binary] of Object.entries(source.sprites ?? {})) {
    const reference = spriteReference(path);
    if (!reference) continue;
    if (!explicit.has(reference.normalizedPath))
      explicit.set(reference.normalizedPath, binary);
    if (!explicit.has(reference.basename))
      explicit.set(reference.basename, binary);
  }
  return explicit;
}

export async function loadSpriteAssets(
  world: ParsedWorld,
  plans: readonly WorldSpriteAssetPlan[],
  source: WorldSource,
  context: LoadAssetContext,
): Promise<LoadedSpriteAssets> {
  if (world.version !== 30)
    return { sprites: [], missingSprites: [], warnings: [] };
  const requested = requestedSprites(world, plans);
  const references = plans.map(({ reference }) => reference);
  const explicit = explicitSpriteSources(source);
  let completed = 0;
  const results = await Promise.all(
    references.map(async (reference) => {
      abortIfNeeded(context.signal);
      try {
        let binary =
          explicit.get(reference.normalizedPath) ??
          explicit.get(reference.basename);
        if (!binary && source.resolveSprite)
          binary = (await source.resolveSprite(reference)) ?? undefined;
        if (!binary && source.spriteBaseUrl)
          binary = spriteUrl(source.spriteBaseUrl, reference);
        if (!binary)
          throw new MapsError("asset-fetch", "no sprite source was provided");
        const bytes = await readBinarySource(
          binary,
          "sprite",
          reference.declaredPath,
          context,
        );
        return { reference, sprite: parseGoldSrcSprite(bytes) };
      } catch (error) {
        if (context.signal.aborted) throw error;
        return { reference, error };
      } finally {
        context.progress({
          phase: "sprite",
          label: reference.declaredPath,
          loaded: ++completed,
          total: references.length,
        });
      }
    }),
  );

  const parsed = new Map<string, ParsedGoldSrcSprite>();
  const missingSprites: string[] = [];
  const warnings: WarningDetail[] = [];
  for (const result of results) {
    if (result.sprite)
      parsed.set(result.reference.normalizedPath, result.sprite);
    else {
      missingSprites.push(result.reference.normalizedPath);
      warnings.push({
        code: "missing-sprite",
        message: `sprite ${result.reference.declaredPath} could not be loaded: ${result.error instanceof Error ? result.error.message : String(result.error)}`,
      });
    }
  }

  const sprites: LoadedSpriteEntity[] = [];
  for (const { entity, entityIndex, reference } of requested) {
    const sprite = parsed.get(reference.normalizedPath);
    if (!sprite) continue;
    const scaleValue = numberValue(entityValue(entity, "scale"), 1);
    const renderAmount = numberValue(entityValue(entity, "renderamt"), 255);
    const angle = numberValue(entityValue(entity, "angle"), 0);
    const origin = vectorValue(entityValue(entity, "origin"));
    const renderMode = Math.min(
      5,
      Math.max(
        0,
        Math.trunc(numberValue(entityValue(entity, "rendermode"), 0)),
      ),
    );
    const additive = renderMode === 3 || renderMode === 5;
    const receivesLight = sprite.textureFormat === 3 && !additive;
    sprites.push({
      entityIndex,
      reference,
      sprite,
      origin,
      angles: vectorValue(entityValue(entity, "angles"), [0, angle, 0]),
      scale: scaleValue > 0 ? scaleValue : 1,
      renderMode,
      renderAmount: Math.min(255, Math.max(0, renderAmount)),
      renderColor: spriteRenderColor(entityValue(entity, "rendercolor")),
      frame: Math.max(0, numberValue(entityValue(entity, "frame"), 0)),
      frameRate: Math.max(0, numberValue(entityValue(entity, "framerate"), 0)),
      receivesLight,
      lightColor: receivesLight
        ? sampleWorldLight(world, origin)
        : [255, 255, 255],
    });
  }
  return { sprites, missingSprites, warnings };
}
