import { transaction } from "./transaction.ts";
import { randomUUID } from "node:crypto";
import type { ContentStore } from "./content.ts";
import type { MediaFolder } from "../ui/public/content-types.ts";

export function mediaFolders(store: ContentStore): MediaFolder[] {
  return store.sqlite
    .prepare("SELECT * FROM media_folders ORDER BY name COLLATE NOCASE")
    .all() as unknown as MediaFolder[];
}
export function saveFolder(
  store: ContentStore,
  data: Record<string, unknown> | null,
) {
  return transaction(store.sqlite, () => {
    const folders = mediaFolders(store);
    if (
      !data ||
      (data.id !== undefined && typeof data.id !== "string") ||
      (data.parent_id != null && typeof data.parent_id !== "string") ||
      typeof data.name !== "string" ||
      !data.name.trim() ||
      data.name.length > 100 ||
      typeof data.description !== "string" ||
      data.description.length > 2000 ||
      (data.parent_id && !folders.some((f) => f.id === data.parent_id))
    )
      return {
        ok: false,
        error: "Enter a name, description, and an existing parent folder.",
      };
    if (data.id && !folders.some((f) => f.id === data.id))
      return { ok: false, error: "Folder not found." };
    let parent = data.parent_id;
    while (parent) {
      if (parent === data.id)
        return { ok: false, error: "A folder cannot go inside itself." };
      parent = folders.find((f) => f.id === parent)?.parent_id;
    }
    const name = data.name.trim();
    if (
      folders.some(
        (f) =>
          f.id !== data.id &&
          f.parent_id === (data.parent_id || null) &&
          f.name.toLowerCase() === name.toLowerCase(),
      )
    )
      return { ok: false, error: "That folder name is already in use here." };
    const id = data.id || randomUUID();
    store.sqlite
      .prepare(
        "INSERT INTO media_folders (id,name,description,parent_id) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,parent_id=excluded.parent_id",
      )
      .run(id, name, data.description, data.parent_id || null);
    return { ok: true, id, folders: mediaFolders(store) };
  });
}
export function deleteFolder(store: ContentStore, id: string) {
  return transaction(store.sqlite, () => {
    if (!mediaFolders(store).some((f) => f.id === id))
      return { ok: false, error: "Folder not found." };
    if (
      store.sqlite
        .prepare("SELECT 1 FROM media_details WHERE folder_id=?")
        .get(id) ||
      store.sqlite
        .prepare("SELECT 1 FROM media_folders WHERE parent_id=?")
        .get(id)
    )
      return { ok: false, error: "Move the files and subfolders out first." };
    store.sqlite.prepare("DELETE FROM media_folders WHERE id=?").run(id);
    return { ok: true, folders: mediaFolders(store) };
  });
}
export function saveMediaDetails(
  store: ContentStore,
  id: string,
  data: Record<string, unknown> | null,
) {
  return transaction(store.sqlite, () => {
    if (!store.mediaItem(id)) return { ok: false, error: "File not found." };
    if (
      !data ||
      typeof data.alt !== "string" ||
      (data.folder_id != null && typeof data.folder_id !== "string") ||
      data.alt.length > 2000 ||
      (data.description !== undefined &&
        (typeof data.description !== "string" ||
          data.description.length > 2000)) ||
      (data.folder_id &&
        !mediaFolders(store).some((f) => f.id === data.folder_id))
    )
      return {
        ok: false,
        error: "Check the folder and keep descriptions under 2,000 characters.",
      };
    const before = store.media().find((m) => m.id === id)!;
    store.sqlite.prepare("UPDATE media SET alt=? WHERE id=?").run(data.alt, id);
    store.sqlite
      .prepare(
        "INSERT INTO media_details (media_id,folder_id,description) VALUES (?,?,?) ON CONFLICT(media_id) DO UPDATE SET folder_id=excluded.folder_id,description=excluded.description",
      )
      .run(
        id,
        data.folder_id === undefined
          ? (before.folder_id ?? null)
          : data.folder_id || null,
        data.description ?? before.description ?? "",
      );
    return { ok: true, item: store.media().find((m) => m.id === id)! };
  });
}
