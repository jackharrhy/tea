import { createReadStream } from "node:fs";
import { readFile } from "fs/promises";
import { posix } from "node:path";
import pLimit from "p-limit";
import { createHash } from "crypto";
import type { ScanResult, ScannedArchive } from "./scanner.ts";
import type { ApiClient } from "./api.ts";
import {
  parseArchive,
  extractPk3Entry,
  extractPakEntry,
  getFileEntries,
} from "@artbin/core/parsers/archives";
import {
  cleanFolderSlug,
  cleanFolderPath,
  sanitizeFilename,
} from "@artbin/core/detection/filenames";
import { isImportableFile } from "@artbin/core/scanning/filters";
import { MAX_UPLOAD_BYTES } from "@artbin/core/uploads";

interface PreparedFile {
  relativePath: string;
  size: number;
  sha256: string;
  loadBuffer: () => Promise<Buffer>;
  sourceArchive?: string;
}

const { basename, dirname } = posix;

export interface ImportOptions {
  scanResult: ScanResult;
  archivePaths?: string[];
  api?: ApiClient;
  rootSlug: string;
  dryRun?: boolean;
  includeLooseFiles?: boolean;
  onProgress?: (info: { phase: string; current: number; total: number; message: string }) => void;
}

export interface ImportResult {
  uploaded: number;
  failed: number;
  skipped: number;
  total: number;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

// Normalize once: folder creation, manifest checks, and uploads use the same path.
function canonicalPath(path: string): string {
  const parts = path.replaceAll("\\", "/").split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes(":")))
    throw new Error(`Invalid import path: ${path}`);
  const filename = sanitizeFilename(parts.pop()!);
  const directories = parts.map(cleanFolderSlug);
  if (!filename || directories.some((part) => !part))
    throw new Error(`Invalid import path: ${path}`);
  return [...directories, filename].join("/");
}

function checkSize(path: string, size: number): void {
  if (size > MAX_UPLOAD_BYTES) throw new Error(`${path} exceeds the 512 MiB per-file upload limit`);
}

function prepareFile(path: string, buffer: Buffer, sourceArchive?: string): PreparedFile {
  const relativePath = canonicalPath(path);
  checkSize(relativePath, buffer.length);
  return {
    relativePath,
    size: buffer.length,
    sha256: sha256(buffer),
    loadBuffer: async () => buffer,
    sourceArchive,
  };
}

async function prepareLooseFile(path: string, diskPath: string): Promise<PreparedFile> {
  const relativePath = canonicalPath(path);
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(diskPath)) {
    size += chunk.length;
    checkSize(relativePath, size);
    hash.update(chunk);
  }
  return {
    relativePath,
    size,
    sha256: hash.digest("hex"),
    loadBuffer: () => readFile(diskPath),
  };
}

async function extractArchiveFiles(archive: ScannedArchive): Promise<PreparedFile[]> {
  const files: PreparedFile[] = [];
  const buffer = await readFile(archive.path);

  // Use the archive's relative path within the scan tree to preserve directory structure.
  // e.g. archive at "AVIAOZIN3/id1/maps/myhouse.bsp" gets the dir "AVIAOZIN3/id1/maps"
  const archiveDir = dirname(archive.relativePath.replaceAll("\\", "/"));
  const archiveBase = basename(archive.name, "." + archive.type);
  const archiveSlug = cleanFolderSlug(archiveBase);

  // For archives with entries, put extracted files under archiveDir/archiveSlug/
  // For BSPs (single files), put the BSP directly under its directory
  const archivePrefix = archiveDir !== "." ? `${archiveDir}/${archiveSlug}` : archiveSlug;

  if (archive.type === "bsp") {
    // BSPs are single files -- put them in the directory they came from
    const bspRelPath = archiveDir !== "." ? `${archiveDir}/${archive.name}` : archive.name;
    return [prepareFile(bspRelPath, buffer)];
  }

  const parsed = parseArchive(buffer);
  const entries = getFileEntries(parsed.entries);

  for (const entry of entries) {
    if (!isImportableFile(entry.name)) continue;

    let entryBuffer: Buffer;
    if (parsed.type === "pk3") {
      entryBuffer = await extractPk3Entry(buffer, entry);
    } else if (parsed.type === "pak") {
      entryBuffer = extractPakEntry(buffer, entry);
    } else {
      throw new Error(`Unsupported archive format: ${archive.name}`);
    }

    files.push(prepareFile(`${archivePrefix}/${entry.name}`, entryBuffer, archive.name));
  }

  return files;
}

