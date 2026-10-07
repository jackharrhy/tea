import { BinaryView } from "./binary.js";
import { invariant } from "./errors.js";
import type { Bounds } from "./types.js";

export function bspRecordCount(
  lump: BinaryView,
  size: number,
  label: string,
): number {
  invariant(lump.byteLength % size === 0, `${label} lump has a partial record`);
  return lump.byteLength / size;
}

export function checkedBspProduct(
  left: number,
  right: number,
  label: string,
): number {
  const product = left * right;
  invariant(
    Number.isSafeInteger(product) && product >= 0,
    `${label} allocation overflows`,
  );
  return product;
}

export function finiteBspFloat(
  lump: BinaryView,
  offset: number,
  label: string,
): number {
  const value = lump.f32(offset);
  invariant(Number.isFinite(value), `${label} is not finite`);
  return value;
}

export function normalizeBspBounds(bounds: Bounds): {
  readonly bounds: Bounds;
  readonly invertedAxes: readonly ("x" | "y" | "z")[];
} {
  const axes = ["x", "y", "z"] as const;
  const invertedAxes = axes.filter(
    (_, axis) => bounds.min[axis]! > bounds.max[axis]!,
  );
  if (invertedAxes.length === 0) return { bounds, invertedAxes };
  return {
    bounds: {
      min: [
        Math.min(bounds.min[0], bounds.max[0]),
        Math.min(bounds.min[1], bounds.max[1]),
        Math.min(bounds.min[2], bounds.max[2]),
      ],
      max: [
        Math.max(bounds.min[0], bounds.max[0]),
        Math.max(bounds.min[1], bounds.max[1]),
        Math.max(bounds.min[2], bounds.max[2]),
      ],
    },
    invertedAxes,
  };
}
