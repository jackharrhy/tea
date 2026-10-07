import type { SoundReference } from "./audio.js";
import { normalizeGameAssetPath } from "./asset-path.js";
import { entityValue, type WadReference } from "./entities.js";
import { GOLDSRC_PLAYER_SOUND_REFERENCES } from "./goldsrc-player-assets.js";
import { spriteReference, type SpriteReference } from "./sprite.js";
import type { ParsedWorld } from "./types.js";

export type WorldSkyboxSuffix = "rt" | "bk" | "lf" | "ft" | "up" | "dn";

export interface WorldPaletteAssetPlan {
  readonly kind: "palette";
  readonly candidates: readonly string[];
}

export interface WorldWadAssetPlan {
  readonly kind: "wad";
  readonly reference: WadReference;
  readonly candidates: readonly string[];
}

export interface WorldTextureAssetPlan {
  readonly kind: "texture";
  readonly name: string;
  readonly materialIndices: readonly number[];
  /** Ordered high-resolution image replacements. */
  readonly imageCandidates: readonly string[];
  /** Independently ordered WAL data sources used for pixels and authored dimensions. */
  readonly walCandidates: readonly string[];
}

export interface WorldSkyboxFaceAssetPlan {
  readonly suffix: WorldSkyboxSuffix;
  readonly candidates: readonly string[];
}

export interface WorldSkyboxAssetPlan {
  readonly kind: "skybox";
  readonly name: string;
  readonly faces: readonly WorldSkyboxFaceAssetPlan[];
}

export interface WorldSpriteAssetPlan {
  readonly kind: "sprite";
  readonly reference: SpriteReference;
  readonly entityIndices: readonly number[];
  readonly candidates: readonly string[];
}

export interface WorldSoundAssetPlan {
  readonly kind: "sound";
  readonly usage: "ambient" | "music" | "player";
  readonly origin: "map" | "viewer-default";
  readonly reference: SoundReference;
  readonly candidates: readonly string[];
}

export interface WorldAssetPlan {
  readonly palette: WorldPaletteAssetPlan | null;
  readonly wads: readonly WorldWadAssetPlan[];
  readonly textures: readonly WorldTextureAssetPlan[];
  readonly skybox: WorldSkyboxAssetPlan | null;
  readonly sprites: readonly WorldSpriteAssetPlan[];
  readonly sounds: readonly WorldSoundAssetPlan[];
}

export interface PlanWorldAssetsOptions {
  /** Includes assets supplied by the viewer rather than authored by the map. Defaults to true. */
  readonly includeViewerDefaults?: boolean;
}

const SKYBOX_SUFFIXES: readonly WorldSkyboxSuffix[] = [
  "rt",
  "bk",
  "lf",
  "ft",
  "up",
  "dn",
];
const IMAGE_EXTENSIONS = ["png", "tga", "jpg", "jpeg"] as const;

function quake2TextureNames(name: string): readonly string[] {
  const normalized = normalizeGameAssetPath(
    name.replace(/^textures[\\/]/iu, ""),
  );
  const rerelease = normalized.replaceAll("+", "_");
  return rerelease === normalized ? [normalized] : [normalized, rerelease];
}

function referencedQuake2Materials(world: ParsedWorld): Set<number> {
  const initial = world.batches.map(({ materialIndex }) => materialIndex);
  const referenced = new Set(initial);
  for (const first of initial) {
    let current = first;
    const visited = new Set<number>();
    while (!visited.has(current)) {
      visited.add(current);
      const next = world.materials[current]?.nextMaterialIndex;
      if (next === null || next === undefined) break;
      referenced.add(next);
      current = next;
    }
  }
  return referenced;
}

function texturePlan(world: ParsedWorld): WorldTextureAssetPlan[] {
  if (world.format !== "quake2-bsp38") return [];
  const groups = new Map<string, { name: string; materialIndices: number[] }>();
  for (const materialIndex of referencedQuake2Materials(world)) {
    const material = world.materials[materialIndex];
    if (!material) continue;
    const key = material.name.toLowerCase();
    const existing = groups.get(key);
    if (existing) existing.materialIndices.push(materialIndex);
    else
      groups.set(key, {
        name: material.name,
        materialIndices: [materialIndex],
      });
  }
  return [...groups.values()].map(({ name, materialIndices }) => {
    const names = quake2TextureNames(name);
    return {
      kind: "texture",
      name,
      materialIndices,
      imageCandidates: names.flatMap((candidate) =>
        IMAGE_EXTENSIONS.map(
          (extension) => `textures/${candidate}.${extension}`,
        ),
      ),
      walCandidates: names.map((candidate) => `textures/${candidate}.wal`),
    };
  });
}

