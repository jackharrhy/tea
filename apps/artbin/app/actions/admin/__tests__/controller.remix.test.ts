import * as assert from "remix/assert";
import { afterEach, beforeEach, it } from "remix/test";
import { files, folders, jobs } from "#db";
import { routes } from "../../../routes.ts";
import { adminSections } from "../../../ui/admin-sections.ts";
import {
  adminCookie,
  memberCookie,
  createRouterHarness,
  router,
  type RouterHarness,
} from "../../../../__tests__/router-harness.ts";

let harness: RouterHarness;
beforeEach(async () => {
  harness = await createRouterHarness();
});
afterEach(() => harness.close());

it("separates the overview from jobs and reports real queue counts", async () => {
  await harness.database.db.insert(jobs).values([
    { id: "queued", type: "test", input: "{}", status: "pending" },
    { id: "running", type: "test", input: "{}", status: "running" },
    { id: "failed", type: "test", input: "{}", status: "failed" },
    { id: "completed", type: "test", input: "{}", status: "completed" },
  ]);
  await harness.database.db
    .insert(folders)
    .values({ id: "uploads", name: "Uploads", slug: "uploads" });
  await harness.database.db.insert(files).values([
    {
      id: "pending",
      folderId: "uploads",
      path: "pending.txt",
      name: "pending.txt",
      kind: "other",
      mimeType: "text/plain",
      size: 1,
      status: "pending",
    },
    {
      id: "approved",
      folderId: "uploads",
      path: "approved.txt",
      name: "approved.txt",
      kind: "other",
      mimeType: "text/plain",
      size: 1,
      status: "approved",
    },
  ]);
  const response = await router.fetch(
    harness.request(routes.admin.index.href(), adminCookie),
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /1 running, 1 queued, 1 failed/);
  assert.match(html, /1 file awaiting review/);
  for (const section of adminSections)
    for (const item of section.items) {
      assert.ok(html.includes(`href="${item.href}"`));
    }
  assert.ok(!html.includes('aria-label="Background jobs"'));
  const jobPage = await router.fetch(
    harness.request(routes.admin.jobs.index.href(), adminCookie),
  );
  assert.equal(jobPage.status, 200);
  assert.match(await jobPage.text(), /aria-label="Background jobs"/);
});

it("renders an empty overview and an admin-only header link", async () => {
  const html = await (
    await router.fetch(harness.request(routes.admin.index.href(), adminCookie))
  ).text();
  assert.match(html, /0 running, 0 queued, 0 failed/);
  assert.match(html, /0 files awaiting review/);
  assert.match(html, /href="\/admin\/?"[^>]*>admin<\/a>/);
  const memberHtml = await (
    await router.fetch(harness.request(routes.folders.href(), memberCookie))
  ).text();
  assert.ok(!/href="\/admin\/?"/.test(memberHtml));
});

it("protects both overview and jobs from non-administrators", async () => {
  for (const href of [
    routes.admin.index.href(),
    routes.admin.jobs.index.href(),
  ]) {
    assert.equal(
      (await router.fetch(harness.request(href, memberCookie))).status,
      403,
    );
    const anonymous = await router.fetch(harness.request(href));
    assert.equal(anonymous.status, 303);
    assert.ok(anonymous.headers.get("location")?.startsWith("/login"));
  }
});
