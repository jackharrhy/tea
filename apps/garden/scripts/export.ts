import path from "node:path";
import { parse } from "@bomb.sh/args";
import { readApprovedPublic } from "../app/content/public-assets.ts";
import {
  exportSnapshot,
  diffManifest,
  type PublishManifest,
} from "../app/content/publish.ts";

const args = parse(process.argv.slice(2), { string: ["public-selection"] });
const outputPath = path.resolve(
  args._[0]?.toString() ||
    `tmp/published/${new Date().toISOString().replaceAll(":", "-")}`,
);
const manifest = await exportSnapshot({
  vaultPath: path.resolve(process.env.GARDEN_VAULT_PATH || "./vault/Garden"),
  assetsPath: path.resolve(
    process.env.GARDEN_VAULT_ASSETS_PATH || "./vault/Assets",
  ),
  outputPath,
  assetOrigin: process.env.GARDEN_ASSET_ORIGIN,
  origin: process.env.GARDEN_ORIGIN,
  approvedPublic: await readApprovedPublic(args["public-selection"]),
});
console.log(
  `Snapshot: ${outputPath}\nPublic pages: ${manifest.pages.length}\nReferenced assets: ${manifest.assets.length}`,
);
if (process.env.GARDEN_COMPARE_URL) {
  const response = await fetch(
    new URL("/deploy-manifest.json", process.env.GARDEN_COMPARE_URL),
  );
  if (!response.ok) throw new Error(`Production manifest: ${response.status}`);
  console.log(
    JSON.stringify(
      diffManifest((await response.json()) as PublishManifest, manifest),
      null,
      2,
    ),
  );
}
console.log("Export only. No content uploaded or deployment changed.");
