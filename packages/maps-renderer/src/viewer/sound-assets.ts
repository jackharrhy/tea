import {
  parseWave,
  WorldviewError,
  type ParsedWave,
  type ParsedWorld,
  type SoundReference,
  type WorldSoundAssetPlan,
} from "../core/index.js";
import {
  abortIfNeeded,
  readBinarySource,
  soundUrl,
  type LoadAssetContext,
} from "./asset-source.js";
import type { BinarySource, WarningDetail, WorldSource } from "./types.js";

export interface LoadedSoundAsset {
  readonly reference: SoundReference;
  readonly wave: ParsedWave;
}

/** Browser-decodable audio kept encoded until a user gesture enables playback. */
export interface LoadedMusicAsset {
  readonly reference: SoundReference;
  readonly data: ArrayBuffer;
}

export interface LoadedSoundAssets {
  readonly sounds: ReadonlyMap<string, LoadedSoundAsset>;
  readonly music: ReadonlyMap<string, LoadedMusicAsset>;
  readonly playerSounds: ReadonlyMap<string, LoadedSoundAsset>;
  readonly missingSounds: readonly string[];
  readonly missingMusic: readonly string[];
  readonly warnings: readonly WarningDetail[];
}

interface ReferenceResult<T> {
  readonly reference: SoundReference;
  readonly asset?: T;
  readonly error?: unknown;
}

function explicitSoundSources(source: WorldSource): Map<string, BinarySource> {
  const explicit = new Map<string, BinarySource>();
  for (const [path, binary] of Object.entries(source.sounds ?? {})) {
    const normalized = path
      .trim()
      .replaceAll("\\", "/")
      .replace(/^\/+/, "")
      .toLowerCase();
    if (!normalized) continue;
    explicit.set(normalized, binary);
    const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
    if (!explicit.has(basename)) explicit.set(basename, binary);
  }
  return explicit;
}

export async function loadSoundAssets(
  world: ParsedWorld,
  plans: readonly WorldSoundAssetPlan[],
  source: WorldSource,
  context: LoadAssetContext,
): Promise<LoadedSoundAssets> {
  if (world.version !== 30) {
    return {
      sounds: new Map(),
      music: new Map(),
      playerSounds: new Map(),
      missingSounds: [],
      missingMusic: [],
      warnings: [],
    };
  }

  const explicit = explicitSoundSources(source);
  const encoded = new Map<string, Promise<ArrayBuffer>>();
  const readReference = (reference: SoundReference): Promise<ArrayBuffer> => {
    const cached = encoded.get(reference.normalizedPath);
    if (cached) return cached;
    const request = (async () => {
      let binary =
        explicit.get(reference.normalizedPath) ??
        explicit.get(reference.basename);
      if (!binary && source.resolveSound)
        binary = (await source.resolveSound(reference)) ?? undefined;
      if (!binary && source.soundBaseUrl)
        binary = soundUrl(source.soundBaseUrl, reference);
      if (!binary)
        throw new WorldviewError("asset-fetch", "no sound source was provided");
      return readBinarySource(binary, "sound", reference.declaredPath, context);
    })();
    encoded.set(reference.normalizedPath, request);
    return request;
  };
  const loadWave = async (
    reference: SoundReference,
  ): Promise<LoadedSoundAsset> => ({
    reference,
    wave: parseWave(await readReference(reference)),
  });
  const attempt = async <T>(
    reference: SoundReference,
    load: (reference: SoundReference) => Promise<T>,
  ): Promise<ReferenceResult<T>> => {
    abortIfNeeded(context.signal);
    try {
      return { reference, asset: await load(reference) };
    } catch (error) {
      if (context.signal.aborted) throw error;
      return { reference, error };
    }
  };

  const ambientReferences = plans
    .filter(({ usage }) => usage === "ambient")
    .map(({ reference }) => reference);
  const musicReferences = plans
    .filter(({ usage }) => usage === "music")
    .map(({ reference }) => reference);
  const plannedPlayerReferences = plans
    .filter(({ usage }) => usage === "player")
    .map(({ reference }) => reference);
  const playerReferences =
    source.soundBaseUrl || source.resolveSound
      ? plannedPlayerReferences
      : plannedPlayerReferences.filter(
          (reference) =>
            explicit.has(reference.normalizedPath) ||
            explicit.has(reference.basename),
        );

  const progress = (
    reference: SoundReference,
    loaded: number,
    total: number,
  ): void => {
    context.progress({
      phase: "sound",
      label: reference.declaredPath,
      loaded,
      total,
    });
  };
  let ambientLoaded = 0;
  let musicLoaded = 0;
  let playerLoaded = 0;
  const [ambientResults, musicResults, playerResults] = await Promise.all([
    Promise.all(
      ambientReferences.map(async (reference) => {
        const result = await attempt(reference, loadWave);
        progress(reference, ++ambientLoaded, ambientReferences.length);
        return result;
      }),
    ),
    Promise.all(
      musicReferences.map(async (reference) => {
        const result = await attempt<LoadedMusicAsset>(reference, async () => ({
          reference,
          data: await readReference(reference),
        }));
        progress(reference, ++musicLoaded, musicReferences.length);
        return result;
      }),
    ),
    Promise.all(
      playerReferences.map(async (reference) => {
        const result = await attempt(reference, loadWave);
        progress(reference, ++playerLoaded, playerReferences.length);
        return result;
      }),
    ),
  ]);

  const sounds = new Map<string, LoadedSoundAsset>();
  const music = new Map<string, LoadedMusicAsset>();
  const playerSounds = new Map<string, LoadedSoundAsset>();
  const missingSounds: string[] = [];
  const missingMusic: string[] = [];
  const warnings: WarningDetail[] = [];
  for (const result of ambientResults) {
    if (result.asset) sounds.set(result.reference.normalizedPath, result.asset);
    else {
      missingSounds.push(result.reference.normalizedPath);
      warnings.push({
        code: "missing-sound",
        message: `sound ${result.reference.declaredPath} could not be loaded: ${errorMessage(result.error)}`,
      });
    }
  }
  for (const result of musicResults) {
    if (result.asset) music.set(result.reference.normalizedPath, result.asset);
    else {
      missingMusic.push(result.reference.normalizedPath);
      warnings.push({
        code: "missing-sound",
        message: `music ${result.reference.declaredPath} could not be loaded: ${errorMessage(result.error)}`,
      });
    }
  }
  const missingPlayerSounds: string[] = [];
  for (const result of playerResults) {
    if (result.asset)
      playerSounds.set(result.reference.normalizedPath, result.asset);
    else {
      missingSounds.push(result.reference.normalizedPath);
      missingPlayerSounds.push(result.reference.normalizedPath);
    }
  }
  if (missingPlayerSounds.length > 0) {
    warnings.push({
      code: "missing-sound",
      message: `${missingPlayerSounds.length} GoldSrc player sound${missingPlayerSounds.length === 1 ? "" : "s"} could not be loaded`,
    });
  }
  return { sounds, music, playerSounds, missingSounds, missingMusic, warnings };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
