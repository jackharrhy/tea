import { createHash } from "node:crypto";
import {
  documentWithoutOmittedLayers,
  materialUsageInDocument,
  parseMap,
  serializeMap,
} from "@tea/maps-editor/core";
import type { HostedResourceMount } from "@tea/maps-protocol";
import type { BlobStore } from "./blob-store.js";
import type { HostedBuildProfile } from "./hosted-game-profiles.js";

const MAX_BUILD_ASSET_BYTES = 128 * 1024 * 1024;
const SKY_FACES = ["rt", "lf", "ft", "bk", "up", "dn"] as const;

export async function prepareGameTreeBuildResources(
  source: string,
  mounts: readonly HostedResourceMount[],
  blobs: Pick<BlobStore, "get">,
  profile: Extract<HostedBuildProfile, { resourceLayout: "game-tree" }>,
) {
  const document = documentWithoutOmittedLayers(parseMap(source));
  if (document.faceSyntax !== profile.faceSyntax) {
    throw new Error(
      `This game profile requires ${profile.faceSyntax} map faces`,
    );
  }
  const files = new Map<string, HostedResourceMount>();
  for (const mount of mounts) files.set(mount.displayName.toLowerCase(), mount);
  const names = new Set<string>();
  for (const { material } of materialUsageInDocument(document)) {
    const stem = material.toLowerCase().replace(/^textures\//, "");
    if (!/^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/.test(stem)) {
      throw new Error(`Unsafe game material name: ${material}`);
    }
    const base = `textures/${stem}`;
    const image = profile.imageExtensions
      .map((extension) => `${base}.${extension}`)
      .find((path) => files.has(path));
    if (!image) throw new Error(`Build is missing an image for ${base}`);
    names.add(image);
    names.add(`${base}.${profile.materialMetadataExtension}`);
  }
  const worldspawn = document.entities.find(
    (entity) => entity.properties.classname === "worldspawn",
  );
  const sky = worldspawn?.properties[profile.skyProperty];
  if (!sky || !/^[a-zA-Z0-9_-]{1,63}$/.test(sky)) {
    throw new Error("Worldspawn needs a safe skybox basename");
  }
  for (const face of SKY_FACES) {
    names.add(`env/${sky}${face}.${profile.skyExtension}`.toLowerCase());
  }

  let totalBytes = 0;
  const assets: { name: string; mediaType: string; bytes: Uint8Array }[] = [];
  for (const name of names) {
    const mount = files.get(name);
    if (!mount) throw new Error(`Build is missing ${name}`);
    const bytes = await blobs.get(mount.expectedSha256);
    if (
      !bytes ||
      createHash("sha256").update(bytes).digest("hex") !== mount.expectedSha256
    ) {
      throw new Error(`Pinned asset ${name} is unavailable or changed`);
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_BUILD_ASSET_BYTES) {
      throw new Error("Build assets exceed the 128 MiB limit");
    }
    assets.push({
      name,
      mediaType: name.endsWith(".png")
        ? "image/png"
        : name.endsWith(".tga")
          ? "image/tga"
          : "application/json",
      bytes,
    });
  }
  return { mapText: serializeMap(document), assets };
}
