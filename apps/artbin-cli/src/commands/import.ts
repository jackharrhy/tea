import * as p from "@clack/prompts";
import { resolve, basename } from "path";
import { scanDirectory } from "../lib/scanner.ts";
import { loadConfig } from "../lib/config.ts";
import { ApiClient } from "../lib/api.ts";
import { runImport } from "../lib/importer.ts";
import { cleanFolderSlug } from "@artbin/core/detection/filenames";
import { formatProgress } from "../lib/progress.ts";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function importCmd(args: Record<string, unknown>) {
  const targetPath = (args._ as string[])?.[1];
  const folderSlug = (args.folder as string) || null;
  const dryRun = !!args["dry-run"];

  if (!targetPath) {
    p.log.error("Usage: artbin import <path> [--folder <slug>] [--dry-run]");
    process.exit(1);
  }

  const fullPath = resolve(targetPath);
  p.intro(`Importing from ${fullPath}`);

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

  spinner.start("Scanning for game assets...");
  const scanResult = await scanDirectory(fullPath, undefined, (msg) => {
    spinner.message(msg);
  });
  spinner.stop(
    `Found ${scanResult.archives.length} archives and ${scanResult.looseFiles.length} loose files`,
  );

  if (scanResult.archives.length === 0 && scanResult.looseFiles.length === 0) {
    p.log.warning("No importable files found");
    p.outro("Nothing to import");
    return;
  }

  const rootSlug = folderSlug || cleanFolderSlug(basename(fullPath));

  spinner.start("Processing...");

  try {
    const result = await runImport({
      scanResult,
      api,
      rootSlug,
      dryRun,
      onProgress(progress) {
        if (progress.phase === "done") {
          spinner.stop(progress.message);
        } else {
          spinner.message(formatProgress(progress));
        }
      },
    });

    if (dryRun) {
      const totalSize = scanResult.archives.reduce((sum, a) => sum + a.size, 0);
      p.log.info(`Would upload ${result.total} files to folder: ${rootSlug}`);
      p.log.info(`Total size: ${formatSize(totalSize)}`);
      p.outro("Dry run complete");
      return;
    }

    if (result.total === 0) {
      p.log.warning("No importable files after extraction");
      p.outro("Nothing to import");
      return;
    }

    if (result.uploaded === 0 && result.skipped > 0) {
      p.outro("All files already uploaded");
      return;
    }

    p.outro(
      `Uploaded ${result.uploaded} files${result.failed > 0 ? ` (${result.failed} failed)` : ""}`,
    );
  } catch (err) {
    spinner.stop("Import failed");
    p.log.error(String(err));
    process.exit(1);
  }
}
