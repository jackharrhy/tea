import { restoreSnapshot } from "../backup/snapshot.ts";
if (process.argv.length !== 4)
  throw new Error(
    "Usage: restore-backup.ts <snapshot-directory> <new-data-directory> (CMS must be stopped)",
  );
await restoreSnapshot(process.argv[2]!, process.argv[3]!);
console.log(
  "TeaCMS backup verified and restored to new directory; sessions invalidated. Review origins/configuration before starting CMS.",
);