function skyboxPlan(world: ParsedWorld): WorldSkyboxAssetPlan | null {
  if (!world.skyName) return null;
  if (world.format === "quake2-bsp38") {
    const name = world.skyName.replace(/\.[^/.]+$/u, "");
    return {
      kind: "skybox",
      name: world.skyName,
      faces: SKYBOX_SUFFIXES.map((suffix) => ({
        suffix,
        candidates: IMAGE_EXTENSIONS.map((extension) =>
          normalizeGameAssetPath(`env/${name}${suffix}.${extension}`),
        ),
      })),
    };
  }
  if (world.format !== "goldsrc-bsp30") return null;
  const name = world.skyName.replace(/\.[^/.]+$/u, "").replace(/_$/u, "");
  return {
    kind: "skybox",
    name: world.skyName,
    faces: SKYBOX_SUFFIXES.map((suffix) => ({
      suffix,
      candidates: [normalizeGameAssetPath(`gfx/env/${name}${suffix}.tga`)],
    })),
  };
}

function spritePlan(world: ParsedWorld): WorldSpriteAssetPlan[] {
  if (world.format !== "goldsrc-bsp30") return [];
  const sprites = new Map<
    string,
    { readonly reference: SpriteReference; readonly entityIndices: number[] }
  >();
  world.entities.forEach((entity, entityIndex) => {
    const classname = entityValue(entity, "classname")?.toLowerCase();
    if (classname !== "env_sprite" && classname !== "env_glow") return;
    const reference = spriteReference(entityValue(entity, "model") ?? "");
    if (!reference) return;
    const existing = sprites.get(reference.normalizedPath);
    if (existing) existing.entityIndices.push(entityIndex);
    else
      sprites.set(reference.normalizedPath, {
        reference,
        entityIndices: [entityIndex],
      });
  });
  return [...sprites.values()].map(({ reference, entityIndices }) => ({
    kind: "sprite",
    reference,
    entityIndices,
    candidates: [normalizeGameAssetPath(reference.normalizedPath)],
  }));
}

function soundPlan(
  world: ParsedWorld,
  includeViewerDefaults: boolean,
): WorldSoundAssetPlan[] {
  if (world.format !== "goldsrc-bsp30") return [];
  const plans = new Map<string, WorldSoundAssetPlan>();
  const add = (
    reference: SoundReference,
    usage: WorldSoundAssetPlan["usage"],
    origin: WorldSoundAssetPlan["origin"],
  ): void => {
    const key = `${usage}:${reference.normalizedPath}`;
    if (plans.has(key)) return;
    plans.set(key, {
      kind: "sound",
      usage,
      origin,
      reference,
      candidates: [normalizeGameAssetPath(`sound/${reference.normalizedPath}`)],
    });
  };
  for (const sound of world.ambientSounds)
    add(sound.reference, "ambient", "map");
  for (const track of world.musicTracks) add(track.reference, "music", "map");
  if (includeViewerDefaults) {
    for (const reference of GOLDSRC_PLAYER_SOUND_REFERENCES) {
      add(reference, "player", "viewer-default");
    }
  }
  return [...plans.values()];
}

function palettePlan(world: ParsedWorld): WorldPaletteAssetPlan | null {
  switch (world.format) {
    case "quake-bsp29":
    case "quake-bsp2":
      return { kind: "palette", candidates: ["gfx/palette.lmp"] };
    case "quake2-bsp38":
      return { kind: "palette", candidates: ["pics/colormap.pcx"] };
    case "goldsrc-bsp30":
      return null;
  }
}

export function planWorldAssets(
  world: ParsedWorld,
  options: PlanWorldAssetsOptions = {},
): WorldAssetPlan {
  return {
    palette: palettePlan(world),
    wads: world.wadReferences.map((reference) => ({
      kind: "wad",
      reference,
      candidates: [normalizeGameAssetPath(reference.basename)],
    })),
    textures: texturePlan(world),
    skybox: skyboxPlan(world),
    sprites: spritePlan(world),
    sounds: soundPlan(world, options.includeViewerDefaults ?? true),
  };
}
