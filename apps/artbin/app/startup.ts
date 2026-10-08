import {
  isJobRunnerActive,
  startJobRunner,
  stopJobRunner,
} from "#lib/jobs.server";
import { cleanupTusUploads } from "#lib/tus.server";

import "#lib/jobs/backfill-hashes-job.server";
import { recoverUploadJobs } from "#lib/jobs/upload-jobs.server";
import "#lib/jobs/extract-job.server";
import "#lib/jobs/folder-import-job.server";
import "#lib/jobs/regenerate-previews-job.server";
import "#lib/jobs/remote-import-job.server";
import "#lib/jobs/sadgrl-job.server";
import "#lib/jobs/scan-archives-job.server";
import "#lib/jobs/texturetown-job.server";
import "#lib/jobs/katamari-job.server";
import "#lib/jobs/early-web-graphics-job.server";
import "#lib/jobs/thejang-job.server";

let uploadCleanup: ReturnType<typeof setInterval> | undefined;

function cleanExpiredUploads(): Promise<void> {
  return cleanupTusUploads().catch((error) =>
    console.error("Upload cleanup failed", error),
  );
}

export async function startBackgroundJobs(): Promise<void> {
  if (isJobRunnerActive()) return;
  await recoverUploadJobs();
  startJobRunner(2_000);
  if (!uploadCleanup) {
    void cleanExpiredUploads();
    uploadCleanup = setInterval(cleanExpiredUploads, 60 * 60 * 1000);
    uploadCleanup.unref();
  }
}

export function stopBackgroundJobs(): void {
  if (isJobRunnerActive()) stopJobRunner();
  clearInterval(uploadCleanup);
  uploadCleanup = undefined;
}
