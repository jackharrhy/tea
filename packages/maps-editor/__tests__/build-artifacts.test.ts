import { describe, expect, it } from "vitest";

import { parseLeakPath, parsePortalFile } from "../src/core/index.js";

describe("build artifact readers", () => {
  it("reads Quake and GoldSrc leak paths without accepting malformed points", () => {
    const result = parseLeakPath("0 0 0\n(16 8 4)\nnot a point\n32 8 4\n");

    expect(result.points).toEqual([
      [0, 0, 0],
      [16, 8, 4],
      [32, 8, 4],
    ]);
    expect(result.diagnostics).toEqual([
      "Line 3: expected three finite coordinates",
    ]);
  });

  it("reads portal polygons and reports malformed records", () => {
    const result = parsePortalFile(
      "PRT1\n2\n3\n4 0 1 (0 0 0) (16 0 0) (16 16 0) (0 16 0)\n3 bad\n",
    );

    expect(result.polygons).toHaveLength(1);
    expect(result.polygons[0]).toHaveLength(4);
    expect(result.diagnostics).toEqual(["Line 5: malformed portal polygon"]);
  });
});
