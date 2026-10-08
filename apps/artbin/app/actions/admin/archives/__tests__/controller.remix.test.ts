import * as assert from "remix/assert";
import { afterEach, beforeEach, describe, it } from "remix/test";

import { jobs } from "#db";

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

describe("archive mutations", () => {
  it("queues separate archive and BSP batch jobs with normalized inputs", async () => {
    const form = new FormData();
    form.set("intent", "batch-import");
    form.set("folderName", "Router Batch");
    form.set("folderSlug", "Router Batch");
    form.append("archivePath", "/archives/Maps Pack.zip");
    form.append("archivePath", "/archives/crossfire.bsp");

    const response = await router.fetch(
      harness.request(routes.admin.archives.action.href(), adminCookie, {
        method: "POST",
        body: form,
      }),
    );

    assert.equal(response.status, 303);
    const queued = await harness.database.db.select().from(jobs);
    assert.deepEqual(queued.map((job) => job.type).toSorted(), [
      "batch-extract-archive",
      "batch-extract-bsp",
    ]);
    for (const job of queued) {
      const input = JSON.parse(job.input) as {
        parentFolderSlug: string;
        userId: string;
      };
      assert.equal(input.parentFolderSlug, "router-batch");
      assert.equal(input.userId, "admin");
    }
  });
});
