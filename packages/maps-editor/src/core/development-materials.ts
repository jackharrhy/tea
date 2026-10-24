import type { EditorMaterial } from "./materials.js";

type Rgb = readonly [number, number, number];
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  "4": ["101", "101", "101", "111", "001", "001", "001"],
  "6": ["011", "100", "100", "111", "101", "101", "111"],
};

function pixel(
  rgba: Uint8Array,
  size: number,
  x: number,
  y: number,
  color: Rgb,
): void {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  rgba.set([...color, 255], (y * size + x) * 4);
}

function rect(
  rgba: Uint8Array,
  size: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: Rgb,
): void {
  for (let row = y; row < y + h; row += 1)
    for (let column = x; column < x + w; column += 1)
      pixel(rgba, size, column, row, color);
}

function text(
  rgba: Uint8Array,
  size: number,
  value: string,
  centerX: number,
  y: number,
  scale: number,
  color: Rgb,
): void {
  const widths = [...value].map(
    (character) => GLYPHS[character]?.[0]?.length ?? 3,
  );
  const total =
    widths.reduce((sum, width) => sum + width * scale, 0) +
    (value.length - 1) * scale;
  let x = Math.round(centerX - total / 2);
  for (const [characterIndex, character] of [...value].entries()) {
    const glyph = GLYPHS[character];
    if (glyph)
      for (const [row, bits] of glyph.entries())
        for (const [column, bit] of [...bits].entries()) {
          if (bit === "1")
            rect(
              rgba,
              size,
              x + column * scale,
              y + row * scale,
              scale,
              scale,
              color,
            );
        }
    x += widths[characterIndex]! * scale + scale;
  }
}

export function createDeveloperMaterial(
  name: string,
  base: Rgb,
  ink: Rgb = [236, 229, 207],
): EditorMaterial {
  const size = 64;
  const rgba = new Uint8Array(size * size * 4);
  rect(rgba, size, 0, 0, size, size, base);
  rect(rgba, size, 0, 0, size, 1, ink);
  rect(rgba, size, 0, size - 1, size, 1, ink);
  rect(rgba, size, 0, 0, 1, size, ink);
  rect(rgba, size, size - 1, 0, 1, size, ink);
  const labelInk = ink.map((channel, index) =>
    Math.round(base[index]! + (channel - base[index]!) * 0.62),
  ) as unknown as Rgb;
  text(rgba, size, "64", 8, 4, 1, labelInk);
  return {
    name,
    sourceName: "Built-in Maps development material",
    width: size,
    height: size,
    rgba,
    alphaTest: false,
  };
}

export function createDiagnosticQuakePalette(): Uint8Array {
  const palette = new Uint8Array(768);
  for (let index = 0; index < 256; index += 1) {
    palette[index * 3] = (index & 7) * 36;
    palette[index * 3 + 1] = ((index >> 3) & 7) * 36;
    palette[index * 3 + 2] = ((index >> 6) & 3) * 85;
  }
  return palette;
}

/** The default texture pack shared by authoring and compiler inputs. */
export function createDevelopmentMaterials(): readonly EditorMaterial[] {
  return [
    createDeveloperMaterial("DEV_FLOOR", [205, 82, 13], [255, 214, 154]),
    createDeveloperMaterial("DEV_PILLAR", [70, 75, 79], [214, 219, 216]),
    createDeveloperMaterial("DEV_ORANGE_64", [220, 91, 12], [255, 220, 164]),
    createDeveloperMaterial("DEV_GREY_64", [83, 88, 91], [224, 228, 225]),
  ];
}

/** Named tool records let compilers retain surface semantics without external artwork. */
export function createCompilerToolMaterials(): readonly EditorMaterial[] {
  return [
    "skip",
    "hint",
    "clip",
    "trigger",
    "origin",
    "aaatrigger",
    "null",
    "nodraw",
    "invisible",
  ].map((name) => createDeveloperMaterial(name, [64, 64, 64]));
}
