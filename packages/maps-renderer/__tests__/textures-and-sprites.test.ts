import { describe, expect, it } from "vitest";

import {
  buildLightmapPage,
  classifyMaterial,
  decodeMipTexture,
  decodeQuakeSky,
  decodeTga,
  findMipTexture,
  LightmapPacker,
  parseGoldSrcSprite,
  parseWad,
} from "../src/core/index.js";

import { goldSrcBrushPipeline } from "../src/render/renderer.js";

import {
  makeMipTexture,
  makePalette,
  makeSprite,
  makeTga,
  makeWad,
} from "./fixtures.js";

describe("WAD and MIPTEX", () => {
  it.each([2, 3] as const)("parses WAD%s and finds its texture", (version) => {
    const wad = parseWad(makeWad(version));
    expect(wad.version).toBe(version);
    expect(findMipTexture(wad, "FIXTURE")).toBeDefined();
  });

  it("uses palette index 255 as transparency for decal textures", () => {
    const bytes = makeMipTexture(30, "{fence");
    bytes[40] = 255;
    const decoded = decodeMipTexture(bytes);
    expect(decoded.levels[0]?.rgba.slice(0, 4)).toEqual(
      new Uint8Array([0, 0, 0, 0]),
    );
  });

  it("decodes BSP29 textures with an external palette", () => {
    const decoded = decodeMipTexture(makeMipTexture(29), makePalette());
    expect(decoded.levels).toHaveLength(4);
    expect(decoded.levels[0]?.rgba.slice(0, 4)).toEqual(
      new Uint8Array([0, 255, 0, 255]),
    );
  });

  it("preserves authored Quake fullbrights at every mip without changing WAD3 colors or transparency", () => {
    const palette = makePalette();
    for (const name of ["fixture", "{fence"]) {
      for (const version of [29, 30] as const) {
        const bytes = makeMipTexture(version, name);
        const view = new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        );
        for (let mip = 0; mip < 4; mip += 1) {
          const offset = view.getUint32(24 + mip * 4, true);
          bytes.set([223, 224, 246, 255], offset);
        }
        const decoded = decodeMipTexture(
          bytes,
          version === 29 ? palette : undefined,
        );
        for (const level of decoded.levels) {
          for (const [pixel, index] of [223, 224, 246, 255].entries()) {
            const transparent = name.startsWith("{") && index === 255;
            const color = transparent
              ? [0, 0, 0, 0]
              : [...palette.slice(index * 3, index * 3 + 3), 255];
            expect(level.rgba.subarray(pixel * 4, pixel * 4 + 4)).toEqual(
              new Uint8Array(color),
            );
            if (version === 29) {
              expect(
                level.fullbrightRgba!.subarray(pixel * 4, pixel * 4 + 4),
              ).toEqual(new Uint8Array(index >= 224 ? color : [0, 0, 0, 0]));
            } else expect(level.fullbrightRgba).toBeUndefined();
          }
        }
      }
    }
  });

  it("rejects decoded textures wider than the portable WebGPU limit", () => {
    const texture = makeMipTexture(29);
    const view = new DataView(
      texture.buffer,
      texture.byteOffset,
      texture.byteLength,
    );
    view.setUint32(16, 8_193, true);
    view.setUint32(20, 1, true);

    expect(() => decodeMipTexture(texture, makePalette())).toThrow(
      /portable WebGPU texture/u,
    );
  });

  it("splits Quake sky textures into opaque and transparent scrolling layers", () => {
    const texture = makeMipTexture(29, "sky_test");
    texture[40] = 0;
    texture[48] = 12;
    const decoded = decodeQuakeSky(texture, makePalette());
    expect(decoded.width).toBe(8);
    expect(decoded.solid.slice(0, 4)).toEqual(
      new Uint8Array([12, 243, 84, 255]),
    );
    expect(decoded.alpha.slice(0, 4)).toEqual(new Uint8Array([12, 243, 84, 0]));
  });
});

