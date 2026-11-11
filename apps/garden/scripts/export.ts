import path from "node:path";
import {
  exportSnapshot,
  diffManifest,
  type PublishManifest,
} from "../app/content/publish.ts";

const outputPath = path.resolve(
  process.argv[2] ||
    `tmp/published/${new Date().toISOString().replaceAll(":", "-")}`,
);
const manifest = await exportSnapshot({
  vaultPath: path.resolve(process.env.GARDEN_VAULT_PATH || "./vault/Garden"),
  assetsPath: path.resolve(
    process.env.GARDEN_VAULT_ASSETS_PATH || "./vault/Assets",
  ),
  outputPath,
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
