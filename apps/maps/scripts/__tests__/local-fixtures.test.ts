import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  discoverLocalFixtures,
  resolveLocalFixture,
} from "../local-fixtures.ts";

const roots: string[] = [];

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "tea-maps-fixtures-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("local development fixtures", () => {
  it("prefers Tea sidecars when both names are present", async () => {
    const root = await fixtureRoot();
    const maps = path.join(root, "game", "maps");
    await mkdir(maps, { recursive: true });
    await writeFile(path.join(maps, "room.bsp"), "bsp");
    await writeFile(
      path.join(maps, "room.worldview.json"),
      JSON.stringify({ label: "Worldview room" }),
    );
    await writeFile(
      path.join(maps, "room.tea-maps.json"),
      JSON.stringify({ label: "Tea room" }),
    );
    await writeFile(path.join(maps, "room.worldview-walkability.json"), "{}");
    await writeFile(path.join(maps, "room.tea-maps-walkability.json"), "{}");

    expect(await discoverLocalFixtures(root)).toMatchObject([
      {
        label: "Tea room",
        walkability: "/local/game/maps/room.tea-maps-walkability.json",
      },
    ]);
  });

  it("lists BSPs with sidecar aliases, cameras, and graph URLs", async () => {
    const root = await fixtureRoot();
    const maps = path.join(root, "my game", "maps");
    await mkdir(maps, { recursive: true });
    await writeFile(path.join(maps, "room.bsp"), "bsp");
    await writeFile(
      path.join(maps, "room.worldview.json"),
      JSON.stringify({
        label: "Starting room",
        aliases: ["start"],
        camera: { position: [1, 2, 3], yawDegrees: 90 },
      }),
    );
    await writeFile(path.join(maps, "room.worldview-walkability.json"), "{}");

    expect(await discoverLocalFixtures(root)).toEqual([
      {
        id: "my game",
        label: "Starting room",
        aliases: ["start"],
        source: {
          bsp: "/local/my%20game/maps/room.bsp",
          gameBaseUrl: "/local/my%20game/",
        },
        camera: {
          position: [1, 2, 3],
          yawDegrees: 90,
          pitchDegrees: 0,
          fieldOfView: 75,
        },
        walkability: "/local/my%20game/maps/room.worldview-walkability.json",
      },
    ]);
    expect(
      await resolveLocalFixture(root, "/local/my%20game/maps/room.bsp"),
    ).toMatchObject({ filename: path.join(maps, "room.bsp"), size: 3 });
  });

  it("keeps URL traversal and symlinks outside the fixture root inaccessible", async () => {
    const root = await fixtureRoot();
    const outside = await fixtureRoot();
    const game = path.join(root, "game");
    await mkdir(game);
    await writeFile(path.join(outside, "secret.bsp"), "secret");
    await symlink(
      path.join(outside, "secret.bsp"),
      path.join(game, "linked.bsp"),
    );

    expect(await discoverLocalFixtures(root)).toEqual([]);
    expect(await resolveLocalFixture(root, "/local/../secret.bsp")).toBeNull();
    expect(
      await resolveLocalFixture(root, "/local/game/linked.bsp"),
    ).toBeNull();
  });

  it("selects Steam corpus maps from the manifest and uses their extracted game assets", async () => {
    const root = await fixtureRoot();
    const corpus = path.join(root, "steam-corpus");
    const map = path.join(
      corpus,
      "214700",
      "archives",
      "baseq2",
      "pak0.pk3",
      "maps",
      "bar1.bsp",
    );
    const asset = path.join(
      corpus,
      "214700",
      "game",
      "textures",
      "e1u1",
      "wall.jpg",
    );
    await mkdir(path.dirname(map), { recursive: true });
    await mkdir(path.dirname(asset), { recursive: true });
    await writeFile(map, "bsp");
    await writeFile(asset, "image");
    await writeFile(
      path.join(corpus, "manifest.json"),
      JSON.stringify({
        records: [
          {
            appId: "214700",
            outputPath: "214700/archives/baseq2/pak0.pk3/maps/bar1.bsp",
          },
        ],
        assets: [
          {
            appId: "214700",
            logicalPath: "textures/e1u1/wall.jpg",
            outputPath: "214700/game/textures/e1u1/wall.jpg",
          },
        ],
      }),
    );
    const install = path.join(root, "steam-installs", "214700", "maps");
    await mkdir(install, { recursive: true });
    await writeFile(path.join(install, "other.bsp"), "raw install");

    expect(await discoverLocalFixtures(root)).toEqual([
      {
        id: "steam-corpus/thirty-flights-of-loving/bar1",
        label: "bar1.bsp",
        namespace: "Thirty Flights of Loving",
        aliases: [],
        source: {
          bsp: "/local/steam-corpus/214700/archives/baseq2/pak0.pk3/maps/bar1.bsp",
          gameBaseUrl: "/local/steam-corpus/214700/game/",
          gameAssets: {
            "textures/e1u1/wall.jpg":
              "/local/steam-corpus/214700/game/textures/e1u1/wall.jpg",
          },
        },
      },
    ]);
  });
});
