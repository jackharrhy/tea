import { readFile } from "node:fs/promises";

import { eq } from "drizzle-orm";

import type { User } from "#db";
import { files, fileTags, folders, tags } from "#db";
import { db } from "#db/connection.server";
import { getFilePath } from "#lib/files.server";
import { getFolderTrail } from "#lib/file-queries.server";
import {
  getVisibleWADTextureByPath,
  inspectWADFile,
  isWADFilename,
} from "#lib/wad-assets.server";
import {
  hasBspWalkability,
  identifyBspFile,
  readBspDependencyManifest,
} from "#lib/bsp-derivatives.server";
import { resolveBspAssetPlan } from "#lib/bsp-assets.server";

import { mediaBspWalkabilityHref, mediaFileHref } from "../routes.ts";

const maxTextPreviewSize = 100 * 1_024;

export async function loadFilePage(path: string, user: User) {
  const file = await db.query.files.findFirst({ where: eq(files.path, path) });
  if (!file) {
    const texture = await getVisibleWADTextureByPath(path, user);
    if (!texture) return null;
    return {
      page: "wad-texture" as const,
      ...texture,
      folderTrail: await getFolderTrail(texture.file.folderId),
    };
  }

  if (
    file.status !== "approved" &&
    file.uploaderId !== user.id &&
    !user.isAdmin
  ) {
    return null;
  }

  if (isWADFilename(file.name)) {
    try {
      if (await inspectWADFile(file.path, file.sha256)) {
        return { page: "wad-redirect" as const, path: file.path };
      }
    } catch {
      // Invalid WAD files retain the ordinary file page.
    }
  }

  const [folder, trail, tagRecords] = await Promise.all([
    db.query.folders.findFirst({ where: eq(folders.id, file.folderId) }),
    getFolderTrail(file.folderId),
    db
      .select({ tag: tags })
      .from(fileTags)
      .innerJoin(tags, eq(fileTags.tagId, tags.id))
      .where(eq(fileTags.fileId, file.id)),
  ]);

  let textContent: string | null = null;
  const textFile = isTextMimeType(file.mimeType);
  const textTruncated = textFile && file.size > maxTextPreviewSize;
  if (textFile && !textTruncated) {
    try {
      textContent = await readFile(getFilePath(file.path), "utf8");
    } catch {
      textContent = null;
    }
  }

  let modelTexture: string | null = null;
  let modelMtl: string | null = null;
  let availableTextures: Array<{ name: string; url: string }> = [];
  let modelAnimations: Array<{ name: string; url: string }> = [];
  const bspIdentification = file.name.toLowerCase().endsWith(".bsp")
    ? await identifyBspFile(file.path)
    : null;
  const bspDependencies = bspIdentification
    ? await readBspDependencyManifest(file.path)
    : null;
  const bspAssets = bspDependencies
    ? await resolveBspAssetPlan(file, bspDependencies.assets, user)
    : null;

  if (file.kind === "model") {
    const siblings = await db.query.files.findMany({
      where: eq(files.folderId, file.folderId),
    });
    const siblingTextures = siblings.filter(
      (candidate) => candidate.kind === "texture",
    );
    availableTextures = siblingTextures.map((candidate) => ({
      name: candidate.name,
      url: textureUrl(candidate),
    }));

    const baseName = file.name.replace(/\.[^.]+$/, "").toLowerCase();
    const preferred = siblingTextures.find((candidate) => {
      const candidateBase = candidate.name
        .replace(/\.[^.]+$/, "")
        .toLowerCase();
      return (
        candidateBase === baseName ||
        ["skin", "skin0", "skin1", "default"].includes(candidateBase)
      );
    });
    const diffuse = siblingTextures.find(
      (candidate) =>
        !/_(?:normal|nrm|bump|spec|glow|emit|ao|height|rough)/i.test(
          candidate.name,
        ),
    );
    const chosen =
      preferred ??
      (siblingTextures.length === 1 ? siblingTextures[0] : diffuse);
    if (chosen) modelTexture = textureUrl(chosen);

    if (file.name.toLowerCase().endsWith(".obj")) {
      const mtl = siblings.find(
        (candidate) =>
          candidate.path.toLowerCase() ===
          file.path.replace(/\.obj$/i, ".mtl").toLowerCase(),
      );
      if (mtl) modelMtl = mediaFileHref(mtl);
    }
    if (file.name.toLowerCase().endsWith(".md5mesh")) {
      modelAnimations = siblings
        .filter((candidate) =>
          candidate.name.toLowerCase().endsWith(".md5anim"),
        )
        .map((candidate) => ({
          name: candidate.name.replace(/\.md5anim$/i, ""),
          url: mediaFileHref(candidate),
        }));
    }
  }

  return {
    page: "file" as const,
    file,
    folder: folder ?? null,
    ancestors: trail.filter((item) => item.id !== file.folderId),
    tags: tagRecords.map(({ tag }) => tag),
    textContent,
    textTruncated,
    modelTexture,
    modelMtl,
    availableTextures,
    modelAnimations,
    bspFormat: bspDependencies?.format ?? bspIdentification?.format ?? null,
    bspWadUrls: bspAssets?.wads.map((wad) => mediaFileHref(wad)) ?? [],
    bspPaletteUrl: bspAssets?.palette ? mediaFileHref(bspAssets.palette) : null,
    bspGameAssetUrls: mapAssetUrls(bspAssets?.gameAssets),
    bspSkyboxUrls: mapAssetUrls(bspAssets?.skybox ?? undefined),
    bspSpriteUrls: mapAssetUrls(bspAssets?.sprites),
    bspSoundUrls: mapAssetUrls(bspAssets?.sounds),
    bspWalkabilityUrl:
      bspIdentification &&
      bspIdentification.format !== "quake2-bsp38" &&
      hasBspWalkability(file.path)
        ? mediaBspWalkabilityHref(file)
        : null,
  };
}

function mapAssetUrls(
  assets: Readonly<Record<string, { id: string; name: string }>> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(assets ?? {}).map(([name, asset]) => [
      name,
      mediaFileHref(asset),
    ]),
  );
}

function textureUrl(file: {
  id: string;
  name: string;
  hasPreview: boolean | null;
}): string {
  return mediaFileHref(file, { preview: Boolean(file.hasPreview) });
}

export function isTextMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml" ||
    mimeType === "application/javascript"
  );
}

export type FilePageData = NonNullable<
  Awaited<ReturnType<typeof loadFilePage>>
>;
export type StandardFilePageData = Extract<FilePageData, { page: "file" }>;
export type WadTexturePageData = Extract<FilePageData, { page: "wad-texture" }>;
