import { describe, expect, it } from "vitest";

import {
  parseMapSource,
  planMapSave,
  serializeMap,
} from "../src/core/index.js";
import libreQuakeBatteryMap from "./fixtures/librequake-b_batt0.map?raw";

describe("open map compatibility fixtures", () => {
  it("round-trips the pinned LibreQuake Valve 220 brush model byte-for-byte", async () => {
    const parsed = parseMapSource(libreQuakeBatteryMap);

    expect(parsed.document.format).toBe("quake-map");
    expect(parsed.document.faceSyntax).toBe("valve-220");
    expect(parsed.document.entities).toHaveLength(7);
    expect(parsed.document.entities[1]?.properties.classname).toBe(
      "func_detail_wall",
    );
    expect(parsed.document.entities[1]?.primitives).toHaveLength(4);
    expect(
      parsed.document.entities[1]?.primitives.flatMap((primitive) =>
        primitive.kind === "brush" ? primitive.faces : [],
      ),
    ).toHaveLength(32);
    expect(planMapSave(parsed.document, parsed.source)).toEqual({
      status: "safe",
      text: libreQuakeBatteryMap,
      diagnostics: [],
    });
  });

  it("preserves Quake II face attributes through exact and normalized source lifecycles", () => {
    const source = [
      "// Synthetic Quake II compatibility fixture",
      "{",
      '"classname" "worldspawn"',
      "{",
      "( 0 0 0 ) ( 0 0 64 ) ( 0 64 0 ) e1u1/metal1_1 0 0 0 1 1 134217729 69 300",
      "( 64 0 0 ) ( 64 64 0 ) ( 64 0 64 ) e1u1/metal1_1 0 0 0 1 1 1 0 0",
      "( 0 0 0 ) ( 64 0 0 ) ( 0 0 64 ) e1u1/metal1_1 0 0 0 1 1 1 0 0",
      "( 0 64 0 ) ( 0 64 64 ) ( 64 64 0 ) e1u1/metal1_1 0 0 0 1 1 1 0 0",
      "( 0 0 0 ) ( 0 64 0 ) ( 64 0 0 ) e1u1/metal1_1 0 0 0 1 1 1 0 0",
      "( 0 0 64 ) ( 64 0 64 ) ( 0 64 64 ) e1u1/metal1_1 0 0 0 1 1 1 0 0",
      "}",
      "}",
      "",
    ].join("\n");
    const parsed = parseMapSource(source);
    const primitive = parsed.document.entities[0]?.primitives[0];

    expect(
      primitive?.kind === "brush" ? primitive.faces[0]?.surface : null,
    ).toEqual({
      contents: 134217729,
      flags: 69,
      value: 300,
    });
    expect(planMapSave(parsed.document, parsed.source)).toEqual({
      status: "safe",
      text: source,
      diagnostics: [],
    });
    const normalized = parseMapSource(serializeMap(parsed.document));
    const normalizedPrimitive = normalized.document.entities[0]?.primitives[0];
    expect(
      normalizedPrimitive?.kind === "brush"
        ? normalizedPrimitive.faces[0]?.surface
        : null,
    ).toEqual({ contents: 134217729, flags: 69, value: 300 });
  });
});
