import { expect, it, vi } from "vitest";
import type { HostedResourceMount } from "@tea/maps-protocol";
import {
  hostedWorldSource,
  loadHostedWorldSource,
} from "../hosted-world-source.ts";
import { syntheticGoldSrcSkyBsp } from "../synthetic.ts";

it("maps hosted project mounts to authenticated BSP companion sources", () => {
  const mounts = [
    ["wad", "halflife.wad"],
    ["palette", "pics/colormap.pcx"],
    ["png", "textures/wall/brick.png"],
    ["sprite", "sprites/glow.spr"],
    ["sound", "sound/ambience/hum.wav"],
    ["png", "textures/../unsafe.png"],
  ].map(([kind, displayName], ordinal) => ({
    id: `resource-${ordinal}`,
    ordinal,
    provider: "upload",
    providerAssetId: `asset-${ordinal}`,
    expectedSha256: "a".repeat(64),
    kind,
    displayName,
    size: 1,
    createdAt: 1,
  })) as HostedResourceMount[];
  const source = hostedWorldSource(
    "/api/maps/map-1/builds/build-1/artifacts/bsp",
    "project-1",
    mounts,
  );
  expect(source.wads).toEqual([
    "/api/projects/project-1/resources/resource-0/content",
  ]);
  expect(source.palette).toBe(
    "/api/projects/project-1/resources/resource-1/content",
  );
  expect(source.gameAssets).toEqual({
    "pics/colormap.pcx": "/api/projects/project-1/resources/resource-1/content",
    "textures/wall/brick.png":
      "/api/projects/project-1/resources/resource-2/content",
    "sprites/glow.spr": "/api/projects/project-1/resources/resource-3/content",
    "sound/ambience/hum.wav":
      "/api/projects/project-1/resources/resource-4/content",
  });
  expect(source.sprites).toEqual({
    "sprites/glow.spr": "/api/projects/project-1/resources/resource-3/content",
  });
  expect(source.sounds).toEqual({
    "ambience/hum.wav": "/api/projects/project-1/resources/resource-4/content",
  });
});

it("selects the mounted GoldSrc sky named by the BSP", async () => {
  const mounts = ["rt", "bk", "lf", "ft", "up", "dn"].map(
    (suffix, ordinal) => ({
      id: `sky-${suffix}`,
      ordinal,
      provider: "upload" as const,
      providerAssetId: `asset-${suffix}`,
      expectedSha256: "a".repeat(64),
      kind: "tga",
      displayName: `env/fixture${suffix}.tga`,
      size: 1,
      createdAt: 1,
    }),
  );
  mounts.push({
    ...mounts[0]!,
    id: "other-sky",
    displayName: "env/otherrt.tga",
  });
  const fetcher = vi.fn<typeof fetch>(async (_path, init) => {
    expect(init?.credentials).toBe("same-origin");
    return new Response(syntheticGoldSrcSkyBsp());
  });
  const source = await loadHostedWorldSource(
    "/api/maps/map-1/builds/build-1/artifacts/bsp",
    "project-1",
    mounts,
    fetcher,
  );
  expect(source.skybox).toEqual({
    rt: "/api/projects/project-1/resources/sky-rt/content",
    bk: "/api/projects/project-1/resources/sky-bk/content",
    lf: "/api/projects/project-1/resources/sky-lf/content",
    ft: "/api/projects/project-1/resources/sky-ft/content",
    up: "/api/projects/project-1/resources/sky-up/content",
    dn: "/api/projects/project-1/resources/sky-dn/content",
  });
  expect(source.bsp).toBeInstanceOf(ArrayBuffer);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
