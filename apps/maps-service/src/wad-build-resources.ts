import { createHash } from "node:crypto";
import {
  developmentTexturePack,
  documentWithoutOmittedLayers,
  materialUsageInDocument,
  parseMap,
  serializeMapForCompile,
} from "@tea/maps-editor/core";
import type { HostedResourceMount } from "@tea/maps-protocol";
import type { BlobStore } from "./blob-store.js";
import { subsetWadTextures } from "./wad-subset.js";

const MAX_BUILD_TEXTURE_BYTES = 128 * 1024 * 1024;

/** Resolves pinned project bytes, never browser-provided files or remote mutable content. */
export async function prepareWadBuildResources(
  source: string,
  game: "quake" | "goldsrc",
  mounts: readonly HostedResourceMount[],
  blobs: Pick<BlobStore, "get">,
) {
  const document = parseMap(source);
  const usedNames = new Set(
    materialUsageInDocument(documentWithoutOmittedLayers(document)).map(
      ({ material }) => material.toLowerCase(),
    ),
  );
  const assets: { name: string; mediaType: string; bytes: Uint8Array }[] = [];
  let totalBytes = 0;
  let palette: Uint8Array | undefined;
  for (const mount of mounts) {
    if (
      mount.kind !== "palette" &&
      mount.kind !== "wad" &&
      !mount.displayName.toLowerCase().endsWith(".wad")
    )
      continue;
    const bytes = await blobs.get(mount.expectedSha256);
    if (!bytes)
      throw new Error(
        `Texture pack ${mount.displayName} is unavailable. Restore the pinned project resource before building.`,
      );
    if (
      createHash("sha256").update(bytes).digest("hex") !== mount.expectedSha256
    ) {
      throw new Error(
        `Texture pack ${mount.displayName} does not match its pinned content.`,
      );
    }
    if (mount.kind === "palette") {
      if (bytes.byteLength !== 768)
        throw new Error(`Palette ${mount.displayName} must contain 768 bytes.`);
      palette = bytes;
      continue;
    }
    const selected = subsetWadTextures(
      bytes,
      game === "quake" ? 2 : 3,
      usedNames,
    );
    if (!selected) continue;
    if (assets.length >= 15)
      throw new Error("Builds support at most 15 project texture packs.");
    totalBytes += selected.byteLength;
    if (totalBytes > MAX_BUILD_TEXTURE_BYTES)
      throw new Error("Selected build textures exceed the 128 MiB limit.");
    assets.push({
      name: `project_${assets.length + 1}.wad`,
      mediaType: "application/x-wad",
      bytes: selected,
    });
  }
  const development = developmentTexturePack(game, palette)!;
  assets.unshift({
    name: "tea_maps_dev.wad",
    mediaType: "application/x-wad",
    bytes: new Uint8Array(development.wad),
  });
  if (totalBytes + development.wad.byteLength > MAX_BUILD_TEXTURE_BYTES)
    throw new Error("Selected build textures exceed the 128 MiB limit.");
  const mapText = serializeMapForCompile(
    document,
    assets.map(({ name, bytes }) => ({ name, data: bytes })),
    game,
  );
  if (
    assets.reduce(
      (sum, asset) => sum + Math.ceil(asset.bytes.byteLength / 3) * 4,
      0,
    ) >
    172 * 1024 * 1024
  ) {
    throw new Error(
      "Encoded build texture packs exceed the compiler input limit.",
    );
  }
  return { mapText, assets };
}
