import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

interface FixtureCameraDefinition {
  readonly position: readonly [number, number, number];
  readonly yawDegrees: number;
  readonly pitchDegrees: number;
  readonly fieldOfView?: number;
}

const STEAM_CORPUS_SAMPLE_SIZE = 3;
const GAME_ASSET_PATH =
  /^(?:[^/]+\.wad|textures\/.+\.(?:wal|png|jpe?g|tga)|(?:gfx\/)?env\/.+\.(?:png|jpe?g|tga)|pics\/colormap\.pcx|gfx\/palette\.lmp)$/iu;

const CorpusPathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !path.posix.isAbsolute(value) &&
      !value.includes("\\") &&
      value === path.posix.normalize(value) &&
      value !== ".." &&
      !value.startsWith("../"),
    "must be a normalized relative POSIX path",
  );

const ManifestSchema = z.object({
  records: z.array(
    z.object({
      appId: z.string().regex(/^\d+$/u),
      outputPath: CorpusPathSchema,
    }),
  ),
  assets: z.array(
    z.object({
      appId: z.string().regex(/^\d+$/u),
      logicalPath: CorpusPathSchema,
      outputPath: CorpusPathSchema,
    }),
  ),
});

const CompatibilityReportSchema = z.object({
  failures: z.array(z.object({ outputPath: CorpusPathSchema })),
});

interface SteamCorpusGame {
  readonly name: string;
  readonly slug: string;
  readonly anchor?: string;
  readonly anchorCamera?: FixtureCameraDefinition;
  readonly contentRoots?: readonly string[];
}

export interface SteamCorpusLevel {
  readonly filename: string;
  readonly relativePath: string;
  readonly mapPath: string;
  readonly appId: string;
  readonly game: SteamCorpusGame;
}

export interface SteamCorpusFixtures {
  readonly levels: readonly SteamCorpusLevel[];
  readonly assetsByApp: ReadonlyMap<string, readonly string[]>;
}

const steamGames: Readonly<Record<string, SteamCorpusGame>> = {
  "10": {
    name: "Counter-Strike",
    slug: "counter-strike",
    contentRoots: ["cstrike"],
  },
  "20": {
    name: "Team Fortress Classic",
    slug: "team-fortress-classic",
    contentRoots: ["tfc"],
  },
  "30": { name: "Day of Defeat", slug: "day-of-defeat", contentRoots: ["dod"] },
  "40": {
    name: "Deathmatch Classic",
    slug: "deathmatch-classic",
    contentRoots: ["dmc"],
  },
  "50": {
    name: "Half-Life: Opposing Force",
    slug: "opposing-force",
    contentRoots: ["gearbox"],
  },
  "60": {
    name: "Ricochet",
    slug: "ricochet",
    anchor: "rc_arena",
    contentRoots: ["ricochet"],
  },
  "70": { name: "Half-Life", slug: "half-life", contentRoots: ["valve"] },
  "80": {
    name: "Counter-Strike: Condition Zero",
    slug: "condition-zero",
    contentRoots: ["czero"],
  },
  "130": {
    name: "Half-Life: Blue Shift",
    slug: "blue-shift",
    anchor: "ba_canal1",
    contentRoots: ["bshift"],
  },
  "2310": { name: "Quake", slug: "quake" },
  "2320": {
    name: "Quake II",
    slug: "quake-ii",
    anchor: "mgu1m1",
    anchorCamera: {
      position: [1032, -256, 46],
      yawDegrees: -30,
      pitchDegrees: 0,
      fieldOfView: 75,
    },
  },
  "225840": {
    name: "Sven Co-op",
    slug: "sven-co-op",
    contentRoots: ["svencoop", "svencoop_event_april"],
  },
  "1000410": { name: "WRATH: Aeon of Ruin", slug: "wrath" },
  "3191050": {
    name: "BRAZILIAN DRUG DEALER 3",
    slug: "brazilian-drug-dealer-3",
    contentRoots: ["id1"],
  },
  "4484420": {
    name: "FLESHCANCER",
    slug: "fleshcancer",
    anchor: "dm1",
    contentRoots: ["id1"],
  },
};

const thirtyFlights: SteamCorpusGame = {
  name: "Thirty Flights of Loving",
  slug: "thirty-flights-of-loving",
  anchor: "bar1",
};
const gravityBone: SteamCorpusGame = {
  name: "Gravity Bone",
  slug: "gravity-bone",
  anchor: "hof1",
};

function corpusGame(appId: string, relativePath: string): SteamCorpusGame {
  if (appId === "214700") {
    if (relativePath.includes("/pak0.pk3/")) return thirtyFlights;
    if (relativePath.includes("/pak1.pk3/")) return gravityBone;
  }
  return (
    steamGames[appId] ?? { name: `Steam ${appId}`, slug: `steam-${appId}` }
  );
}

function corpusFilename(root: string, relativePath: string): string {
  return path.join(root, ...relativePath.split("/"));
}

