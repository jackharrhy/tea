import { validPlacement } from "./placement.ts";

export interface AdornmentInstance {
  id: string;
  adornmentName: string;
  css?: Record<string, string | number>;
}

// Library names identify artwork; IDs identify individual placements. Old content
// gets deterministic IDs in memory only, so reading never rewrites authored data.
export function parseAdornmentInstances(
  value: unknown,
): AdornmentInstance[] | null {
  if (value === undefined || value === "") return [];
  if (typeof value !== "string") return null;
  try {
    const refs = JSON.parse(value);
    if (!Array.isArray(refs) || refs.length > 100) return null;
    const ids = new Set<string>();
    const result: AdornmentInstance[] = [];
    for (const [index, item] of refs.entries()) {
      if (
        !item ||
        typeof item.adornmentName !== "string" ||
        (item.css !== undefined && !validPlacement(item.css)) ||
        (item.id !== undefined &&
          (typeof item.id !== "string" || !item.id || item.id.length > 200))
      )
        return null;
      const id = item.id ?? `legacy:${index}`;
      if (ids.has(id)) return null;
      ids.add(id);
      result.push({ ...item, id });
    }
    return result;
  } catch {
    return null;
  }
}