export async function runImport(options: ImportOptions): Promise<ImportResult> {
  const { scanResult, archivePaths, dryRun, onProgress } = options;
  if (
    options.rootSlug
      .replaceAll("\\", "/")
      .split("/")
      .some((part) => !part || part === "." || part === ".." || part.includes(":"))
  )
    throw new Error("Destination must be a relative folder path");
  const rootSlug = cleanFolderPath(options.rootSlug.replaceAll("\\", "/"));
  if (!rootSlug) throw new Error("Destination folder is required");

  const progress = (phase: string, current: number, total: number, message: string) => {
    onProgress?.({ phase, current, total, message });
  };

  // Filter archives if a subset was specified
  const archives = archivePaths
    ? scanResult.archives.filter((a) => archivePaths.includes(a.path))
    : scanResult.archives;
  const looseFiles = options.includeLooseFiles === false ? [] : scanResult.looseFiles;
  const sourceCount = archives.length + looseFiles.length;

  // Extract files from archives
  const allFiles: PreparedFile[] = [];
  for (let i = 0; i < archives.length; i++) {
    const archive = archives[i];
    progress("extracting", i, sourceCount, `Extracting ${archive.name}...`);
    const extracted = await extractArchiveFiles(archive);
    allFiles.push(...extracted);
  }

  // Extract loose files
  for (let i = 0; i < looseFiles.length; i++) {
    const loose = looseFiles[i];
    progress("extracting", archives.length + i, sourceCount, `Reading ${loose.name}...`);
    checkSize(loose.relativePath, loose.size);
    allFiles.push(await prepareLooseFile(loose.relativePath, loose.path));
  }
  progress("extracting", sourceCount, sourceCount, `Prepared ${allFiles.length} files`);

  const seenPaths = new Set<string>();
  for (const file of allFiles) {
    if (seenPaths.has(file.relativePath))
      throw new Error(
        `Multiple source files map to ${file.relativePath}; rename one before importing`,
      );
    seenPaths.add(file.relativePath);
  }

  const total = allFiles.length;

  if (total === 0) {
    return { uploaded: 0, failed: 0, skipped: 0, total: 0 };
  }

  if (dryRun) {
    return { uploaded: 0, failed: 0, skipped: total, total };
  }

  const { api } = options;
  if (!api) throw new Error("An Artbin connection is required to upload files");

  // Collect unique folder slugs
  const folderSlugs = new Set<string>();
  const rootParts = rootSlug.split("/");
  for (let depth = 1; depth <= rootParts.length; depth++)
    folderSlugs.add(rootParts.slice(0, depth).join("/"));
  for (const file of allFiles) {
    const dir = dirname(file.relativePath);
    if (dir && dir !== ".") {
      const parts = dir.split("/");
      for (let i = 1; i <= parts.length; i++) {
        folderSlugs.add(`${rootSlug}/${parts.slice(0, i).join("/")}`);
      }
    }
  }

  // Create folders
  progress("folders", 0, 1, `Creating ${folderSlugs.size} folders...`);
  const sortedSlugs = Array.from(folderSlugs).toSorted(
    (a, b) => a.split("/").length - b.split("/").length,
  );

  const folderInputs = sortedSlugs.map((slug) => {
    const parts = slug.split("/");
    const name = parts[parts.length - 1];
    const parentSlug = parts.length > 1 ? parts.slice(0, -1).join("/") : null;
    return {
      slug,
      name,
      parentSlug,
    };
  });

  await api.createFolders(folderInputs);
  progress("folders", 1, 1, "Folders ready");

  // Check manifest for deduplication
  progress("manifest", 0, 1, "Checking which files are new...");
  const manifestFiles = allFiles.map((f) => ({
    path: f.relativePath,
    sha256: f.sha256,
    size: f.size,
  }));

  const manifestResult = await api.checkManifest(rootSlug, manifestFiles);
  const newFilePaths = manifestResult.newFiles;
  progress(
    "manifest",
    1,
    1,
    `${newFilePaths.length} new files (${manifestResult.existingFiles.length} already exist)`,
  );

  const skipped = manifestResult.existingFiles.length;

  const newFileSet = new Set(newFilePaths);
  const filesToUpload = allFiles.filter((f) => newFileSet.has(f.relativePath));

  let uploaded = 0;
  let failed = 0;
  let transferredBytes = 0;
  const totalBytes = filesToUpload.reduce((sum, file) => sum + file.size, 0);
  const uploadProgress = (message: string) =>
    progress(
      "uploading",
      transferredBytes,
      totalBytes,
      `${uploaded}/${filesToUpload.length} files processed, ${failed} failed. ${message}`,
    );
  // One file at a time per slot; tus splits even large files into bounded requests.
  const limit = pLimit(2);
  const errors: string[] = [];
  await Promise.all(
    filesToUpload.map((file) =>
      limit(async () => {
        let fileTransferred = 0;
        const recordTransfer = (bytes: number) => {
          const next = Math.max(fileTransferred, Math.min(file.size, bytes));
          transferredBytes += next - fileTransferred;
          fileTransferred = next;
        };
        uploadProgress(`Uploading ${file.relativePath}…`);
        try {
          const buffer = await file.loadBuffer();
          if (buffer.length !== file.size || sha256(buffer) !== file.sha256)
            throw new Error("File changed while importing; rerun the command");
          await api.uploadFile(
            rootSlug,
            {
              path: file.relativePath,
              sha256: file.sha256,
              sourceArchive: file.sourceArchive,
              buffer,
            },
            (info) => {
              if (info.phase === "transfer") recordTransfer(info.current);
              uploadProgress(`${file.relativePath}: ${info.message}`);
            },
          );
          recordTransfer(file.size);
          uploaded++;
        } catch (error) {
          failed++;
          errors.push(
            `${file.relativePath}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        uploadProgress("Transfer progress; waiting for remaining files to finish processing.");
      }),
    ),
  );

  progress("finalizing", 0, 100, "Files are indexed. Waiting for folder preview job…");
  try {
    await api.finalize(rootSlug, (info) =>
      progress("finalizing", info.current, info.total, info.message),
    );
  } catch (error) {
    throw new Error(
      `${uploaded} files uploaded, ${skipped} already present, ${failed} failed. Folder finalization failed: ${error instanceof Error ? error.message : String(error)}. Rerun this import to retry finalization; indexed files will be skipped.`,
      { cause: error },
    );
  }
  if (errors.length)
    throw new Error(`${failed} upload(s) failed:\n${errors.slice(0, 10).join("\n")}`);

  progress("done", uploaded, filesToUpload.length, "Upload complete");

  return { uploaded, failed, skipped, total };
}
