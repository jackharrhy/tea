#!/usr/bin/env node
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parse } from "@bomb.sh/args";
import {
  selectPublicAssets,
  readApprovedPublic,
} from "../app/content/public-assets.ts";
import { withPublicAssetStage } from "./lib/public-asset-stage.ts";
import { recoverMissingAssets } from "./lib/asset-recovery.ts";
import { loadEnv, ROOT_DIR } from "./lib/cli.ts";

function rclone(args: string[]) {
  return execFileSync("rclone", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export async function assetsCommand(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  execute = rclone,
) {
  const args = parse(argv, {
    boolean: ["dry-run", "yes", "help"],
    string: ["public-selection"],
  });
  const command = args._[0]?.toString();
  if (command === "sync-to-r2")
    throw new Error(
      "Destructive asset sync is disabled. Use copy-to-r2; existing public objects are never deleted.",
    );
  if (
    ![
      "diff",
      "check",
      "missing-remote",
      "copy-to-r2",
      "missing-local",
      "pull-missing",
    ].includes(command || "") ||
    args.help
  )
    throw new Error(
      "Usage: assets.ts <diff|check|missing-remote|copy-to-r2|missing-local|pull-missing> [--dry-run] [--public-selection approved.json]. missing-local/pull-missing are maintenance-only R2-to-local recovery; all publication commands use public selection.",
    );
  const remote = env.GARDEN_RCLONE_REMOTE || "jacks-garden:jacks-garden";
  if (
    !/^[^:\s]+:[^\s/].*$/.test(remote) ||
    remote
      .split(":")
      .slice(1)
      .join(":")
      .split("/")
      .some((part) => part === "..")
  )
    throw new Error(
      "Set GARDEN_RCLONE_REMOTE to a bucket/subpath, not a remote root",
    );
  if (command === "missing-local" || command === "pull-missing")
    return recoverMissingAssets(
      {
        assetsPath: path.resolve(
          ROOT_DIR,
          env.GARDEN_VAULT_ASSETS_PATH || "./vault/Assets",
        ),
        remote,
        copy: command === "pull-missing",
        dryRun: args["dry-run"],
      },
      execute,
    );
  const approvedPublic = await readApprovedPublic(args["public-selection"]);
  const { assets } = await selectPublicAssets({
    vaultPath: path.resolve(
      ROOT_DIR,
      env.GARDEN_VAULT_PATH || "./vault/Garden",
    ),
    assetsPath: path.resolve(
      ROOT_DIR,
      env.GARDEN_VAULT_ASSETS_PATH || "./vault/Assets",
    ),
    assetOrigin: env.GARDEN_ASSET_ORIGIN,
    origin: env.GARDEN_ORIGIN,
    approvedPublic,
  });
  if (!assets.length) return { selected: 0, missing: [] };
  return withPublicAssetStage(assets, async (directory) => {
    if (command === "copy-to-r2") {
      execute([
        "copy",
        directory,
        remote,
        "--checksum",
        ...(args["dry-run"] ? ["--dry-run"] : []),
      ]);
      return { selected: assets.length, missing: [] };
    }
    const remoteFiles = new Set(
      execute(["lsf", remote, "--files-only", "--recursive"]).split("\n"),
    );
    const missing = assets
      .map((asset) => asset.sourcePath)
      .filter((name) => !remoteFiles.has(name));
    if (command === "check") execute(["check", directory, remote, "--one-way"]);
    return { selected: assets.length, missing };
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  loadEnv();
  try {
    const result = await assetsCommand(process.argv.slice(2));
    const recovery = ["missing-local", "pull-missing"].includes(
      process.argv[2],
    );
    console.log(
      recovery
        ? `Remote recovery inventory: ${result.selected}\nMissing locally: ${result.missing.length}`
        : `Selected public assets: ${result.selected}\nMissing remotely: ${result.missing.length}`,
    );
    if (["missing-remote", "missing-local"].includes(process.argv[2]))
      console.log(result.missing.join("\n"));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
