import { describe, expect, it } from "vitest";
import { syntheticGoldSrcSkyBsp } from "../synthetic.ts";
import { localMaps, sourceFromFiles } from "../world-input.ts";

function localFile(path: string, contents: BlobPart = ""): File {
  const file = new File([contents], path.split("/").at(-1)!);
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

describe("local game folders", () => {
  it("offers each BSP and keeps game-relative asset paths for the selected map", async () => {
    const first = localFile("valve/maps/a.bsp");
    const second = localFile("valve/maps/b.bsp");
    const sprite = localFile("valve/sprites/effects/glow.spr");
    const sound = localFile("valve/sound/ambience/wind.wav");
    const texture = localFile("valve/textures/e1u1/wall.jpg");
    const palette = localFile("valve/gfx/palette.lmp");
    const files = [second, sound, texture, first, sprite, palette];

    expect(localMaps(files)).toEqual([first, second]);
    expect(await sourceFromFiles(files, second)).toMatchObject({
      bsp: second,
      palette,
      sprites: { "sprites/effects/glow.spr": sprite },
      sounds: { "ambience/wind.wav": sound },
      gameAssets: {
        "gfx/palette.lmp": palette,
        "textures/e1u1/wall.jpg": texture,
      },
    });
  });

  it("uses only the selected GoldSrc map's skybox and ignores unrelated LMP files", async () => {
    const bsp = localFile("valve/maps/room.bsp", syntheticGoldSrcSkyBsp());
    const suffixes = ["rt", "bk", "lf", "ft", "up", "dn"] as const;
    const fixture = Object.fromEntries(
      suffixes.map((suffix) => [
        suffix,
        localFile(`valve/gfx/env/fixture${suffix}.tga`),
      ]),
    );
    const other = suffixes.map((suffix) =>
      localFile(`valve/gfx/env/other${suffix}.tga`),
    );
    const menu = localFile("valve/gfx/menu.lmp");

    const source = await sourceFromFiles(
      [bsp, menu, ...other, ...Object.values(fixture)],
      bsp,
    );
    expect(source?.skybox).toEqual(fixture);
    expect(source?.palette).toBeUndefined();
  });

  it("resolves referenced folder WADs without loading every WAD, while flat uploads remain explicit", async () => {
    const bsp = localFile("valve/maps/room.bsp");
    const rootWad = localFile("valve/sample.wad");
    const nestedWad = localFile("valve/addons/sample.wad");
    const unusedWad = localFile("valve/unused.wad");

    const folderSource = await sourceFromFiles(
      [bsp, nestedWad, unusedWad, rootWad],
      bsp,
    );
    expect(folderSource?.wads).toBeUndefined();
    expect(
      await folderSource?.resolveWad?.({
        basename: "sample.wad",
        declaredPath: "C:/game/sample.wad",
      }),
    ).toBe(rootWad);

    const flatBsp = new File([], "room.bsp");
    const flatWad = new File([], "sample.wad");
    const flatSource = await sourceFromFiles([flatBsp, flatWad]);
    expect(flatSource?.wads).toEqual([flatWad]);
  });
});
