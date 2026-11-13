import { inspectBackupCatalogue } from "./backup-catalogue.ts";
import type { BackupActor } from "./data/backups.ts";
import { captureNativeBackup, readNativeBackup } from "./native-backup.ts";
import { CommunityError } from "./data/community.ts";
import type { Community } from "./data/community.ts";

type BackupAuthority = Pick<
  Community,
  | "beginBackup"
  | "exportRecovery"
  | "completeBackup"
  | "failBackup"
  | "backupStatus"
  | "backupDueAt"
  | "adoptVerifiedBackups"
>;
export async function runNativeBackup(
  community: BackupAuthority,
  bucket: Pick<R2Bucket, "get" | "head" | "put" | "list">,
  actorId: BackupActor,
  interval = 3600000,
) {
  const before = community.backupStatus(actorId);
  if (!before.backups.length || before.pending) {
    const catalogue = await inspectBackupCatalogue(bucket);
    if (catalogue.rejected.length)
      throw new CommunityError(
        409,
        "Backup catalogue contains unverifiable snapshots. Reconcile them before starting another run.",
      );
    const adopted = community.adoptVerifiedBackups(actorId, catalogue.records);
    if (adopted.conflicts.length)
      throw new CommunityError(
        409,
        "Backup catalogue conflicts with saved terminal receipts.",
      );
    const recovered =
      before.pending &&
      catalogue.records.find((record) => record.name === before.pending!.name);
    if (recovered)
      return community.completeBackup(
        recovered.name,
        recovered.db_size,
        recovered.file_count,
      );
  }
  if (actorId === "scheduler" && community.backupDueAt(interval) > Date.now()) {
    const last = community.backupStatus(actorId).last;
    if (last) return last;
  }
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
