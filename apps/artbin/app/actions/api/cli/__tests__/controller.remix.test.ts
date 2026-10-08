import * as assert from "remix/assert";
import { afterEach, beforeEach, describe, it } from "remix/test";

import { files, folders, jobs } from "#db";
import { processJob } from "#lib/jobs.server";
import "#lib/jobs/upload-jobs.server";

import { routes } from "../../../../routes.ts";
import {
  adminCookie,
  createRouterHarness,
  router,
  type RouterHarness,
} from "../../../../../__tests__/router-harness.ts";

let harness: RouterHarness;

beforeEach(async () => {
  harness = await createRouterHarness();
});

afterEach(() => harness.close());

describe("CLI finalization mutations", () => {
  it("finalizes more than 500 folders and exposes preview progress through the router", async () => {
    await harness.database.db.insert(folders).values([
      {
        id: "root-folder",
        name: "Root",
        slug: "router-finalize",
        fileCount: 99,
      },
      {
        id: "sibling-folder",
        name: "Sibling",
        slug: "router-finalize-other",
        fileCount: 99,
      },
      {
        id: "child-folder",
        name: "Child",
        slug: "router-finalize/child",
        parentId: "root-folder",
        fileCount: 99,
      },
    ]);
    await harness.database.db.insert(folders).values(
      Array.from({ length: 600 }, (_, index) => ({
        id: `bulk-${index}`,
        name: `Bulk ${index}`,
        slug: `router-finalize/bulk-${index}`,
        parentId: "root-folder",
        fileCount: 99,
      })),
    );
    await harness.database.db.insert(files).values({
      id: "finalized-file",
      path: "router-finalize/child/file.txt",
      name: "file.txt",
      mimeType: "text/plain",
      size: 4,
      kind: "other",
      folderId: "child-folder",
    });

    const response = await router.fetch(
      harness.request(routes.api.finalizeUploads.href(), adminCookie, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentFolder: "router-finalize" }),
      }),
    );

    assert.equal(response.status, 202);
    const queued = (await harness.database.db.select().from(jobs))[0]!;
    assert.deepEqual(await response.json(), { jobId: queued.id });
    assert.equal(queued.status, "pending");
    assert.equal((await processJob(queued)).isOk(), true);
    const records = await harness.database.db.select().from(folders);
    assert.equal(
      records.filter(
        (folder) => folder.id.startsWith("bulk-") && folder.fileCount === 0,
      ).length,
      600,
    );
    assert.deepEqual(
      Object.fromEntries(
        records
          .filter((folder) => !folder.id.startsWith("bulk-"))
          .map((folder) => [folder.id, folder.fileCount]),
      ),
      {
        "root-folder": 0,
        "child-folder": 1,
        "sibling-folder": 99,
      },
    );
    const status = await router.fetch(
      harness.request(
        routes.api.uploadJob.href({ jobId: queued.id }),
        adminCookie,
      ),
    );
    const report = (await status.json()) as {
      status: string;
      progress: number;
      progressMessage: string;
      output: { finalized: number };
    };
    assert.equal(report.status, "completed");
    assert.equal(report.progress, 100);
    assert.equal(report.progressMessage, "Refreshing folder previews: 602/602");
    assert.equal(report.output.finalized, 602);
  });
});
