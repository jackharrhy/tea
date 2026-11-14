import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  selectPublicAssets,
  type PublicAssetOptions,
} from "./public-assets.ts";

interface ManifestItem {
  route?: string;
  sourcePath: string;
  hash: string;
  bytes: number;
}
export interface PublishManifest {
  generatedAt: string;
  pages: ManifestItem[];
  assets: ManifestItem[];
}
function pageHash(value: string | Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function exportSnapshot(
  options: PublicAssetOptions & { outputPath: string },
) {
  const { snapshot, assets: selected } = await selectPublicAssets(options);
  const assets = selected.map(({ sourcePath, hash, bytes }) => ({
    sourcePath,
    hash,
    bytes,
  }));
  const manifest: PublishManifest = {
    generatedAt: new Date().toISOString(),
    pages: snapshot.entries
      .map((entry) => ({
        route: `/${entry.id}`,
        sourcePath: entry.sourcePath,
        hash: pageHash(entry.source),
        bytes: Buffer.byteLength(entry.source),
      }))
      .toSorted((a, b) => a.route.localeCompare(b.route)),
    assets,
  };
  // Never overwrite a snapshot in place: callers activate an immutable directory after validation.
  await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
  await fs.mkdir(options.outputPath);
  for (const entry of snapshot.entries) {
    const target = path.join(options.outputPath, entry.sourcePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, entry.source);
  }
  await fs.writeFile(
    path.join(options.outputPath, "deploy-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}

export function diffManifest(previous: PublishManifest, next: PublishManifest) {
  const before = new Map(previous.pages.map((item) => [item.sourcePath, item]));
  const after = new Map(next.pages.map((item) => [item.sourcePath, item]));
  return {
    added: next.pages
      .filter((item) => !before.has(item.sourcePath))
      .map((item) => item.route),
    changed: next.pages
      .filter(
        (item) =>
          before.has(item.sourcePath) &&
          before.get(item.sourcePath)!.hash !== item.hash,
      )
      .map((item) => item.route),
    removed: previous.pages
      .filter((item) => !after.has(item.sourcePath))
      .map((item) => item.route),
  };
}
