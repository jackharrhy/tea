import { MapsError } from "./errors.js";

/** Normalizes a relative, containment-safe path below a game or mod root. */
export function normalizeGameAssetPath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//u, "");
  const parts = normalized.split("/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    parts.some((part) => !part || part === "." || part === "..")
  ) {
    throw new MapsError("invalid-data", `unsafe game asset path: ${path}`);
  }
  return parts.join("/").toLowerCase();
}
