import { describe, expect, it } from "vitest";
import {
  cameraFromUrlParameters,
  cameraUrlValue,
  sourceFromUrlParameters,
} from "../remote-input.ts";

describe("remote map links", () => {
  it("accepts Tea asset override links", () => {
    const source = sourceFromUrlParameters(
      new URLSearchParams({
        bsp: "maps/sample.bsp",
        gameBase: "/games/valve/",
        palette: "gfx/palette.lmp",
        wadBase: "/wads/",
        skyboxBase: "/env/",
        spriteBase: "/sprites/",
        soundBase: "/sound/",
      }),
    );
    expect(source).toEqual({
      bsp: "maps/sample.bsp",
      gameBaseUrl: "/games/valve/",
      palette: "gfx/palette.lmp",
      wadBaseUrl: "/wads/",
      skyboxBaseUrl: "/env/",
      spriteBaseUrl: "/sprites/",
      soundBaseUrl: "/sound/",
    });
  });

  it("requires a BSP path", () => {
    expect(
      sourceFromUrlParameters(new URLSearchParams({ bsp: " " })),
    ).toBeUndefined();
  });

  it("reads camera links and writes a camera that can be reopened", () => {
    const camera = cameraFromUrlParameters(
      new URLSearchParams({ camera: "1,2.5,-3,90,-45" }),
    );
    expect(camera).toEqual({
      position: [1, 2.5, -3],
      yaw: Math.PI / 2,
      pitch: -Math.PI / 4,
      fieldOfView: 75,
    });
    expect(cameraUrlValue(camera!)).toBe("1.000,2.500,-3.000,90.00,-45.00");
    expect(
      cameraFromUrlParameters(
        new URLSearchParams({ camera: cameraUrlValue(camera!) }),
      ),
    ).toEqual(camera);
  });

  it.each(["", "1,2,3,4", "1,,3,4,5", "1,2,NaN,4,5"])(
    "ignores an invalid camera parameter (%s)",
    (value) => {
      expect(
        cameraFromUrlParameters(new URLSearchParams({ camera: value })),
      ).toBeUndefined();
    },
  );
});
