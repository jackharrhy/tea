import { describe, expect, test } from "bun:test";
import { parseValve220 } from "../src";

describe("Valve 220 parser diagnostics", () => {
  test("supports escaped quoted properties and inline TrenchBroom comments", () => {
    const map = parseValve220(
      `
      { // entity
        "classname" "worldspawn"
        "mapversion" "220"
        "message" "say \\"hello\\" // literally" // trailing comment
        {
          ( -1 -1 -1 ) ( -1 -1 1 ) ( -1 1 1 ) M [ 0 -1 0 0 ] [ 0 0 -1 0 ] 0 1 1
          ( 1 1 1 ) ( 1 -1 1 ) ( 1 -1 -1 ) M [ 0 -1 0 0 ] [ 0 0 -1 0 ] 0 1 1
          ( -1 -1 -1 ) ( 1 -1 -1 ) ( 1 -1 1 ) M [ 1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1
          ( 1 1 1 ) ( 1 1 -1 ) ( -1 1 -1 ) M [ 1 0 0 0 ] [ 0 0 -1 0 ] 0 1 1
          ( -1 -1 -1 ) ( -1 1 -1 ) ( 1 1 -1 ) M [ 1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1
          ( 1 1 1 ) ( -1 1 1 ) ( -1 -1 1 ) M [ 1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1
        }
      }
    `,
      "quoted.map",
    );
    expect(map.entities[0]?.properties.message).toBe(
      'say "hello" // literally',
    );
    expect(map.entities[0]?.column).toBe(7);
    expect(map.entities[0]?.brushes[0]?.faces[0]?.faceIndex).toBe(0);
  });

  test("reports file, line, column, entity, brush, and face", () => {
    expect(() =>
      parseValve220(
        `{
"classname" "worldspawn"
"mapversion" "220"
{
  nope
}
}`,
        "broken.map",
      ),
    ).toThrow(/broken\.map:5:3: face 0/);
  });
});
