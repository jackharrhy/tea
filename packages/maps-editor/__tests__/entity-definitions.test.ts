import { describe, expect, it } from "vitest";

import {
  EntityDefinitionCatalog,
  parseEntityDefinitionFile,
  pointEntityDefinition,
} from "../src/core/index.js";

describe("entity definition catalogs", () => {
  it("parses FGD inheritance, bounds, colors, sprite metadata, choices, and flags", () => {
    const parsed = parseEntityDefinitionFile(
      "fgd",
      `
@include "common.fgd"
@BaseClass = TargetBase [
  targetname(target_source) : "Name"
]
@PointClass base(TargetBase) size(-8 -8 -8, 8 8 8) color(255 128 0) iconsprite("sprites/light.spr") = light_test : "Test light" [
  brightness(integer) : "Brightness" : 300
  style(choices) : "Style" : 0 = [
    0 : "Normal"
    1 : "Flicker"
  ]
  spawnflags(flags) = [
    1 : "Initially dark" : 1
  ]
]
`,
      "entities/test.fgd",
    );
    const catalog = new EntityDefinitionCatalog([parsed]);
    const light = catalog.find("LIGHT_TEST");

    expect(parsed.includes).toEqual(["common.fgd"]);
    expect(light).toMatchObject({
      kind: "point",
      label: "Test light",
      bounds: { min: [-8, -8, -8], max: [8, 8, 8] },
      color: [255, 128, 0],
      sprite: "sprites/light.spr",
    });
    expect(light?.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "targetname", type: "targetname" }),
        expect.objectContaining({
          key: "brightness",
          type: "integer",
          defaultValue: "300",
        }),
        expect.objectContaining({ key: "style", type: "choices" }),
        expect.objectContaining({ key: "spawnflags", type: "flags" }),
      ]),
    );
  });

  it("ignores comments while locating FGD class blocks", () => {
    const parsed = parseEntityDefinitionFile(
      "fgd",
      `
// @PointClass = ignored_comment [
@PointClass color(0 255 0) = info_notnull : "Wildcard" // inline note
[
  targetname(target_source) : "Name"
]
/* @SolidClass = ignored_block [ ] */
`,
      "entities/commented.fgd",
    );

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.definitions).toMatchObject([
      { classname: "info_notnull", kind: "point", color: [0, 255, 0] },
    ]);
  });

  it("parses Quake QUAKED point and brush declarations", () => {
    const parsed = parseEntityDefinitionFile(
      "def",
      `/*QUAKED info_target (0 .5 1) (-8 -8 -8) (8 8 8) AMBUSH x START_OFF
Target marker.
*/
/*QUAKED func_detail (0.5 0.5 0.5) ?
Detail brush.
*/`,
    );

    expect(parsed.definitions).toMatchObject([
      {
        classname: "info_target",
        kind: "point",
        bounds: { min: [-8, -8, -8], max: [8, 8, 8] },
      },
      { classname: "func_detail", kind: "brush" },
    ]);
    expect(parsed.definitions[0]?.properties[0]).toMatchObject({
      key: "spawnflags",
      type: "flags",
    });
  });

  it("parses Radiant ENT classes and typed properties", () => {
    const parsed = parseEntityDefinitionFile(
      "ent",
      `<classes>
<point name="info_target" color="0 1 0" box="-4 -4 -4 4 4 4">
  A target.
  <angle key="angle" name="Yaw">Heading.</angle>
  <real key="scale" name="Scale" value="1">Size.</real>
</point>
<group name="func_group" color="0.5 0.5 0.5">Brush group.</group>
</classes>`,
    );

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.definitions[0]).toMatchObject({
      classname: "info_target",
      color: [0, 255, 0],
      properties: [
        { key: "angle", type: "angle" },
        { key: "scale", type: "float", defaultValue: "1" },
      ],
    });
    expect(parsed.definitions[1]).toMatchObject({
      classname: "func_group",
      kind: "brush",
    });
  });

  it.each([
    ["fgd" as const, "\n\n@PointClass = broken [", 3],
    ["def" as const, "\n/*QUAKED broken (1 0 0) incomplete", 2],
    ["ent" as const, '\n<point color="1 0 0"></point>', 2],
  ])(
    "reports malformed %s declarations with source locations",
    (format, source, line) => {
      const parsed = parseEntityDefinitionFile(
        format,
        source,
        `entities/broken.${format}`,
      );

      expect(parsed.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: "error",
            sourcePath: `entities/broken.${format}`,
            line,
          }),
        ]),
      );
    },
  );

  it("keeps unknown classes usable through the raw point-entity fallback", () => {
    const catalog = new EntityDefinitionCatalog();

    expect(catalog.find("monster_custom")).toBeUndefined();
    expect(pointEntityDefinition("monster_custom", catalog)).toEqual({
      classname: "monster_custom",
      label: "monster_custom",
      bounds: { min: [-16, -16, -16], max: [16, 16, 16] },
    });
  });
});
