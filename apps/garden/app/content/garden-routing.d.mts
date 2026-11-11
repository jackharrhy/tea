export interface GardenEntryInput {
  path: string;
  kind?: "note" | "asset";
  aliases?: string[];
}

export interface GardenEntry {
  sourcePath: string;
  stemPath: string;
  basename: string;
  routeId: string;
  url: string;
  kind: "note" | "asset";
  aliases: string[];
}

export interface GardenIndex {
  entries: GardenEntry[];
  lookup: Map<string, GardenEntry[]>;
  routeIds: Map<string, GardenEntry>;
  collisions: {
    key: string;
    entries: GardenEntry[];
    type: "route" | "lookup";
  }[];
}

export function canonicalRouteId(vaultRelativePath: string): string;
export function buildGardenIndex(
  entries: GardenEntryInput[],
  options?: { assetUrlPrefix?: string },
): GardenIndex;
export function resolveWikiLink(
  raw: string,
  index: GardenIndex,
):
  | {
      ok: true;
      raw: string;
      targetText: string;
      label?: string;
      anchor?: string;
      embed: boolean;
      target: GardenEntry;
      url: string;
      media: boolean;
    }
  | {
      ok: false;
      raw: string;
      targetText: string;
      label?: string;
      anchor?: string;
      embed: boolean;
      reason: "not-found" | "ambiguous";
      candidates?: GardenEntry[];
    };
