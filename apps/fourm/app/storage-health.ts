import { CommunityError } from "./data/community.ts";
import type { Community } from "./data/community.ts";
export interface MediaInventory {
  paths: string[];
  reserved: string[];
}
export interface StorageHealth {
  orphanedFiles: { path: string; size: number }[];
  orphanedRecords: string[];
}
function visibleMemberFile(path: string) {
  const parts = path.split("/");
  return (
    parts.length === 2 &&
    parts.every((part) => part.length > 0 && !part.startsWith("."))
  );
}
export async function scanStorage(
  bucket: Pick<R2Bucket, "list" | "head">,
  inventory: () => Promise<MediaInventory>,
): Promise<StorageHealth> {
  const before = await inventory();
  const files: { path: string; size: number }[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ cursor });
    for (const object of page.objects)
      if (visibleMemberFile(object.key))
        files.push({ path: object.key, size: object.size });
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  const missing: string[] = [];
  for (const path of before.paths)
    if (!(await bucket.head(path))) missing.push(path);
  // A scan is observational. Recheck authority after R2 I/O so in-flight moves
  // and uploads are not presented as disposable orphan files.
  const after = await inventory();
  const protectedPaths = new Set([
    ...before.paths,
    ...before.reserved,
    ...after.paths,
    ...after.reserved,
  ]);
  const currentPaths = new Set(after.paths);
  const reserved = new Set([...before.reserved, ...after.reserved]);
  return {
    orphanedFiles: files
      .filter((file) => !protectedPaths.has(file.path))
      .toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    orphanedRecords: missing
      .filter((path) => currentPaths.has(path) && !reserved.has(path))
      .toSorted(),
  };
}

export async function cleanupOrphanMedia(
  community: Pick<Community, "pendingOrphanCleanup" | "finishOrphanCleanup">,
  bucket: Pick<R2Bucket, "delete" | "head">,
) {
  let removed = 0;
  for (const item of community.pendingOrphanCleanup()) {
    const path = String(item.storage_path);
    await bucket.delete(path);
    if (await bucket.head(path))
      throw new CommunityError(
        503,
        "Orphan media cleanup is still recovering. Try again shortly.",
      );
    community.finishOrphanCleanup(path);
    removed++;
  }
  return removed;
}
