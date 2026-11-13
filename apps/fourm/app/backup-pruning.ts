import { readNativeBackup } from "./native-backup.ts";
import { CommunityError } from "./data/community.ts";
import type { Community } from "./data/community.ts";

// The backup owner must serialize this with capture; shared objects are retained.
export async function pruneNativeBackups(
  community: Pick<
    Community,
    "backupStatus" | "backupRetentionPlan" | "forgetPrunedBackup"
  >,
  bucket: Pick<R2Bucket, "get" | "head" | "delete">,
  actorId: number | null,
) {
  if (community.backupStatus(actorId).pending)
    throw new CommunityError(409, "Finish the pending backup before pruning");
  const plan = community.backupRetentionPlan(actorId);
  let removed = 0;
  for (const name of plan.remove) {
    const key = `.backups/native/${name}.json`;
    if (await bucket.head(key)) {
      await readNativeBackup(bucket, name);
      if (!community.backupRetentionPlan(actorId).remove.includes(name))
        continue;
      await bucket.delete(key);
    }
    if (await bucket.head(key))
      throw new CommunityError(
        503,
        "Expired backup removal is not yet verified",
      );
    if (community.forgetPrunedBackup(actorId, name)) removed++;
  }
  return { removed };
}
