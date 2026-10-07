import { d, std } from "typegpu";
import { editorSceneLayout } from "./gpu-schemas.js";

// Original world-space surface grid. Derivatives keep coverage stable under perspective and
// suppress subpixel cells; the dominant face-normal axis is excluded from the grid projection.
export function surfaceGridColor(world: d.v3f, base: d.v3f): d.v3f {
  "use gpu";
  const normal = std.abs(std.cross(std.dpdx(world), std.dpdy(world)));
  const coordinate = world.div(editorSceneLayout.$.scene.grid.w);
  const width = std.max(std.fwidth(coordinate), d.vec3f(0.00001));
  const cell = std.abs(std.fract(coordinate.add(0.5)).sub(0.5));
  const minor = std
    .saturate(d.vec3f(0.85).sub(cell.div(width)))
    .mul(std.saturate(d.vec3f(1).sub(width.mul(3))));
  const majorCoordinate = coordinate.div(8);
  const majorWidth = width.div(8);
  const majorCell = std.abs(std.fract(majorCoordinate.add(0.5)).sub(0.5));
  const major = std
    .saturate(d.vec3f(1.1).sub(majorCell.div(majorWidth)))
    .mul(std.saturate(d.vec3f(1).sub(majorWidth.mul(3))));
  const coverage = std.max(minor.mul(0.25), major.mul(0.4));
  let amount = std.max(coverage.x, coverage.y);
  if (normal.x >= normal.y && normal.x >= normal.z)
    amount = std.max(coverage.y, coverage.z);
  else if (normal.y >= normal.z) amount = std.max(coverage.x, coverage.z);
  const brightness = std.dot(base, d.vec3f(0.2126, 0.7152, 0.0722));
  let ink = d.vec3f(0.04);
  if (brightness < 0.45) ink = d.vec3f(0.94);
  return std.mix(base, ink, amount);
}
