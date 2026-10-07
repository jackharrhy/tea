import { isGameTreeAssetPath } from "@tea/maps-protocol";

export const RESOURCE_KINDS = new Set([
  "wad",
  "palette",
  "fgd",
  "def",
  "ent",
  "sprite",
  "png",
  "tga",
  "wal_json",
]);

export function resourcePathMatchesKind(name: string, kind: string): boolean {
  return (
    !["png", "tga", "wal_json"].includes(kind) ||
    (name.toLowerCase().endsWith(`.${kind}`) && isGameTreeAssetPath(name))
  );
}

export function resourceName(value: string | null): string | null {
  if (
    !value ||
    value.length > 256 ||
    value.startsWith("/") ||
    value.includes("\\")
  )
    return null;
  if (value.split("/").some((part) => !part || part === "." || part === ".."))
    return null;
  return value;
}
