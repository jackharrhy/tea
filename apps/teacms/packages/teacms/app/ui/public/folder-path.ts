import type { MediaFolder } from "./content-types.ts";

export function folderPath(folders: MediaFolder[], id: string | null): string {
  const names: string[] = [],
    visited = new Set<string>();
  while (id) {
    if (visited.has(id)) throw new Error("Invalid folder cycle.");
    visited.add(id);
    const folder = folders.find((item) => item.id === id);
    if (!folder) break;
    names.unshift(folder.name);
    id = folder.parent_id;
  }
  return names.join(" / ");
}
