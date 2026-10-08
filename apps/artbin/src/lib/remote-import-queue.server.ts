import { db } from "#db/connection.server";
import { createJob } from "#lib/jobs.server";
import { parseRemoteImportUrl } from "#lib/import-sources.server";

interface QueueRemoteImportsInput {
  sourceUrls: string;
  targetFolderId: string | null;
  userId: string;
}

export interface QueueRemoteImportsResult {
  count: number;
  jobIds: string[];
}

export async function queueRemoteImports({
  sourceUrls,
  targetFolderId,
  userId,
}: QueueRemoteImportsInput): Promise<QueueRemoteImportsResult> {
  const urls = sourceUrls
    .split(/\r?\n/)
    .map((url) => url.trim())
    .filter(Boolean);

  if (urls.length === 0) {
    throw new Error("Paste at least one supported site or direct archive URL");
  }
  if (urls.length > 20) {
    throw new Error("Queue at most 20 URLs at a time");
  }

  if (targetFolderId) {
    const destination = await db.query.folders.findFirst({
      where: (folders, { eq }) => eq(folders.id, targetFolderId),
      columns: { id: true },
    });
    if (!destination) {
      throw new Error("The selected destination folder no longer exists");
    }
  }

  const uniqueSources = new Map<
    string,
    ReturnType<typeof parseRemoteImportUrl>
  >();
  for (const sourceUrl of urls) {
    const parsed = parseRemoteImportUrl(sourceUrl);
    uniqueSources.set(`${parsed.provider}:${parsed.externalId}`, parsed);
  }

  const queuedJobs = [];
  for (const parsed of uniqueSources.values()) {
    queuedJobs.push(
      await createJob({
        type: "remote-map-import",
        input: {
          sourceUrl: parsed.canonicalUrl,
          targetFolderId,
          userId,
        },
        userId,
      }),
    );
  }

  return {
    count: queuedJobs.length,
    jobIds: queuedJobs.map((job) => job.id),
  };
}
