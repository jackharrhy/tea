import type { Vec3 } from "./types.js";

export interface ParsedBuildPath {
  readonly points: readonly Vec3[];
  readonly diagnostics: readonly string[];
}

export interface ParsedPortalFile {
  readonly polygons: readonly (readonly Vec3[])[];
  readonly diagnostics: readonly string[];
}

function finitePoint(values: readonly string[]): Vec3 | null {
  if (values.length !== 3) return null;
  const point = values.map(Number);
  return point.every(Number.isFinite)
    ? (point as [number, number, number])
    : null;
}

/** Parses ericw-tools `.pts` and GoldSrc `.lin` point-per-line leak paths. */
export function parseLeakPath(text: string): ParsedBuildPath {
  const points: Vec3[] = [];
  const diagnostics: string[] = [];
  for (const [index, sourceLine] of text.split(/\r?\n/).entries()) {
    const line = sourceLine.trim();
    if (!line) continue;
    const point = finitePoint(
      line.replaceAll(/[(),]/g, " ").trim().split(/\s+/),
    );
    if (point) points.push(point);
    else
      diagnostics.push(`Line ${index + 1}: expected three finite coordinates`);
  }
  if (points.length < 2)
    diagnostics.push("Leak path contains fewer than two points");
  return { points, diagnostics };
}

/** Parses PRT1/PRT2 polygon records while ignoring format-specific leaf metadata. */
export function parsePortalFile(text: string): ParsedPortalFile {
  const polygons: Vec3[][] = [];
  const diagnostics: string[] = [];
  for (const [index, sourceLine] of text.split(/\r?\n/).entries()) {
    const line = sourceLine.trim();
    if (!line || /^PRT\d+$/i.test(line) || /^\d+$/.test(line)) continue;
    const points = [...line.matchAll(/\(([^()]*)\)/g)].flatMap((match) => {
      const point = finitePoint((match[1] ?? "").trim().split(/\s+/));
      return point ? [point] : [];
    });
    const expected = Number.parseInt(line, 10);
    if (
      points.length >= 3 &&
      (!Number.isFinite(expected) || expected === points.length)
    ) {
      polygons.push(points);
    } else {
      diagnostics.push(`Line ${index + 1}: malformed portal polygon`);
    }
  }
  if (polygons.length === 0)
    diagnostics.push("Portal file contains no polygons");
  return { polygons, diagnostics };
}
