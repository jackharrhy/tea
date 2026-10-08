export function sanitizeFilename(filename: string): string {
  return (
    filename
      // oxlint-disable-next-line eslint/no-control-regex -- The filename filter must replace control bytes.
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^\.+/, "")
      .slice(0, 255)
  );
}

export function cleanFolderSlug(slug: string): string {
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Clean a full folder path by cleaning each segment individually, preserving slashes. */
export function cleanFolderPath(path: string): string {
  return path
    .split("/")
    .map((s) => cleanFolderSlug(s))
    .filter(Boolean)
    .join("/");
}
