import { basename, dirname } from "node:path";

import { and, eq, inArray, or, sql } from "drizzle-orm";
import type {
  WorldAssetPlan,
  WorldSkyboxSuffix,
} from "@jackharrhy/worldview/core";

import type { User } from "#db";
import { files } from "#db";
import { db } from "#db/connection.server";

type AssetFile = typeof files.$inferSelect;

export interface BspAsset {
  readonly id: string;
  readonly name: string;
  readonly path: string;
}

export interface ResolvedBspAssets {
  readonly palette: BspAsset | null;
  readonly wads: readonly BspAsset[];
  readonly gameAssets: Readonly<Record<string, BspAsset>>;
  readonly skybox: Readonly<
    Partial<Record<WorldSkyboxSuffix, BspAsset>>
  > | null;
  readonly sprites: Readonly<Record<string, BspAsset>>;
  readonly sounds: Readonly<Record<string, BspAsset>>;
}

const providedAssetRoot = "_provided";

export async function resolveBspPalette(
  bsp: Pick<AssetFile, "path">,
  user: User,
): Promise<BspAsset | null> {
  const candidates = (await findVisibleNamedFiles("palette.lmp", user)).map(
    uploadAsset,
  );
  return selectBspAsset(bsp.path, candidates);
}

export async function resolveApprovedBspPalette(
  bsp: Pick<AssetFile, "path">,
): Promise<BspAsset | null> {
  const candidates = (await findApprovedNamedFiles("palette.lmp")).map(
    uploadAsset,
  );
  return selectBspAsset(bsp.path, candidates);
}

export async function resolveApprovedWalPalette(
  path: string,
): Promise<BspAsset | null> {
  const candidates = (await findApprovedNamedFiles("colormap.pcx")).map(
    uploadAsset,
  );
  return selectBspAsset(
    path,
    candidates.filter((asset) => /\/pics\/colormap\.pcx$/i.test(asset.path)),
  );
}

export async function resolveBspAssetPlan(
  bsp: AssetFile,
  plan: WorldAssetPlan,
  user: User,
): Promise<ResolvedBspAssets> {
  return resolveAssetPlan(bsp, plan, user.isAdmin ? undefined : user);
}

export async function resolveApprovedBspAssetPlan(
  bsp: AssetFile,
  plan: WorldAssetPlan,
): Promise<ResolvedBspAssets> {
  return resolveAssetPlan(bsp, plan, null);
}

export function selectBspAsset<T extends Pick<AssetFile, "path">>(
  bspPath: string,
  candidates: readonly T[],
): T | null {
  let selected: T | null = null;
  let selectedScore = -1;
  for (const candidate of candidates) {
    const score = assetScore(bspPath, candidate.path);
    if (score > selectedScore) {
      selected = candidate;
      selectedScore = score;
    }
  }
  return selected;
}

function assetScore(bspPath: string, candidatePath: string): number {
  const bspDirectory = pathParts(dirname(bspPath));
  const candidateDirectory = pathParts(dirname(candidatePath));
  const provided =
    candidateDirectory[0]?.toLowerCase() === providedAssetRoot.toLowerCase();
  let common = 0;
  while (
    common < bspDirectory.length &&
    common < candidateDirectory.length &&
    bspDirectory[common]!.toLowerCase() ===
      candidateDirectory[common]!.toLowerCase()
  ) {
    common += 1;
  }

  // Nearby assets must share their top-level imported collection. Curated assets are the fallback.
  if (common === 0)
    return provided
      ? 100 + providedGameScore(bspDirectory, candidateDirectory)
      : -1;
  const distance = bspDirectory.length + candidateDirectory.length - common * 2;
  return 1_000 + common * 100 - distance;
}

function providedGameScore(
  bspPath: readonly string[],
  candidatePath: readonly string[],
): number {
  const bspSegments = new Set(bspPath.map((segment) => segment.toLowerCase()));
  const candidateSegments = new Set(
    candidatePath.map((segment) => segment.toLowerCase()),
  );
  const families = [
    { map: ["cstrike"], provided: "cstrike" },
    { map: ["id1", "quake"], provided: "quake" },
    { map: ["baseq2", "quake2"], provided: "quake2" },
    {
      map: ["valve", "gearbox", "tfc", "dmc", "ricochet", "goldsrc"],
      provided: "goldsrc",
    },
  ];
  return families.some(
    (family) =>
      candidateSegments.has(family.provided) &&
      family.map.some((segment) => bspSegments.has(segment)),
  )
    ? 50
    : 0;
}

function pathParts(path: string): string[] {
  return path.replaceAll("\\", "/").split("/").filter(Boolean);
}

