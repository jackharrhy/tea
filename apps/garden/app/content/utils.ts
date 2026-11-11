/**
 * Resolve an og-image value from frontmatter.
 * Handles Obsidian wikilink syntax: "![[filename.png]]" or "![[filename.png|WxH]]"
 * Returns a proper /asset/ URL, or passes through already-resolved URLs unchanged.
 */
export const resolveOgImage = (
  ogImage: string | undefined,
): string | undefined => {
  if (!ogImage) return undefined;

  // Match ![[filename]] or ![[filename|WxH]]
  const wikilinkMatch = ogImage.match(/^!?\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]$/);
  if (wikilinkMatch) {
    return `/asset/${wikilinkMatch[1]}`;
  }

  return ogImage;
};
