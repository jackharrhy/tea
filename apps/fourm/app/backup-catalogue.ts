import { readNativeBackup } from "./native-backup.ts";
import { backupNameTime } from "./backup-retention.ts";
import { CommunityError } from "./data/community.ts";
export interface VerifiedBackupRecord {
  name: string;
  started_at: number;
  finished_at: number;
  db_size: number;
  file_count: number;
}
export async function inspectBackupCatalogue(
  bucket: Pick<R2Bucket, "get" | "list">,
) {
  const prefix = ".backups/native/",
    records: VerifiedBackupRecord[] = [],
    rejected: { key: string; reason: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    for (const object of page.objects) {
      if (!object.key.startsWith(prefix))
        throw new CommunityError(503, "Backup listing escaped its namespace");
      const name = object.key.slice(prefix.length, -5);
      if (
        !object.key.endsWith(".json") ||
        !/^[A-Za-z0-9-]{1,128}$/.test(name)
      ) {
        rejected.push({
          key: object.key,
          reason: "Unrecognized snapshot key; retained",
        });
        continue;
      }
      try {
        const backup = await readNativeBackup(bucket, name);
        if (!backup)
          throw new CommunityError(
            409,
            "Snapshot disappeared during verification",
          );
        const published = new Date(object.uploaded).getTime();
        const started = backupNameTime(name) ?? published;
        if (
          !Number.isSafeInteger(started) ||
          started < 0 ||
          !Number.isSafeInteger(published) ||
          published < 0
        )
          throw new CommunityError(409, "Snapshot timestamp unavailable");
        records.push({
          name,
          started_at: started,
          finished_at: published,
          db_size: new TextEncoder().encode(JSON.stringify(backup.recovery))
            .byteLength,
          file_count: backup.files.length,
        });
      } catch (error) {
        rejected.push({
          key: object.key,
          reason:
            error instanceof CommunityError
              ? error.message
              : "Snapshot verification unavailable",
        });
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  return { records, rejected };
}
