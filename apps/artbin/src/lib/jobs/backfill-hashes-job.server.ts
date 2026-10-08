import { db } from "#db/connection.server";
import { files } from "#db";
import { eq, isNull } from "drizzle-orm";
import { registerJobHandler, updateJobProgress } from "../jobs.server.ts";
import { getFilePath, computeSha256FromFile } from "../files.server.ts";
import { existsSync } from "fs";
import { createRequestLogger } from "evlog";
import type { Job } from "#db";

async function handleBackfillHashes(
  job: Job,
  _input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // Get all files that don't have a sha256 hash
  const unhashed = await db.query.files.findMany({
    where: isNull(files.sha256),
    columns: { id: true, path: true },
  });

  const total = unhashed.length;
  let hashed = 0;
  let skipped = 0;

  await updateJobProgress(job.id, 0, `Found ${total} files without hashes`);

  for (let i = 0; i < unhashed.length; i++) {
    const file = unhashed[i];
    const absolutePath = getFilePath(file.path);

    if (!existsSync(absolutePath)) {
      skipped++;
    } else {
      try {
        const sha256 = await computeSha256FromFile(absolutePath);
        await db.update(files).set({ sha256 }).where(eq(files.id, file.id));
        hashed++;
      } catch (err) {
        const log = createRequestLogger();
        log.error(err instanceof Error ? err : new Error(String(err)), {
          step: "compute-hash",
          file: file.path,
        });
        log.emit();
        skipped++;
      }
    }

    // Update progress every 100 files
    if ((i + 1) % 100 === 0 || i === unhashed.length - 1) {
      const pct = Math.round(((i + 1) / total) * 100);
      await updateJobProgress(
        job.id,
        pct,
        `${hashed} hashed, ${skipped} skipped of ${total}`,
      );
    }
  }

  return { total, hashed, skipped };
}

registerJobHandler("backfill-hashes", handleBackfillHashes);
