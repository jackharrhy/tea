import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fromHtml } from "hast-util-from-html";
import { visit } from "unist-util-visit";
import { createContentStore } from "./store.ts";
import { createMarkdownRenderer } from "./markdown.ts";
import { resolveOgImage } from "./utils.ts";

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
function hash(value: string | Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function exportSnapshot(options: {
  vaultPath: string;
  assetsPath: string;
  outputPath: string;
}) {
  const snapshot = createContentStore(options.vaultPath).read();
  if (!snapshot.byId.has("home"))
    throw new Error("A public Home.md is required");
  const render = createMarkdownRenderer(snapshot.index);
  const references = new Set<string>();
  function collect(value: string) {
    if (value.startsWith("/asset/"))
      references.add(decodeURIComponent(value.slice("/asset/".length)));
  }
  for (const entry of snapshot.entries) {
    if (
      /^linkblog\/\d{4}\/\d{2}\/\d{2}$/.test(entry.id) &&
      (!entry.data.description?.trim() || !entry.data["og-image"]?.trim())
    )
      throw new Error(
        `${entry.sourcePath}: public linkblog entries require description and og-image`,
      );
    const image = resolveOgImage(entry.data["og-image"]);
    if (image) collect(image);
    for (const segment of await render(entry.body)) {
      if (segment.type === "prose")
        visit(fromHtml(segment.html, { fragment: true }), "element", (node) => {
          for (const key of ["src", "href", "poster"]) {
            const value = node.properties[key];
            if (typeof value === "string") collect(value);
          }
        });
      else {
        for (const value of Object.values(segment.props)) collect(value);
      }
    }
  }
  const assetRoot = await fs.realpath(options.assetsPath);
  const assets: ManifestItem[] = [];
  for (const reference of [...references].toSorted()) {
    const file = await fs.realpath(path.resolve(assetRoot, reference));
    if (!file.startsWith(assetRoot + path.sep))
      throw new Error(`Asset escapes the configured directory: ${reference}`);
    const bytes = await fs.readFile(file);
    assets.push({
      sourcePath: reference,
      hash: hash(bytes),
      bytes: bytes.length,
    });
  }
  const manifest: PublishManifest = {
    generatedAt: new Date().toISOString(),
    pages: snapshot.entries
      .map((entry) => ({
        route: `/${entry.id}`,
        sourcePath: entry.sourcePath,
        hash: hash(entry.source),
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
