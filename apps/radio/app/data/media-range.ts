export type ResolvedMediaRange = { offset: number; length: number };

export function resolveMediaRange(
  range: R2Range,
  objectSize: number,
): ResolvedMediaRange {
  let suffix = "suffix" in range ? range.suffix : undefined;
  if (typeof suffix === "number") {
    let length = Math.min(suffix, objectSize);
    return { offset: objectSize - length, length };
  }
  let offset = "offset" in range ? (range.offset ?? 0) : 0;
  let length = "length" in range ? range.length : undefined;
  return { offset, length: length ?? objectSize - offset };
}
