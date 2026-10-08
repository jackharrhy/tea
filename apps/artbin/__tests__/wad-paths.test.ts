import { describe, expect, test } from "vitest";

import {
  getWADLibraryHref,
  getWADTextureFilename,
  getWADTextureHref,
  splitWADTexturePath,
} from "#lib/wad-paths";

const texture = {
  index: 4,
  name: "{WOOD WALL",
  width: 64,
  height: 64,
  isTransparent: true,
};

describe("virtual WAD paths", () => {
  test("keeps the WAD under its real folder path", () => {
    expect(getWADLibraryHref("maps/example/library name.wad")).toBe(
      "/folder/maps/example/library%20name.wad",
    );
  });

  test("gives textures image-like file paths", () => {
    expect(
      getWADTextureHref("maps/example/library.wad", texture, [texture]),
    ).toBe("/file/maps/example/library.wad/%7BWOOD%20WALL.png");
    expect(
      splitWADTexturePath("maps/example/library.wad/{WOOD WALL.png"),
    ).toEqual({
      wadPath: "maps/example/library.wad",
      textureFilename: "{WOOD WALL.png",
    });
  });

  test("disambiguates duplicate texture names without changing unique names", () => {
    const duplicate = { ...texture, index: 9 };
    expect(getWADTextureFilename(texture, [texture, duplicate])).toBe(
      "{WOOD WALL~4.png",
    );
    expect(getWADTextureFilename(duplicate, [texture, duplicate])).toBe(
      "{WOOD WALL~9.png",
    );
  });
});