async function resolveAssetPlan(
  bsp: AssetFile,
  plan: WorldAssetPlan,
  user: User | null | undefined,
): Promise<ResolvedBspAssets> {
  const gameAssetCandidates = [
    ...(plan.palette?.candidates ?? []),
    ...plan.textures.flatMap((asset) => [
      ...asset.imageCandidates,
      ...asset.walCandidates,
    ]),
    ...(plan.skybox?.faces.flatMap((face) => face.candidates) ?? []),
  ];
  const allCandidates = [
    ...gameAssetCandidates,
    ...plan.wads.flatMap((asset) => asset.candidates),
    ...plan.sprites.flatMap((asset) => asset.candidates),
    ...plan.sounds.flatMap((asset) => asset.candidates),
  ];
  const candidates = await findPlanCandidates(bsp.path, allCandidates, user);
  const resolved = (paths: readonly string[]) =>
    resolveFirstCandidate(bsp.path, paths, candidates);
  const gameAssets: Record<string, BspAsset> = {};
  for (const path of gameAssetCandidates) {
    const asset = resolved([path]);
    if (asset) gameAssets[path] = uploadAsset(asset);
  }

  const skybox = plan.skybox
    ? Object.fromEntries(
        plan.skybox.faces.flatMap((face) => {
          const asset = resolved(face.candidates);
          return asset ? [[face.suffix, uploadAsset(asset)] as const] : [];
        }),
      )
    : null;
  const sprites = Object.fromEntries(
    plan.sprites.flatMap((entry) => {
      const asset = resolved(entry.candidates);
      return asset
        ? [[entry.reference.normalizedPath, uploadAsset(asset)] as const]
        : [];
    }),
  );
  const sounds = Object.fromEntries(
    plan.sounds.flatMap((entry) => {
      const asset = resolved(entry.candidates);
      return asset
        ? [[entry.reference.normalizedPath, uploadAsset(asset)] as const]
        : [];
    }),
  );

  return {
    palette: plan.palette
      ? uploadAssetOrNull(resolved(plan.palette.candidates))
      : null,
    wads: plan.wads.flatMap((entry) => {
      const asset = resolved(entry.candidates);
      return asset ? [uploadAsset(asset)] : [];
    }),
    gameAssets,
    skybox,
    sprites,
    sounds,
  };
}

async function findPlanCandidates(
  bspPath: string,
  logicalPaths: readonly string[],
  user: User | null | undefined,
): Promise<AssetFile[]> {
  const names = [
    ...new Set(logicalPaths.map((path) => basename(path).toLowerCase())),
  ];
  if (names.length === 0) return [];
  const visibility =
    user === undefined
      ? undefined
      : user === null
        ? eq(files.status, "approved")
        : or(eq(files.status, "approved"), eq(files.uploaderId, user.id));
  const records: AssetFile[] = [];
  for (let offset = 0; offset < names.length; offset += 400) {
    records.push(
      ...(await db.query.files.findMany({
        where: and(
          inArray(sql`lower(${files.name})`, names.slice(offset, offset + 400)),
          visibility,
        ),
      })),
    );
  }
  const collection = pathParts(bspPath)[0]?.toLowerCase();
  return records.filter((file) => {
    const root = pathParts(file.path)[0]?.toLowerCase();
    return root === collection || root === providedAssetRoot;
  });
}

function resolveFirstCandidate(
  bspPath: string,
  logicalPaths: readonly string[],
  candidates: readonly AssetFile[],
): AssetFile | null {
  for (const logicalPath of logicalPaths) {
    const normalized = logicalPath.toLowerCase();
    const matches = candidates.filter((candidate) => {
      const path = candidate.path.replaceAll("\\", "/").toLowerCase();
      const provided = pathParts(path)[0] === providedAssetRoot;
      return (
        path === normalized ||
        path.endsWith(`/${normalized}`) ||
        (provided && basename(path) === basename(normalized))
      );
    });
    const selected = selectBspAsset(bspPath, matches);
    if (selected) return selected;
  }
  return null;
}

function uploadAssetOrNull(file: AssetFile | null): BspAsset | null {
  return file ? uploadAsset(file) : null;
}

async function findVisibleNamedFiles(
  name: string,
  user: User,
): Promise<AssetFile[]> {
  const visibility = user.isAdmin
    ? undefined
    : or(eq(files.status, "approved"), eq(files.uploaderId, user.id));
  return db.query.files.findMany({
    where: and(sql`lower(${files.name}) = lower(${name})`, visibility),
  });
}

async function findApprovedNamedFiles(name: string): Promise<AssetFile[]> {
  return db.query.files.findMany({
    where: and(
      sql`lower(${files.name}) = lower(${name})`,
      eq(files.status, "approved"),
    ),
  });
}

function uploadAsset(file: AssetFile): BspAsset {
  return { id: file.id, name: file.name, path: file.path };
}
