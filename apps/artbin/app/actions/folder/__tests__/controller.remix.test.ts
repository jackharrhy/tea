import { access, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import * as assert from "remix/assert";
import { afterEach, beforeEach, describe, it } from "remix/test";

import { folders } from "#db";

import { routes } from "../../../routes.ts";
import {
  adminCookie,
  createRouterHarness,
  memberCookie,
  router,
  type RouterHarness,
} from "../../../../__tests__/router-harness.ts";

const oldSlug = "_router-mutation-old";
const newSlug = "router-mutation-new";
const oldPath = join(process.cwd(), "public", "uploads", oldSlug);
const newPath = join(process.cwd(), "public", "uploads", newSlug);

let harness: RouterHarness;

beforeEach(async () => {
  harness = await createRouterHarness();
  await mkdir(oldPath, { recursive: true });
  await harness.database.db.insert(folders).values({
    id: "rename-folder",
    name: "Router Mutation Old",
    slug: oldSlug,
  });
});

afterEach(async () => {
  harness.close();
  await rm(oldPath, { recursive: true, force: true });
  await rm(newPath, { recursive: true, force: true });
});

describe("folder mutations", () => {
  it("enforces admin access and renames the database record and directory", async () => {
    const form = new FormData();
    form.set("_action", "rename");
    form.set("name", "Router Mutation New");

    const forbidden = await router.fetch(
      harness.request(
        routes.folder.action.href({ path: oldSlug }),
        memberCookie,
        {
          method: "POST",
          body: form,
        },
      ),
    );
    assert.equal(forbidden.status, 403);

    const response = await router.fetch(
      harness.request(
        routes.folder.action.href({ path: oldSlug }),
        adminCookie,
        {
          method: "POST",
          body: form,
        },
      ),
    );

    assert.equal(response.status, 303);
    assert.equal(
      response.headers.get("location"),
      routes.folder.index.href({ path: newSlug }),
    );
    assert.equal(
      (await harness.database.db.query.folders.findFirst())?.slug,
      newSlug,
    );
    await access(newPath);
    await assert.rejects(access(oldPath));
  });
});
