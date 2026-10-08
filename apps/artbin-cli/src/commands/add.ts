import * as p from "@clack/prompts";
import { resolve, basename, relative, join } from "path";
import { readdir, stat } from "fs/promises";
import { loadConfig } from "../lib/config.ts";
import { ApiClient } from "../lib/api.ts";
import { runImport } from "../lib/importer.ts";
import { cleanFolderSlug } from "@artbin/core/detection/filenames";
import type { ScanResult, ScannedFile } from "../lib/scanner.ts";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Skip dotfiles/dirs and node_modules only. */
function shouldSkip(name: string): boolean {
  return name.startsWith(".") || name === "node_modules";
}

/**
 * Walk a directory and collect every file, preserving relative paths.
 * No extension filtering, no size gates, no game-asset heuristics.
 */
async function collectFiles(
  rootPath: string,
  dirPath: string,
  onProgress?: (msg: string) => void,
): Promise<ScannedFile[]> {
  const files: ScannedFile[] = [];
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (shouldSkip(entry.name)) continue;

    const fullPath = join(dirPath, entry.name);

    if (entry.isDirectory()) {
      const children = await collectFiles(rootPath, fullPath, onProgress);
      files.push(...children);
    } else if (entry.isFile()) {
      const stats = await stat(fullPath);
      const relPath = relative(rootPath, fullPath);
      onProgress?.(`Found ${relPath}`);
      files.push({
        path: fullPath,
        relativePath: relPath,
        name: entry.name,
        size: stats.size,
        gameDir: null,
      });
    }
  }

  return files;
}

export async function add(args: Record<string, unknown>) {
  const targetPath = (args._ as string[])?.[1];
  const folderSlug = (args.folder as string) || null;
  const dryRun = !!args["dry-run"];

  if (!targetPath) {
    p.log.error("Usage: artbin add <path> [--folder <slug>] [--dry-run]");
    process.exit(1);
  }

  const fullPath = resolve(targetPath);
  p.intro(`Adding ${fullPath}`);

  if (dryRun) {
    p.log.info("Dry run mode -- no files will be uploaded");
  }

  const config = await loadConfig();
  if (!config) {
    p.log.error("Not logged in. Run: artbin login");
    process.exit(1);
  }

  const api = new ApiClient(config);

  const spinner = p.spinner();
  spinner.start("Verifying authentication...");
  try {
    await api.whoami();
    spinner.stop("Authenticated");
  } catch {
    spinner.stop("Authentication failed");
    p.log.error("Session expired. Run: artbin login");
    process.exit(1);
  }

  spinner.start("Collecting files...");
  const looseFiles = await collectFiles(fullPath, fullPath, (msg) => {
    spinner.message(msg);
  });
  spinner.stop(`Found ${looseFiles.length} files`);

  if (looseFiles.length === 0) {
    p.log.warning("No files found in directory");
    p.outro("Nothing to add");
    return;
  }

  const totalSize = looseFiles.reduce((sum, f) => sum + f.size, 0);
  p.log.info(`Total size: ${formatSize(totalSize)}`);

  const rootSlug = folderSlug || cleanFolderSlug(basename(fullPath));

  // Build a ScanResult with no archives -- runImport handles the rest
  const scanResult: ScanResult = {
    archives: [],
    looseFiles,
    totalFileCount: looseFiles.length,
    totalSize,
  };

  spinner.start("Uploading...");

  try {
    const result = await runImport({
      scanResult,
      api,
      rootSlug,
      dryRun,
      onProgress({ phase, message }) {
        if (phase === "done") {
          spinner.stop(message);
        } else {
          spinner.message(message);
        }
      },
    });

    if (dryRun) {
      p.log.info(`Would upload ${result.total} files to folder: ${rootSlug}`);
      p.outro("Dry run complete");
      return;
    }

    if (result.total === 0) {
      p.log.warning("No files to upload");
      p.outro("Nothing to add");
      return;
    }

    if (result.uploaded === 0 && result.skipped > 0) {
      p.outro("All files already uploaded");
      return;
    }

    p.outro(
      `Uploaded ${result.uploaded} files${result.skipped > 0 ? ` (${result.skipped} already existed)` : ""}${result.failed > 0 ? ` (${result.failed} failed)` : ""}`,
    );
  } catch (err) {
    spinner.stop("Upload failed");
    p.log.error(String(err));
    process.exit(1);
  }
}