function steamCorpusLevel(
  fixtureRoot: string,
  appId: string,
  relativePath: string,
): SteamCorpusLevel | null {
  const parts = relativePath.split("/");
  if (parts[0] !== appId)
    throw new Error(`${relativePath}: app ID does not match ${appId}`);
  const mapsIndex = parts.lastIndexOf("maps");
  if (mapsIndex < 0 || mapsIndex === parts.length - 1) return null;
  const mapPath = parts
    .slice(mapsIndex + 1)
    .join("/")
    .replace(/\.bsp$/iu, "");
  const basename = path.posix.basename(mapPath);
  if (!mapPath || basename.startsWith("b_")) return null;
  const game = corpusGame(appId, relativePath);
  const contentRoots = game.contentRoots;
  if (
    contentRoots &&
    !parts.slice(1, mapsIndex).some((part) => contentRoots.includes(part))
  ) {
    return null;
  }
  if (game.slug === "fleshcancer" && !relativePath.includes("/loose/"))
    return null;
  return {
    filename: corpusFilename(fixtureRoot, relativePath),
    relativePath,
    mapPath,
    appId,
    game,
  };
}

function sampleScore(level: SteamCorpusLevel): string {
  return createHash("sha256")
    .update(`${level.game.slug}/${level.relativePath}`)
    .digest("hex");
}

function sampledLevels(
  levels: readonly SteamCorpusLevel[],
  incompatibleFiles: ReadonlySet<string>,
): readonly SteamCorpusLevel[] {
  const byGame = new Map<string, Map<string, SteamCorpusLevel>>();
  for (const level of levels) {
    if (incompatibleFiles.has(level.relativePath)) continue;
    const uniqueLevels = byGame.get(level.game.slug);
    if (uniqueLevels) uniqueLevels.set(level.mapPath, level);
    else byGame.set(level.game.slug, new Map([[level.mapPath, level]]));
  }
  const sampled: SteamCorpusLevel[] = [];
  for (const uniqueLevels of byGame.values()) {
    const candidates = [...uniqueLevels.values()];
    const anchor = candidates.find(
      ({ game, mapPath }) => path.posix.basename(mapPath) === game.anchor,
    );
    const remainder = candidates
      .filter((level) => level !== anchor)
      .toSorted((left, right) =>
        sampleScore(left).localeCompare(sampleScore(right)),
      );
    sampled.push(
      ...(anchor ? [anchor] : []),
      ...remainder.slice(0, STEAM_CORPUS_SAMPLE_SIZE - (anchor ? 1 : 0)),
    );
  }
  return sampled.toSorted(
    (left, right) =>
      left.game.name.localeCompare(right.game.name) ||
      left.mapPath.localeCompare(right.mapPath),
  );
}

async function jsonFile(
  filename: string,
  optional = false,
): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === "ENOENT")
      return null;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${filename}: ${message}`, { cause: error });
  }
}

function parseJson<T>(
  schema: z.ZodType<T>,
  value: unknown,
  filename: string,
): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new Error(`${filename}: ${z.prettifyError(result.error)}`, {
    cause: result.error,
  });
}

async function incompatibleCorpusFiles(
  fixtureRoot: string,
): Promise<ReadonlySet<string>> {
  const reportPath = path.join(fixtureRoot, "compatibility-report.json");
  const value = await jsonFile(reportPath, true);
  if (value === null) return new Set();
  const report = parseJson(CompatibilityReportSchema, value, reportPath);
  return new Set(report.failures.map(({ outputPath }) => outputPath));
}

export async function discoverSteamCorpusFixtures(
  fixtureRoot: string,
): Promise<SteamCorpusFixtures> {
  const manifestPath = path.join(fixtureRoot, "manifest.json");
  const manifest = parseJson(
    ManifestSchema,
    await jsonFile(manifestPath),
    manifestPath,
  );
  const candidates = manifest.records
    .map(({ appId, outputPath }) =>
      steamCorpusLevel(fixtureRoot, appId, outputPath),
    )
    .filter((level): level is SteamCorpusLevel => level !== null);
  const levels = sampledLevels(
    candidates,
    await incompatibleCorpusFiles(fixtureRoot),
  );
  const assetsByApp = new Map<string, string[]>();
  for (const { appId, logicalPath, outputPath } of manifest.assets) {
    if (!GAME_ASSET_PATH.test(logicalPath)) {
      throw new Error(
        `${manifestPath}: unsupported game asset path ${logicalPath}`,
      );
    }
    if (outputPath !== `${appId}/game/${logicalPath}`) {
      throw new Error(
        `${manifestPath}: asset output does not match its logical path`,
      );
    }
    const assets = assetsByApp.get(appId);
    if (assets) assets.push(logicalPath);
    else assetsByApp.set(appId, [logicalPath]);
  }
  for (const [appId, assets] of assetsByApp) {
    assetsByApp.set(
      appId,
      [...new Set(assets)].toSorted((left, right) => left.localeCompare(right)),
    );
  }
  return { levels, assetsByApp };
}
