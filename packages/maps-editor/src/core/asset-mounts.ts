import type { WorldviewGameProfile } from "./worldview-project.js";

export type AssetMountKind =
  | "builtin"
  | "project-wad"
  | "browser-wad"
  | "browser-palette";

interface AssetMountBase {
  readonly id: string;
  readonly label: string;
  /** Lower priority mounts resolve first; later mounts replace conflicting material names. */
  readonly priority: number;
  readonly profile: WorldviewGameProfile;
}

export interface BuiltinAssetMount extends AssetMountBase {
  readonly kind: "builtin";
}

export interface ProjectWadAssetMount extends AssetMountBase {
  readonly kind: "project-wad";
  readonly sourceName: string;
  readonly contentFingerprint?: string | undefined;
}

export interface BrowserWadAssetMount extends AssetMountBase {
  readonly kind: "browser-wad";
  readonly sourceName: string;
  readonly contentFingerprint: string;
}

export interface BrowserPaletteAssetMount extends Omit<
  BrowserWadAssetMount,
  "kind"
> {
  readonly kind: "browser-palette";
}

export type AssetMountDescriptor =
  | BuiltinAssetMount
  | ProjectWadAssetMount
  | BrowserWadAssetMount
  | BrowserPaletteAssetMount;

export function orderAssetMounts(
  mounts: readonly AssetMountDescriptor[],
): readonly AssetMountDescriptor[] {
  return mounts.toSorted(
    (left, right) =>
      left.priority - right.priority || left.id.localeCompare(right.id),
  );
}
