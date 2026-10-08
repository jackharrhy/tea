/**
 * Regenerate folder and file previews job handler.
 *
 * Treats generated derivatives as stale and rebuilds supported file,
 * BSP, and folder previews from their canonical sources.
 */

import { db } from "#db/connection.server";
import { files, folders, type Job } from "#db";
import { eq, and, inArray } from "drizzle-orm";
import { readFile, unlink } from "fs/promises";
import { existsSync } from "fs";
import { createRequestLogger } from "evlog";

import { registerJobHandler, updateJobProgress } from "../jobs.server.ts";
import {
  generateModelPreview,
  generatePreview,
  canGenerateModelPreview,
  getFilePath,
  getPreviewPath,
  needsPreview,
} from "../files.server.ts";
import {
  deleteFolderPreview,
  generateFolderPreview,
} from "../folder-preview.server.ts";
import { generateBspDerivatives } from "../bsp-overview-renderer.server.ts";
import {
  createBspThumbnail,
  getBspThumbnailPath,
  getBspWalkabilityPath,
  getBspDependencyPath,
  writeBspDependencyManifest,
  writeDerivedFile,
} from "../bsp-derivatives.server.ts";
import { resolveApprovedBspAssetPlan } from "../bsp-assets.server.ts";
import { getAncestorFolderIds } from "../file-queries.server.ts";
import {
  previewJobInputSchema,
  type PreviewTarget,
} from "../preview-target.ts";
import { clearWADPreviewCache } from "../wad-assets.server.ts";

type PreviewFailure = {
  target: string;
  error: string;
};

type PreviewableFile = Pick<
  typeof files.$inferSelect,
  "id" | "path" | "name" | "kind"
>;
type PreviewMap = typeof files.$inferSelect;

const bspOverviewSize = 2_048;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function previewFailureError(failures: PreviewFailure[]): Error {
  const details = failures
    .map(({ target, error }) => `- ${target}: ${error}`)
    .join("\n");
  return new Error(
    `Preview regeneration failed for ${failures.length} target(s):\n${details}`,
  );
}

async function handleRegeneratePreviews(
  job: Job,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const log = createRequestLogger();
  log.set({ job: { id: job.id, type: job.type } });

  const options = previewJobInputSchema.parse(input);
  const includeFilePreviews = options.target.scope === "all";
  const plan = await createPreviewPlan(options.target);
  const failures: PreviewFailure[] = [];

  if (options.target.scope === "all") {
    await updateJobProgress(job.id, 1, "Clearing stale derived caches...");
    await clearWADPreviewCache();
  }

  // Phase 1: Rebuild every supported file preview from its source file.
  let modelPreviews = 0;
  let imagePreviews = 0;
  if (includeFilePreviews) {
    await updateJobProgress(job.id, 2, "Finding generated file previews...");

    const previewableFiles = await db.query.files.findMany({
      where: eq(files.status, "approved"),
      columns: { id: true, path: true, name: true, kind: true },
    });
    const generatedPreviews = previewableFiles.filter(
      (file) =>
        (file.kind === "model" && canGenerateModelPreview(file.name)) ||
        needsPreview(file.name),
    );

    const total = generatedPreviews.length;
    await updateJobProgress(
      job.id,
      5,
      `Found ${total} generated file previews`,
    );

    for (let i = 0; i < generatedPreviews.length; i++) {
      const file = generatedPreviews[i];
      try {
        const kind = await regenerateFilePreview(file);
        if (kind === "model") modelPreviews += 1;
        else imagePreviews += 1;
      } catch (err) {
        const error = errorMessage(err);
        failures.push({ target: `file ${file.path}`, error });
        log.error(err instanceof Error ? err : new Error(error), {
          step: "file-preview",
          file: file.path,
        });
      }

      if (i % 20 === 0 || i === total - 1) {
        const progress = 5 + Math.floor((i / total) * 30);
        await updateJobProgress(
          job.id,
          progress,
          `File previews: ${modelPreviews + imagePreviews}/${i + 1} of ${total}...`,
        );
      }
    }
  }

  // Phase 2: Regenerate BSP overviews. WAD resolution can change independently of the BSP file,
  // so the explicit maintenance job intentionally refreshes existing map previews too.
  let mapPreviews = 0;
  await updateJobProgress(job.id, 35, "Finding BSP maps...");
  const maps = plan.maps;

  for (let index = 0; index < maps.length; index += 1) {
    const file = maps[index];
    try {
      await regenerateBspPreview(file);
      mapPreviews += 1;
    } catch (error) {
      const message = errorMessage(error);
      failures.push({ target: `map ${file.path}`, error: message });
      log.error(error instanceof Error ? error : new Error(message), {
        step: "bsp-overview",
        file: file.path,
      });
    }

    const progress = 35 + Math.floor(((index + 1) / maps.length) * 40);
    await updateJobProgress(
      job.id,
      progress,
      `BSP previews: ${mapPreviews}/${index + 1} of ${maps.length}...`,
    );
  }

  // Phase 3: Regenerate all folder previews
  await updateJobProgress(job.id, 75, "Regenerating folder previews...");

  const allFolders = plan.folders;

  let folderPreviews = 0;
  for (let i = 0; i < allFolders.length; i++) {
    try {
      await deleteFolderPreview(allFolders[i].id);
      const preview = await generateFolderPreview(allFolders[i].id);
      if (preview) folderPreviews++;
    } catch (err) {
      const error = errorMessage(err);
      failures.push({ target: `folder ${allFolders[i].slug}`, error });
      log.error(err instanceof Error ? err : new Error(error), {
        step: "folder-preview",
        folder: allFolders[i].slug,
      });
    }

    if (i % 20 === 0 || i === allFolders.length - 1) {
      const progress = 75 + Math.floor((i / allFolders.length) * 23);
      await updateJobProgress(
        job.id,
        progress,
        `Folder previews: ${folderPreviews}/${i + 1} of ${allFolders.length}...`,
      );
    }
  }

  log.emit();

  if (failures.length > 0) {
    throw previewFailureError(failures);
  }

  return {
    modelPreviews,
    imagePreviews,
    mapPreviews,
    folderPreviews,
    totalFolders: allFolders.length,
  };
}

