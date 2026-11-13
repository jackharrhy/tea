import { readNativeBackup } from "./native-backup.ts";
import { readBackupSnapshot } from "./backup-snapshot.ts";
import { sha256, objectKey } from "./backup-objects.ts";
import { CommunityError } from "./data/community.ts";

function fingerprint(files: R2Object[]) {
  return JSON.stringify(files.map((file) => [file.key, file.etag, file.size]));
}

// Called only by the backup owner while capture and retention are serialized.
export async function collectBackupObjects(
  bucket: Pick<R2Bucket, "get" | "head" | "list" | "delete">,
) {
  async function inventory() {
    const files: R2Object[] = [];
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ prefix: ".backups/", cursor });
      files.push(...page.objects);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor !== undefined);
    return files.toSorted((a, b) => a.key.localeCompare(b.key));
  }
  const before = await inventory(),
    used = new Set<string>(),
    objects: string[] = [];
  for (const file of before) {
    const root =
      /^\.backups\/(native|manifests)\/([A-Za-z0-9-]{1,128})\.json$/.exec(
        file.key,
      );
    if (root) {
      if (root[1] === "native") {
        const snapshot = await readNativeBackup(bucket, root[2]);
        if (!snapshot)
          throw new CommunityError(
            409,
            "Backup disappeared during garbage collection",
          );
        for (const entry of snapshot.files) used.add(objectKey(entry.sha256));
      } else {
        const snapshot = await readBackupSnapshot(bucket, root[2]);
        if (!snapshot)
          throw new CommunityError(
            409,
            "Backup disappeared during garbage collection",
          );
        for (const entry of snapshot.objects) used.add(objectKey(entry.sha256));
      }
    } else if (/^\.backups\/objects\/[a-f0-9]{64}$/.test(file.key))
      objects.push(file.key);
    else
      throw new CommunityError(
        409,
        "Unrecognized backup storage retained; garbage collection stopped",
      );
  }
  const unused = objects.filter((key) => !used.has(key));
  for (const key of unused) {
    const stored = await bucket.get(key),
      digest = key.slice(".backups/objects/".length);
    if (
      !stored ||
      stored.customMetadata?.backup_sha256 !== digest ||
      (await sha256(await stored.arrayBuffer())) !== digest
    )
      throw new CommunityError(
        409,
        "Unverified backup object retained; garbage collection stopped",
      );
  }
  if (fingerprint(before) !== fingerprint(await inventory()))
    throw new CommunityError(
      409,
      "Backup storage changed during garbage collection",
    );
  for (const key of unused) {
    await bucket.delete(key);
    if (await bucket.head(key))
      throw new CommunityError(
        503,
        "Backup object deletion is not yet verified",
      );
  }
  return { objectsRemoved: unused.length };
}
