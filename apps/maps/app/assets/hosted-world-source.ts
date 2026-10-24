import type { HostedResourceMount } from "@tea/maps-protocol";
import type { WorldSource } from "@jackharrhy/tea-maps-renderer";
import {
  normalizeGameAssetPath,
  parseBsp,
} from "@jackharrhy/tea-maps-renderer/core";

const skyboxSuffixes = ["rt", "bk", "lf", "ft", "up", "dn"] as const;

function contentPath(projectId: string, mountId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/resources/${encodeURIComponent(mountId)}/content`;
}

export function hostedWorldSource(
  bsp: WorldSource["bsp"],
  projectId: string,
  mounts: readonly HostedResourceMount[],
): WorldSource {
  const gameAssets: Record<string, string> = {};
  const sprites: Record<string, string> = {};
  const sounds: Record<string, string> = {};
  const wads: string[] = [];
  let palette: string | undefined;
  for (const mount of mounts) {
    const url = contentPath(projectId, mount.id);
    const name = mount.displayName.toLowerCase();
    if (mount.kind === "wad" || name.endsWith(".wad")) wads.push(url);
    if (
      mount.kind === "palette" ||
      name === "gfx/palette.lmp" ||
      name === "pics/colormap.pcx"
    )
      palette = url;
    if (
      !/^(textures|env|gfx|pics|sprites|sound)\//.test(name) ||
      name.includes(":") ||
      Array.from(name).some((character) => character.charCodeAt(0) < 32)
    )
      continue;
    try {
      const path = normalizeGameAssetPath(name);
      gameAssets[path] = url;
      if (path.startsWith("sprites/")) sprites[path] = url;
      if (path.startsWith("sound/")) sounds[path.slice("sound/".length)] = url;
    } catch {
      // A mounted display name may not be a game-relative path.
    }
  }
  return {
    bsp,
    ...(wads.length ? { wads } : {}),
    ...(palette ? { palette } : {}),
    ...(Object.keys(gameAssets).length ? { gameAssets } : {}),
    ...(Object.keys(sprites).length ? { sprites } : {}),
    ...(Object.keys(sounds).length ? { sounds } : {}),
  };
}

export async function loadHostedWorldSource(
  bspUrl: string,
  projectId: string,
  mounts: readonly HostedResourceMount[],
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<WorldSource> {
  const skyFaces = mounts.filter(({ displayName }) =>
    /^(?:(?:gfx\/)?env\/)?[^/]+(?:rt|bk|lf|ft|up|dn)\.tga$/i.test(displayName),
  );
  if (!skyFaces.length) return hostedWorldSource(bspUrl, projectId, mounts);
  const response = await fetcher(bspUrl, {
    credentials: "same-origin",
    signal,
  });
  if (!response.ok)
    throw new Error(`Hosted BSP download failed (${response.status})`);
  const bsp = await response.arrayBuffer();
  const source = hostedWorldSource(bsp, projectId, mounts);
  let skyName: string | null = null;
  try {
    const world = parseBsp(bsp);
    if (world.format === "goldsrc-bsp30") skyName = world.skyName;
  } catch {
    return source;
  }
  if (!skyName) return source;
  const name = skyName
    .replace(/\.[^/.]+$/u, "")
    .replace(/_$/u, "")
    .toLowerCase();
  const skybox = Object.fromEntries(
    skyboxSuffixes.flatMap((suffix) => {
      const file = `${name}${suffix}.tga`;
      const mount = skyFaces
        .toReversed()
        .find(({ displayName }) =>
          [`gfx/env/${file}`, `env/${file}`, file].includes(
            displayName.toLowerCase(),
          ),
        );
      return mount ? [[suffix, contentPath(projectId, mount.id)]] : [];
    }),
  );
  const { rt, bk, lf, ft, up, dn } = skybox;
  if (!rt || !bk || !lf || !ft || !up || !dn) return source;
  return { ...source, skybox: { rt, bk, lf, ft, up, dn } };
}