async function regenerateFilePreview(
  file: PreviewableFile,
): Promise<"image" | "model"> {
  const sourcePath = getFilePath(file.path);
  const previewPath = getPreviewPath(file.path);
  setPreviewState(file, false);
  await unlink(previewPath).catch(() => {});
  if (!existsSync(sourcePath)) throw new Error("Source file is missing");

  const result =
    file.kind === "model"
      ? await generateModelPreview(await readFile(sourcePath), previewPath)
      : await generatePreview(sourcePath);
  if (result.isErr()) throw result.error;
  if (!result.value) throw new Error("Preview generator produced no output");

  setPreviewState(file, true);
  return file.kind === "model" ? "model" : "image";
}

async function regenerateBspPreview(file: PreviewMap): Promise<void> {
  const sourcePath = getFilePath(file.path);
  const previewPath = getPreviewPath(file.path);
  const thumbnailPath = getBspThumbnailPath(file.path);
  const walkabilityPath = getBspWalkabilityPath(file.path);
  const manifestPath = getBspDependencyPath(file.path);

  setPreviewState(file, false);
  await Promise.all(
    [previewPath, thumbnailPath, walkabilityPath, manifestPath].map((path) =>
      unlink(path).catch(() => {}),
    ),
  );
  if (!existsSync(sourcePath)) throw new Error("Source file is missing");

  const bytes = await readFile(sourcePath);
  const manifest = await writeBspDependencyManifest(file.path, bytes);
  const assets = await resolveApprovedBspAssetPlan(file, manifest.assets);
  const rendered = await generateBspDerivatives({
    appOrigin:
      process.env.ARTBIN_INTERNAL_ORIGIN ??
      `http://127.0.0.1:${process.env.PORT ?? "3000"}`,
    sources: {
      format: manifest.format,
      bspPath: sourcePath,
      ...(assets.palette
        ? { palettePath: getFilePath(assets.palette.path) }
        : {}),
      wadPaths: assets.wads.map((asset) => getFilePath(asset.path)),
      gameAssetPaths: mapAssetPaths(assets.gameAssets),
      skyboxPaths: mapAssetPaths(assets.skybox ?? undefined),
      spritePaths: mapAssetPaths(assets.sprites),
      soundPaths: mapAssetPaths(assets.sounds),
    },
    width: bspOverviewSize,
    height: bspOverviewSize,
  });

  const thumbnail = await createBspThumbnail(rendered.png);
  setPreviewState(file, false);
  await writeDerivedFile(previewPath, rendered.png);
  await writeDerivedFile(thumbnailPath, thumbnail);
  if (rendered.walkabilityJson) {
    await writeDerivedFile(walkabilityPath, rendered.walkabilityJson);
  }
  setPreviewState(file, true);
}

function setPreviewState(
  file: { id: string; path: string },
  hasPreview: boolean,
): void {
  const { changes } = db
    .update(files)
    .set({ hasPreview })
    .where(
      and(
        eq(files.id, file.id),
        eq(files.path, file.path),
        eq(files.status, "approved"),
      ),
    )
    .run();
  if (!changes)
    throw new Error(
      "Asset moved or was removed during preview generation; retry this target",
    );
}

registerJobHandler("regenerate-previews", handleRegeneratePreviews);

function mapAssetPaths(
  assets: Readonly<Record<string, { path: string }>> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(assets ?? {}).map(([name, asset]) => [
      name,
      getFilePath(asset.path),
    ]),
  );
}

export { handleRegeneratePreviews };

async function createPreviewPlan(target: PreviewTarget) {
  const targetCondition =
    target.scope === "file"
      ? eq(files.id, target.fileId)
      : target.scope === "folder"
        ? eq(files.folderId, target.folderId)
        : undefined;
  const mapFiles = await db.query.files.findMany({
    where: and(
      eq(files.kind, "map"),
      eq(files.status, "approved"),
      targetCondition,
    ),
  });
  // The map category also includes editable .map sources, which are not BSPs.
  const maps = mapFiles.filter((file) => /\.bsp$/i.test(file.name));
  if (target.scope === "all") {
    return {
      maps,
      folders: await db.query.folders.findMany({
        columns: { id: true, slug: true },
      }),
    };
  }

  const folderIds = await getAncestorFolderIds(
    target.scope === "folder"
      ? [target.folderId]
      : maps[0]
        ? [maps[0].folderId]
        : [],
  );
  return {
    maps,
    folders: await db.query.folders.findMany({
      where: inArray(folders.id, folderIds),
      columns: { id: true, slug: true },
    }),
  };
}
