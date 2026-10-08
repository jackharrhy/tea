import * as p from "@clack/prompts";
import { resolve } from "path";
import { scanDirectory } from "../lib/scanner.ts";
import { loadConfig } from "../lib/config.ts";
import { ApiClient } from "../lib/api.ts";
import { startBrowseServer } from "../lib/browse-server.ts";
import { formatProgress } from "../lib/progress.ts";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export async function scan(args: Record<string, unknown>) {
  const targetPath = (args._ as string[])?.[1];

  if (!targetPath) {
    p.log.error("Usage: artbin scan <path>");
    process.exit(1);
  }

  const fullPath = resolve(targetPath);
  p.intro(`Scanning ${fullPath}`);

  const spinner = p.spinner();
  spinner.start("Scanning for game assets...");

  const result = await scanDirectory(fullPath, undefined, (msg) => {
    spinner.message(msg);
  });

  spinner.stop(
    `Found ${result.archives.length} archives and ${result.looseFiles.length} loose files`,
  );

  const byGameDir = new Map<string, typeof result.archives>();
  for (const archive of result.archives) {
    const key = archive.gameDir || "(ungrouped)";
    if (!byGameDir.has(key)) byGameDir.set(key, []);
    byGameDir.get(key)!.push(archive);
  }

  for (const [gameDir, archives] of byGameDir) {
    const totalSize = archives.reduce((sum, a) => sum + a.size, 0);
    const totalFiles = archives.reduce(
      (sum, a) => sum + (a.entries.length || 1),
      0,
    );
    p.log.info(
      `\n${gameDir} (${archives.length} archives, ${totalFiles} files, ${formatSize(totalSize)})`,
    );

    for (const archive of archives) {
      const fileCount = archive.entries.length || 1;
      p.log.message(
        `  ${archive.name} (${fileCount} files, ${formatSize(archive.size)})`,
      );
    }
  }

  if (result.looseFiles.length > 0) {
    const looseSize = result.looseFiles.reduce((sum, f) => sum + f.size, 0);
    p.log.info(
      `\nLoose files: ${result.looseFiles.length} files (${formatSize(looseSize)})`,
    );
  }

  p.outro(
    `Total: ${result.totalFileCount} files (${formatSize(result.totalSize)})`,
  );

  if (result.archives.length === 0 && result.looseFiles.length === 0) {
    return;
  }

  // Prompt to open browse UI (skip prompt if --browse flag is set)
  let shouldBrowse = !!args.browse;
  if (!shouldBrowse) {
    const answer = await p.confirm({
      message: "Open browser to browse and import?",
      initialValue: true,
    });
    if (p.isCancel(answer)) return;
    shouldBrowse = answer;
  }

  if (!shouldBrowse) return;

  // Load config and authenticate
  const config = await loadConfig();
  if (!config) {
    p.log.error("Not logged in. Run: artbin login");
    process.exit(1);
  }

  const api = new ApiClient(config);

  const authSpinner = p.spinner();
  authSpinner.start("Verifying authentication...");
  let user: { name: string; isAdmin: boolean };
  try {
    const whoami = await api.whoami();
    user = whoami.user;
    authSpinner.stop(`Authenticated as ${user.name}`);
  } catch {
    authSpinner.stop("Authentication failed");
    p.log.error("Session expired. Run: artbin login");
    process.exit(1);
  }

  // Start the browse server
  const importSpinner = p.spinner();
  let importing = false;
  const { port, close } = await startBrowseServer({
    scanResult: result,
    api,
    html: BROWSE_UI_HTML,
    serverUrl: config.serverUrl,
    user,
    onProgress(progress) {
      if (progress.status === "running") {
        if (!importing) {
          importSpinner.start("Starting import…");
          importing = true;
        }
        importSpinner.message(formatProgress(progress));
      } else if (importing) {
        importSpinner.stop(
          progress.status === "done" ? progress.message : "Import failed",
        );
        importing = false;
        if (progress.error) p.log.error(progress.error);
      }
    },
  });

  const url = `http://localhost:${port}/`;
  p.log.info(`Browse server running at ${url}`);

  // Open browser
  try {
    const { default: open } = await import("open");
    await open(url);
  } catch {
    p.log.warning(`Could not open browser. Visit ${url} manually.`);
  }

  p.log.info("Press Ctrl+C to stop the server");

  // Block until Ctrl+C
  await new Promise<void>((fulfill) => {
    process.on("SIGINT", () => {
      close();
      fulfill();
    });
  });

  p.outro("Browse server stopped");
}
