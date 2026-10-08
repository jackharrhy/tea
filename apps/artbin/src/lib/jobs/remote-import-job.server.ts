import { mkdtemp, rm } from "node:fs/promises";
import { basename, extname, join, posix } from "node:path";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createRequestLogger } from "evlog";

import { db } from "#db/connection.server";
import { files, folders, remoteImports, type Job } from "#db";
import {
  ensureDir,
  finalizeFolders,
  getOrCreateFolder,
  ingestFile,
  ROOT_FOLDER,
  sanitizeFilename,
  TEMP_DIR,
} from "../files.server.ts";
import { registerJobHandler, updateJobProgress } from "../jobs.server.ts";
import {
  extractSafeArchiveEntry,
  findRedundantArchiveRoot,
  listSafeArchiveEntries,
  stripArchiveRoot,
} from "../archive-reader.server.ts";
import { extractBspTextures } from "../bsp-texture-extraction.server.ts";
import {
  describeRemoteImport,
  fetchRemoteImportManifest,
  type RemoteImportProvider,
} from "../import-sources.server.ts";
import { downloadRemoteFile } from "../remote-download.server.ts";

export interface RemoteImportJobInput {
  sourceUrl: string;
  targetFolderId?: string | null;
  userId?: string;
}

export interface RemoteImportJobOutput {
  provider: RemoteImportProvider;
  externalId: string;
  sourceUrl: string;
  folderId: string;
  folderSlug: string;
  totalFiles: number;
  extractedTextures: number;
  skippedFiles: number;
  filesByKind: Record<string, number>;
  errors: string[];
}

const SAFE_REMOTE_ASSET_EXTENSIONS = new Set([
  // GoldSource maps and source material
  ".bsp",
  ".wad",
  ".map",
  ".rmf",
  ".jmf",
  ".res",
  ".nav",
  ".nod",
  ".ent",
  // Models, sprites, and textures
  ".mdl",
  ".spr",
  ".obj",
  ".gltf",
  ".glb",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".tga",
  ".bmp",
  ".pcx",
  ".dds",
  ".vtf",
  ".wal",
  // Audio
  ".wav",
  ".mp3",
  ".ogg",
  ".flac",
  // Map configuration and AngelScript source
  ".cfg",
  ".txt",
  ".json",
  ".xml",
  ".ini",
  ".lst",
  ".sc",
  ".as",
  ".inc",
  ".lip",
]);

export function isSafeRemoteAssetPath(path: string): boolean {
  const parts = path.split("/");
  if (parts.some((part) => part.startsWith(".") || part === "__MACOSX"))
    return false;
  return SAFE_REMOTE_ASSET_EXTENSIONS.has(extname(path).toLowerCase());
}

function slugifySegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "import"
  );
}

function isArchiveName(name: string): boolean {
  return (
    /\.(?:zip|7z|rar)$/i.test(name) ||
    /\.(?:zip|7z)\.\d{3}$/i.test(name) ||
    /\.part\d+\.rar$/i.test(name)
  );
}

function isFirstArchiveVolume(name: string): boolean {
  if (/\.(?:zip|7z)\.\d{3}$/i.test(name))
    return name.toLowerCase().endsWith(".001");
  if (/\.part\d+\.rar$/i.test(name)) return /\.part0*1\.rar$/i.test(name);
  return /\.(?:zip|7z|rar)$/i.test(name);
}

interface ResolvedDestination {
  key: string;
  id: string | typeof ROOT_FOLDER;
  slug: string | null;
}

async function resolveDestination(
  targetFolderId?: string | null,
): Promise<ResolvedDestination> {
  if (!targetFolderId) {
    return { key: "root", id: ROOT_FOLDER, slug: null as string | null };
  }
  const folder = await db.query.folders.findFirst({
    where: eq(folders.id, targetFolderId),
  });
  if (!folder)
    throw new Error("The selected destination folder no longer exists");
  return { key: folder.id, id: folder.id, slug: folder.slug };
}

async function getImportFolder(
  provider: RemoteImportProvider,
  externalId: string,
  destination: Awaited<ReturnType<typeof resolveDestination>>,
  title: string,
  description: string,
): Promise<{ id: string; slug: string }> {
  const previous = await db.query.remoteImports.findFirst({
    where: and(
      eq(remoteImports.provider, provider),
      eq(remoteImports.externalId, externalId),
      eq(remoteImports.destinationKey, destination.key),
    ),
  });
  if (previous) {
    const folder = await db.query.folders.findFirst({
      where: eq(folders.id, previous.folderId),
    });
    if (folder) return { id: folder.id, slug: folder.slug };
  }

  const baseSegment = slugifySegment(title);
  let slug = destination.slug
    ? `${destination.slug}/${baseSegment}`
    : baseSegment;
  const collision = await db.query.folders.findFirst({
    where: eq(folders.slug, slug),
  });
  if (collision) {
    if (collision.description === description) {
      return { id: collision.id, slug: collision.slug };
    }
    slug = destination.slug
      ? `${destination.slug}/${baseSegment}-${provider}-${externalId}`
      : `${baseSegment}-${provider}-${externalId}`;
  }

  const id = await getOrCreateFolder(slug, title, destination.id, description);
  return { id, slug };
}

