import { CommunityError } from "./data/community.ts";

export type ByteRange = { start: number; end: number };

// End offsets are exclusive, as in the source FileResponse implementation.
export function mediaRanges(header: string, size: number): ByteRange[] {
  const separator = header.indexOf("=");
  if (
    separator < 0 ||
    header.slice(0, separator).trim().toLowerCase() !== "bytes"
  )
    throw new CommunityError(400, "Only support bytes range");
  const parts = header.slice(separator + 1).split(",");
  if (parts.length > 100) return [];
  const ranges: ByteRange[] = [];
  for (const part of parts) {
    const match = /^\s*([+-]?\d*)\s*-\s*([+-]?\d*)\s*$/.exec(part);
    if (!match || (!match[1] && !match[2])) continue;
    const start = match[1]
      ? Number(match[1])
      : Math.max(size - Number(match[2]), 0);
    const end =
      match[1] && match[2] ? Math.min(Number(match[2]) + 1, size) : size;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) continue;
    ranges.push({ start, end });
  }
  if (!ranges.length)
    throw new CommunityError(400, "Range header: range must be requested");
  if (ranges.some(({ start }) => start < 0 || start >= size))
    throw new CommunityError(416, "Range not satisfiable");
  if (ranges.some(({ start, end }) => start >= end))
    throw new CommunityError(400, "Range header: start must be less than end");
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: ByteRange[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end)
      previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}
