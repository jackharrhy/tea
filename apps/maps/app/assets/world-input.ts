import type { WorldSource } from "@tea/maps-renderer";
import { parseBsp, readWalTextureHeader } from "@tea/maps-renderer/core";

export function sourceName(source: WorldSource): string {
  if (typeof source.bsp === "string")
    return source.bsp.split("/").at(-1) || "Remote map";
  if (source.bsp instanceof URL)
    return source.bsp.pathname.split("/").at(-1) || "Remote map";
  if (source.bsp instanceof File) return source.bsp.name;
  return "Buffer map";
}

function containedGamePath(file: File): string | null {
  const relativePath = (file.webkitRelativePath ?? "")
    .replaceAll("\\", "/")
    .toLowerCase();
  const parts = relativePath.split("/");
  const root = parts.findIndex(
    (part) =>
      part === "gfx" ||
      part === "textures" ||
      part === "env" ||
      part === "pics" ||
      part === "sprites" ||
      part === "sound",
  );
  return root >= 0 ? parts.slice(root).join("/") : null;
}

export function localMaps(files: Iterable<File>): File[] {
  return [...files]
    .filter((file) => file.name.toLowerCase().endsWith(".bsp"))
    .toSorted((left, right) =>
      localMapPath(left).localeCompare(localMapPath(right)),
    );
}

export function localMapPath(file: File): string {
  return file.webkitRelativePath || file.name;
}

export async function sourceFromFiles(
  files: Iterable<File>,
  selectedBsp?: File,
): Promise<WorldSource | undefined> {
  const list = [...files];
  const bsp = selectedBsp ?? localMaps(list)[0];
  if (!bsp) return undefined;
  const palette =
    list.find((file) => containedGamePath(file) === "gfx/palette.lmp") ??
    list.find((file) => {
      const lowerName = file.name.toLowerCase();
      return (
        lowerName === "palette.lmp" ||
        lowerName.endsWith(".pal") ||
        lowerName === "colormap.pcx"
      );
    });
  const wads = list.filter((file) => file.name.toLowerCase().endsWith(".wad"));
  const folderWads = bsp.webkitRelativePath
    ? new Map(
        wads
          .toSorted(
            (left, right) =>
              right.webkitRelativePath.split("/").length -
              left.webkitRelativePath.split("/").length,
          )
          .map((file) => [file.name.toLowerCase(), file]),
      )
    : null;
  const sprites: Record<string, File> = {};
  const sounds: Record<string, File> = {};
  const gameAssets: Record<string, File> = {};
  for (const file of list) {
    const lowerName = file.name.toLowerCase();
    const path = containedGamePath(file);
    if (lowerName.endsWith(".spr")) sprites[path ?? lowerName] = file;
    if (/\.(wav|mp3|ogg)$/u.test(lowerName)) {
      sounds[path?.replace(/^sound\//u, "") ?? lowerName] = file;
    }
  }
  const gameAssetEntries = await Promise.all(
    list.map(async (file) => {
      const lowerName = file.name.toLowerCase();
      const contained = containedGamePath(file);
      if (contained) return [contained, file] as const;
      if (lowerName.endsWith(".wal")) {
        try {
          const header = readWalTextureHeader(await file.arrayBuffer());
          return [`textures/${header.name.toLowerCase()}.wal`, file] as const;
        } catch {
          return [`textures/${lowerName}`, file] as const;
        }
      }
      return lowerName === "colormap.pcx"
        ? (["pics/colormap.pcx", file] as const)
        : null;
    }),
  );
  for (const entry of gameAssetEntries) {
    if (entry) gameAssets[entry[0]] = entry[1];
  }

  const skyboxSuffixes = ["rt", "bk", "lf", "ft", "up", "dn"] as const;
  type SkyboxSuffix = (typeof skyboxSuffixes)[number];
  type PartialSkybox = Partial<Record<SkyboxSuffix, File>>;
  const skyboxGroups = new Map<string, PartialSkybox>();
  for (const file of list) {
    const path = containedGamePath(file);
    if (path && !path.startsWith("gfx/env/")) continue;
    const match = /^(.*?)(rt|bk|lf|ft|up|dn)\.tga$/iu.exec(file.name);
    const name = match?.[1]?.toLowerCase();
    const suffix = match?.[2]?.toLowerCase() as SkyboxSuffix | undefined;
    if (!name || !suffix) continue;
    const group = skyboxGroups.get(name) ?? {};
    group[suffix] = file;
    skyboxGroups.set(name, group);
  }
  const isCompleteSkybox = (
    group: PartialSkybox,
  ): group is Record<SkyboxSuffix, File> =>
    skyboxSuffixes.every((suffix) => group[suffix] !== undefined);
  let skybox: Record<SkyboxSuffix, File> | undefined;
  if (skyboxGroups.size > 0) {
    try {
      const world = parseBsp(await bsp.arrayBuffer());
      if (world.format === "goldsrc-bsp30" && world.skyName) {
        const name = world.skyName
          .replace(/\.[^/.]+$/u, "")
          .replace(/_$/u, "")
          .toLowerCase();
        const group = skyboxGroups.get(name);
        if (group && isCompleteSkybox(group)) skybox = group;
      }
    } catch {
      // The viewer reports invalid BSP data when it loads the selected map.
    }
  }
  return {
    bsp,
    ...(palette ? { palette } : {}),
    ...(folderWads
      ? {
          resolveWad: (reference: { basename: string }) =>
            folderWads.get(reference.basename.toLowerCase()),
        }
      : wads.length > 0
        ? { wads }
        : {}),
    ...(Object.keys(sprites).length > 0 ? { sprites } : {}),
    ...(Object.keys(sounds).length > 0 ? { sounds } : {}),
    ...(Object.keys(gameAssets).length > 0 ? { gameAssets } : {}),
    ...(skybox ? { skybox } : {}),
  };
}