describe("TGA", () => {
  it("decodes top-origin BGR true-color pixels to RGBA", () => {
    expect(decodeTga(makeTga()).rgba).toEqual(
      new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]),
    );
  });

  it("decodes run-length encoded true-color pixels", () => {
    expect(decodeTga(makeTga(true)).rgba).toEqual(
      new Uint8Array([10, 20, 30, 255, 10, 20, 30, 255]),
    );
  });

  it("rejects images that exceed the portable WebGPU dimensions before allocating them", () => {
    const oversized = makeTga();
    const view = new DataView(
      oversized.buffer,
      oversized.byteOffset,
      oversized.byteLength,
    );
    view.setUint16(12, 65_535, true);
    view.setUint16(14, 65_535, true);
    expect(() => decodeTga(oversized)).toThrow(/portable WebGPU texture/u);
  });
});

describe("GoldSrc sprites", () => {
  it("decodes alpha-test index 255 as transparent", () => {
    const sprite = parseGoldSrcSprite(makeSprite({ textureFormat: 3 }));
    expect(sprite).toMatchObject({
      version: 2,
      orientation: 2,
      textureFormat: 3,
      maxWidth: 2,
      maxHeight: 2,
    });
    expect(sprite.frames[0]?.frames[0]?.rgba.slice(8, 12)).toEqual(
      new Uint8Array([0, 0, 0, 0]),
    );
  });

  it("uses the final palette color and the pixel index for index-alpha sprites", () => {
    const sprite = parseGoldSrcSprite(
      makeSprite({ textureFormat: 2, pixels: [128, 0, 255, 32] }),
    );
    expect(sprite.frames[0]?.frames[0]?.rgba.slice(0, 4)).toEqual(
      new Uint8Array([255, 0, 249, 128]),
    );
  });

  it("retains cumulative frame-group intervals", () => {
    const sprite = parseGoldSrcSprite(
      makeSprite({ frameType: 1, groupFrames: 2 }),
    );
    expect(sprite.frames[0]?.kind).toBe("group");
    expect(sprite.frames[0]?.intervals[0]).toBeCloseTo(0.1);
    expect(sprite.frames[0]?.intervals[1]).toBeCloseTo(0.2);
    expect(sprite.frames[0]?.frames).toHaveLength(2);
  });

  it("rejects nonstandard angled frame groups", () => {
    expect(() => parseGoldSrcSprite(makeSprite({ frameType: 2 }))).toThrow(
      /unknown type 2/,
    );
  });

  it("rejects truncated frame pixels with a stable invalid-data error", () => {
    const bytes = makeSprite().slice(0, -1);
    expect(() => parseGoldSrcSprite(bytes)).toThrow(
      /pixels exceeds its source buffer/,
    );
  });
});

describe("lightmaps and materials", () => {
  it("allocates deterministic additional lightmap pages", () => {
    const packer = new LightmapPacker(4, 4);
    const first = { width: 4, height: 4, pageIndex: -1, pageX: 0, pageY: 0 };
    const second = { width: 4, height: 4, pageIndex: -1, pageX: 0, pageY: 0 };
    packer.allocate(first);
    packer.allocate(second);
    expect([first.pageIndex, second.pageIndex]).toEqual([0, 1]);
  });

  it("combines multiple colored lightstyles", () => {
    const intensities = new Float32Array(64);
    intensities[0] = 0.5;
    intensities[1] = 1;
    const output = buildLightmapPage(
      {
        index: 0,
        width: 1,
        height: 1,
        lightmaps: [
          {
            faceIndex: 0,
            width: 1,
            height: 1,
            styles: [0, 1],
            samples: new Uint8Array([100, 40, 20, 30, 60, 90]),
            pageIndex: 0,
            pageX: 0,
            pageY: 0,
          },
        ],
      },
      3,
      intensities,
    );
    expect(output).toEqual(new Uint8Array([80, 80, 100, 255]));
  });

  it("classifies the v0.1 material pipeline families", () => {
    expect([
      classifyMaterial("brick", "goldsrc-bsp30"),
      classifyMaterial("{fence", "goldsrc-bsp30"),
      classifyMaterial("!water", "goldsrc-bsp30"),
      classifyMaterial("sky_day", "goldsrc-bsp30"),
      classifyMaterial("clip", "quake-bsp29"),
    ]).toEqual(["opaque", "alpha-test", "water", "sky", "tool"]);
  });

  it("keeps glow brush models on the translucent surface path", () => {
    expect(goldSrcBrushPipeline(3, "alpha-test")).toBe(
      "translucentTextureBrush",
    );
  });
});
