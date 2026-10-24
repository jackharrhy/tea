import { describe, expect, it } from "vitest";

import { readPcxPalette, MapsError } from "../src/core/index.js";

function pcxPalette(): Uint8Array {
  const result = new Uint8Array(128 + 1 + 768);
  result[0] = 0x0a;
  result[2] = 1;
  result[3] = 8;
  result[65] = 1;
  result[128] = 0x0c;
  for (let index = 0; index < 768; index += 1)
    result[129 + index] = index & 0xff;
  return result;
}

describe("PCX palettes", () => {
  it("reads the trailing Quake II palette without decoding image pixels", () => {
    expect(readPcxPalette(pcxPalette())).toEqual(
      Uint8Array.from({ length: 768 }, (_, index) => index & 0xff),
    );
  });

  it("rejects truncated files and missing palette markers", () => {
    expect(() => readPcxPalette(new Uint8Array(128))).toThrow(MapsError);
    const missingMarker = pcxPalette();
    missingMarker[128] = 0;
    expect(() => readPcxPalette(missingMarker)).toThrow(
      /trailing 256-color palette/,
    );
    const multiplePlanes = pcxPalette();
    multiplePlanes[65] = 3;
    expect(() => readPcxPalette(multiplePlanes)).toThrow(/one color plane/u);
  });
});
