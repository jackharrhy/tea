import type { MapFaceSyntax } from "./types.js";
import { z } from "zod";
import {
  QUAKE2_SURFACE_SEMANTICS,
  type SurfaceSemantics,
} from "./surface-semantics.js";
export const MapsGameProfileSchema = z.enum([
  "quake",
  "goldsrc",
  "quake2",
  "gower",
]);
export type MapsGameProfile = z.infer<typeof MapsGameProfileSchema>;
export type MapsMaterialFormat = "wad2" | "wad3" | "wal";

export interface MapsGameProfileDefinition {
  readonly id: MapsGameProfile;
  readonly version: 1;
  readonly label: string;
  readonly description: string;
  readonly supportedFaceSyntaxes: readonly MapFaceSyntax[];
  readonly defaultFaceSyntax: MapFaceSyntax;
  readonly materialFormat: MapsMaterialFormat;
  readonly worldspawnWadProperty?: "wad";
  readonly wadVersions: readonly (2 | 3)[];
  readonly entityDefinitionFormats: readonly ("fgd" | "def" | "ent")[];
  readonly surfaceSemantics?: SurfaceSemantics;
}

export const MAPS_GAME_PROFILES: readonly MapsGameProfileDefinition[] = [
  {
    id: "quake",
    version: 1,
    label: "Quake",
    description:
      "Quake source maps with WAD2 materials and FGD, DEF, or ENT entity definitions.",
    supportedFaceSyntaxes: ["valve-220", "quake"],
    defaultFaceSyntax: "valve-220",
    materialFormat: "wad2",
    wadVersions: [2],
    entityDefinitionFormats: ["fgd", "def", "ent"],
  },
  {
    id: "goldsrc",
    version: 1,
    label: "GoldSrc",
    description:
      "GoldSrc source maps with Valve 220 faces, WAD3 materials, and FGDs.",
    supportedFaceSyntaxes: ["valve-220"],
    defaultFaceSyntax: "valve-220",
    materialFormat: "wad3",
    worldspawnWadProperty: "wad",
    wadVersions: [3],
    entityDefinitionFormats: ["fgd"],
  },
  {
    id: "quake2",
    version: 1,
    label: "Quake II",
    description:
      "Quake II source maps with classic faces, WAL materials, and surface metadata.",
    supportedFaceSyntaxes: ["quake"],
    defaultFaceSyntax: "quake",
    materialFormat: "wal",
    wadVersions: [],
    entityDefinitionFormats: ["def", "ent"],
    surfaceSemantics: QUAKE2_SURFACE_SEMANTICS,
  },
  {
    id: "gower",
    version: 1,
    label: "Gower Complex",
    description:
      "Gower Complex Valve 220 maps, Quake II surface flags, and image materials.",
    supportedFaceSyntaxes: ["valve-220"],
    defaultFaceSyntax: "valve-220",
    materialFormat: "wal",
    wadVersions: [],
    entityDefinitionFormats: ["fgd"],
    surfaceSemantics: QUAKE2_SURFACE_SEMANTICS,
  },
] as const;

export function isMapsGameProfile(value: unknown): value is MapsGameProfile {
  return MapsGameProfileSchema.safeParse(value).success;
}

export function mapsGameProfile(
  id: MapsGameProfile,
): MapsGameProfileDefinition {
  const profile = MAPS_GAME_PROFILES.find((candidate) => candidate.id === id);
  if (!profile) throw new Error(`Unknown Maps game profile ${id}`);
  return profile;
}

export function gameProfileSupportsFaceSyntax(
  profile: MapsGameProfileDefinition,
  format: unknown,
): format is MapFaceSyntax {
  return profile.supportedFaceSyntaxes.some(
    (candidate) => candidate === format,
  );
}
