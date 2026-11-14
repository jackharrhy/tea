#!/usr/bin/env node
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parse } from "@bomb.sh/args";
import { recoverMissingAssets } from "./lib/asset-recovery.ts";
import { loadEnv, ROOT_DIR } from "./lib/cli.ts";

function rclone(args: string[]) {
  return execFileSync("rclone", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export async function recoverAssetsCommand(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  execute = rclone,
) {
  const args = parse(argv, { boolean: ["dry-run", "help"] });
  const command = args._[0]?.toString();
  if (!["missing-local", "pull-missing"].includes(command || "") || args.help)
    throw new Error(
      "Usage: assets.ts <missing-local|pull-missing> [--dry-run]. Maintenance-only R2-to-local recovery; never uploads or deletes remote objects.",
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
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  loadEnv();
  try {
    const result = await recoverAssetsCommand(process.argv.slice(2));
    console.log(
      `Remote recovery inventory: ${result.remoteFiles}\nMissing locally: ${result.missing.length}`,
    );
    if (process.argv[2] === "missing-local")
      console.log(result.missing.join("\n"));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
