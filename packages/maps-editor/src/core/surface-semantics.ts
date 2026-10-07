import type { SurfaceAttributes } from "./types.js";

export interface SurfaceFlagDefinition {
  readonly value: number;
  readonly name: string;
  readonly label: string;
}

export interface SurfaceSemantics {
  readonly contents: readonly SurfaceFlagDefinition[];
  readonly flags: readonly SurfaceFlagDefinition[];
  readonly valueLabel: string;
}

export interface DecodedSurfaceFlags {
  readonly active: readonly SurfaceFlagDefinition[];
  readonly unknownBits: number;
}

export const QUAKE2_SURFACE_SEMANTICS: SurfaceSemantics = {
  contents: [
    { value: 0x00000001, name: "solid", label: "Solid" },
    { value: 0x00000002, name: "window", label: "Window" },
    { value: 0x00000004, name: "aux", label: "Auxiliary" },
    { value: 0x00000008, name: "lava", label: "Lava" },
    { value: 0x00000010, name: "slime", label: "Slime" },
    { value: 0x00000020, name: "water", label: "Water" },
    { value: 0x00000040, name: "mist", label: "Mist" },
    { value: 0x00008000, name: "areaportal", label: "Area portal" },
    { value: 0x00010000, name: "playerclip", label: "Player clip" },
    { value: 0x00020000, name: "monsterclip", label: "Monster clip" },
    { value: 0x00040000, name: "current_0", label: "Current 0°" },
    { value: 0x00080000, name: "current_90", label: "Current 90°" },
    { value: 0x00100000, name: "current_180", label: "Current 180°" },
    { value: 0x00200000, name: "current_270", label: "Current 270°" },
    { value: 0x00400000, name: "current_up", label: "Current up" },
    { value: 0x00800000, name: "current_down", label: "Current down" },
    { value: 0x01000000, name: "origin", label: "Origin" },
    { value: 0x02000000, name: "monster", label: "Monster" },
    { value: 0x04000000, name: "deadmonster", label: "Dead monster" },
    { value: 0x08000000, name: "detail", label: "Detail" },
    { value: 0x10000000, name: "translucent", label: "Translucent" },
    { value: 0x20000000, name: "ladder", label: "Ladder" },
  ],
  flags: [
    { value: 0x01, name: "light", label: "Light" },
    { value: 0x02, name: "slick", label: "Slick" },
    { value: 0x04, name: "sky", label: "Sky" },
    { value: 0x08, name: "warp", label: "Warp" },
    { value: 0x10, name: "trans33", label: "33% translucent" },
    { value: 0x20, name: "trans66", label: "66% translucent" },
    { value: 0x40, name: "flowing", label: "Flowing" },
    { value: 0x80, name: "nodraw", label: "No draw" },
  ],
  valueLabel: "Light value",
} as const;

export function decodeSurfaceFlags(
  value: number | undefined,
  catalog: readonly SurfaceFlagDefinition[],
): DecodedSurfaceFlags {
  const normalized = (value ?? 0) >>> 0;
  let knownBits = 0;
  const active = catalog.filter((flag) => {
    knownBits = (knownBits | flag.value) >>> 0;
    return (normalized & flag.value) === flag.value;
  });
  return { active, unknownBits: (normalized & ~knownBits) >>> 0 };
}

export function decodeSurfaceAttributes(
  surface: SurfaceAttributes,
  semantics: SurfaceSemantics,
): {
  readonly contents: DecodedSurfaceFlags;
  readonly flags: DecodedSurfaceFlags;
  readonly value: number | undefined;
} {
  return {
    contents: decodeSurfaceFlags(surface.contents, semantics.contents),
    flags: decodeSurfaceFlags(surface.flags, semantics.flags),
    value: surface.value,
  };
}
