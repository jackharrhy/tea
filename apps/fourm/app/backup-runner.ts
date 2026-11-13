import { captureNativeBackup, readNativeBackup } from "./native-backup.ts";
import { CommunityError } from "./data/community.ts";
import type { Community } from "./data/community.ts";

type BackupAuthority = Pick<
  Community,
  "beginBackup" | "exportRecovery" | "completeBackup" | "failBackup"
>;
export async function runNativeBackup(
  community: BackupAuthority,
  bucket: Pick<R2Bucket, "get" | "head" | "put" | "list">,
  actorId: number | null,
) {
  const job = community.beginBackup(actorId),
    name = String(job.name);
  let snapshot;
  try {
    snapshot = await captureNativeBackup(bucket, name, async () =>
      community.exportRecovery(actorId),
    );
  } catch (error) {
    try {
      snapshot = await readNativeBackup(bucket, name);
    } catch {
      throw new CommunityError(
        503,
        "Backup outcome is not yet verified. Retry this run.",
      );
    }
    if (!snapshot)
      return community.failBackup(
        name,
        error instanceof CommunityError
          ? error.message.slice(0, 256)
          : "Backup could not finish. Try again.",
      );
  }
  return community.completeBackup(
    name,
    new TextEncoder().encode(JSON.stringify(snapshot.recovery)).byteLength,
    snapshot.files.length,
  );
}