async function ensureArchiveFolder(
  relativeDirectory: string,
  baseFolder: { id: string; slug: string },
  folderMap: Map<string, string>,
): Promise<{ id: string; slug: string }> {
  if (!relativeDirectory || relativeDirectory === ".") return baseFolder;
  const segments = relativeDirectory.split("/");
  let sourcePath = "";
  let slug = baseFolder.slug;
  let parentId = baseFolder.id;

  for (const segment of segments) {
    sourcePath = sourcePath ? `${sourcePath}/${segment}` : segment;
    slug = `${slug}/${slugifySegment(segment)}`;
    const existingId = folderMap.get(sourcePath);
    if (existingId) {
      parentId = existingId;
      continue;
    }
    parentId = await getOrCreateFolder(slug, segment, parentId);
    folderMap.set(sourcePath, parentId);
  }

  return { id: parentId, slug };
}

async function handleRemoteImport(
  job: Job,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { sourceUrl, targetFolderId, userId } =
    input as unknown as RemoteImportJobInput;
  if (!sourceUrl) throw new Error("Missing remote import URL");

  const log = createRequestLogger();
  log.set({ job: { id: job.id, type: job.type } });
  await updateJobProgress(job.id, 2, "Reading source metadata...");
  const manifest = await fetchRemoteImportManifest(sourceUrl);
  const destination = await resolveDestination(targetFolderId);
  const description = describeRemoteImport(manifest);
  const importFolder = await getImportFolder(
    manifest.provider,
    manifest.externalId,
    destination,
    manifest.title,
    description,
  );
  const folderMap = new Map<string, string>([["", importFolder.id]]);
  const affectedFolderIds = new Set<string>([importFolder.id]);

  await ensureDir(TEMP_DIR);
  const tempDirectory = await mkdtemp(join(TEMP_DIR, "remote-import-"));
  const downloaded: Array<{ name: string; path: string }> = [];
  const errors: string[] = [];
  const filesByKind: Record<string, number> = {};
  let importedFiles = 0;
  let extractedTextures = 0;
  let skippedFiles = 0;
  let supportedFilesSeen = 0;
  const usedDownloadNames = new Set<string>();

  try {
    for (let index = 0; index < manifest.files.length; index++) {
      const remoteFile = manifest.files[index];
      const sanitizedName = sanitizeFilename(remoteFile.name);
      const nameKey = sanitizedName.toLowerCase();
      const fileName = usedDownloadNames.has(nameKey)
        ? `${String(index + 1).padStart(2, "0")}-${sanitizedName}`
        : sanitizedName;
      usedDownloadNames.add(nameKey);
      const tempPath = join(tempDirectory, fileName);
      await updateJobProgress(
        job.id,
        5 + Math.floor((index / manifest.files.length) * 15),
        `Downloading ${remoteFile.name} (${index + 1}/${manifest.files.length})...`,
      );
      try {
        await downloadRemoteFile(
          manifest.provider,
          remoteFile.url,
          tempPath,
          remoteFile.size,
          remoteFile.md5,
        );
        downloaded.push({ name: remoteFile.name, path: tempPath });
      } catch (error) {
        const message = `${remoteFile.name}: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(message);
        log.error(error instanceof Error ? error : new Error(String(error)), {
          step: "remote-download",
          file: remoteFile.name,
        });
      }
    }

    if (downloaded.length === 0) {
      throw new Error(
        errors[0] ?? "None of the remote files could be downloaded",
      );
    }

    const archives = downloaded.filter(
      (file) => isArchiveName(file.name) && isFirstArchiveVolume(file.name),
    );
    const directFiles = downloaded.filter((file) => !isArchiveName(file.name));
    const archiveEntries = new Map<
      string,
      {
        entries: Awaited<ReturnType<typeof listSafeArchiveEntries>>;
        redundantRoot: string | null;
      }
    >();
    let totalWork = directFiles.length;

    for (const archive of archives) {
      await updateJobProgress(job.id, 20, `Inspecting ${archive.name}...`);
      const entries = await listSafeArchiveEntries(archive.path);
      archiveEntries.set(archive.path, {
        entries,
        redundantRoot: findRedundantArchiveRoot(
          entries,
          manifest.title,
          archive.name,
        ),
      });
      totalWork += entries.length;
    }

    let completedWork = 0;
    const ingestAsset = async (
      buffer: Buffer,
      relativePath: string,
      sourceArchive: string,
    ): Promise<void> => {
      if (!isSafeRemoteAssetPath(relativePath)) {
        skippedFiles++;
        return;
      }
      supportedFilesSeen++;

      const directory = posix.dirname(relativePath);
      const targetFolder = await ensureArchiveFolder(
        directory,
        importFolder,
        folderMap,
      );
      affectedFolderIds.add(targetFolder.id);
      const fileName = sanitizeFilename(posix.basename(relativePath));
      const storedPath = `${targetFolder.slug}/${fileName}`;
      const existing = await db.query.files.findFirst({
        where: eq(files.path, storedPath),
      });
      if (existing) {
        skippedFiles++;
        const textureResult = await extractBspTextures({
          buffer,
          fileName,
          parentFolderSlug: targetFolder.slug,
          parentFolderId: targetFolder.id,
          uploaderId: userId || null,
        });
        extractedTextures += textureResult.textureCount;
        if (textureResult.folderId)
          affectedFolderIds.add(textureResult.folderId);
        errors.push(...textureResult.errors);
        return;
      }

      const ingested = await ingestFile({
        buffer,
        fileName,
        folderSlug: targetFolder.slug,
        folderId: targetFolder.id,
        source: `${manifest.provider}-import`,
        sourceArchive,
        uploaderId: userId || null,
      });
      if (ingested.isErr()) throw ingested.error;

      importedFiles++;
      filesByKind[ingested.value.kind] =
        (filesByKind[ingested.value.kind] ?? 0) + 1;
      const textureResult = await extractBspTextures({
        buffer,
        fileName,
        parentFolderSlug: targetFolder.slug,
        parentFolderId: targetFolder.id,
        uploaderId: userId || null,
      });
      extractedTextures += textureResult.textureCount;
      if (textureResult.folderId) affectedFolderIds.add(textureResult.folderId);
      errors.push(...textureResult.errors);
    };

    for (const file of directFiles) {
      try {
        const buffer = await import("node:fs/promises").then(({ readFile }) =>
          readFile(file.path),
        );
        await ingestAsset(buffer, basename(file.name), file.name);
      } catch (error) {
        errors.push(
          `${file.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      completedWork++;
    }

    for (const archive of archives) {
      const inspectedArchive = archiveEntries.get(archive.path);
      for (const entry of inspectedArchive?.entries ?? []) {
        const importPath = stripArchiveRoot(
          entry.path,
          inspectedArchive?.redundantRoot ?? null,
        );
        try {
          if (isSafeRemoteAssetPath(importPath)) {
            const buffer = await extractSafeArchiveEntry(archive.path, entry);
            await ingestAsset(buffer, importPath, archive.name);
          } else {
            skippedFiles++;
          }
        } catch (error) {
          const message = `${archive.name}/${entry.path}: ${error instanceof Error ? error.message : String(error)}`;
          errors.push(message);
          log.error(error instanceof Error ? error : new Error(String(error)), {
            step: "remote-import-entry",
            archive: archive.name,
            file: entry.path,
          });
        }
        completedWork++;
        if (completedWork % 10 === 0 || completedWork === totalWork) {
          const progress =
            totalWork > 0
              ? 25 + Math.floor((completedWork / totalWork) * 68)
              : 93;
          await updateJobProgress(
            job.id,
            progress,
            `Imported ${importedFiles} assets and ${extractedTextures} textures...`,
          );
        }
      }
    }

    if (supportedFilesSeen === 0) {
      throw new Error("No supported assets were found in the downloaded files");
    }

    await updateJobProgress(job.id, 95, "Finalizing folders and previews...");
    await finalizeFolders(Array.from(affectedFolderIds), (error, folderId) =>
      log.error(error, { step: "generate-preview", folderId }),
    );

    const metadata = JSON.stringify({
      source: manifest.metadata,
      files: manifest.files,
      description: manifest.description,
    });
    await db
      .insert(remoteImports)
      .values({
        id: nanoid(),
        provider: manifest.provider,
        externalId: manifest.externalId,
        destinationKey: destination.key,
        sourceUrl: manifest.canonicalUrl,
        title: manifest.title,
        author: manifest.author,
        game: manifest.game,
        metadata,
        folderId: importFolder.id,
        jobId: job.id,
      })
      .onConflictDoUpdate({
        target: [
          remoteImports.provider,
          remoteImports.externalId,
          remoteImports.destinationKey,
        ],
        set: {
          sourceUrl: manifest.canonicalUrl,
          title: manifest.title,
          author: manifest.author,
          game: manifest.game,
          metadata,
          folderId: importFolder.id,
          jobId: job.id,
          updatedAt: new Date(),
        },
      });
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }

  log.emit();
  return {
    provider: manifest.provider,
    externalId: manifest.externalId,
    sourceUrl: manifest.canonicalUrl,
    folderId: importFolder.id,
    folderSlug: importFolder.slug,
    totalFiles: importedFiles + extractedTextures,
    extractedTextures,
    skippedFiles,
    filesByKind,
    errors: errors.slice(0, 100),
  } satisfies RemoteImportJobOutput;
}

registerJobHandler("remote-map-import", handleRemoteImport);

export { handleRemoteImport };
