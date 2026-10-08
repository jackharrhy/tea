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

describe("job mutations", () => {
  it("cancels a pending job through the admin controller", async () => {
    await harness.database.db.insert(jobs).values({
      id: "pending-job",
      type: "test",
      input: "{}",
      status: "pending",
    });
    const form = new FormData();
    form.set("intent", "cancel");
    form.set("jobId", "pending-job");

    const response = await router.fetch(
      harness.request(routes.admin.jobs.action.href(), adminCookie, {
        method: "POST",
        body: form,
      }),
    );

    assert.equal(response.status, 303);
    assert.equal(
      response.headers.get("location"),
      routes.admin.jobs.index.href(),
    );
    assert.equal(
      (await harness.database.db.query.jobs.findFirst())?.status,
      "cancelled",
    );
  });
});
