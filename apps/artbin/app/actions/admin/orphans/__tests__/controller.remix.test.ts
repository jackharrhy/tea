import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import * as assert from "remix/assert";
import { afterEach, beforeEach, describe, it } from "remix/test";

import { files, folders } from "#db";

import { routes } from "../../../../routes.ts";
import {
  adminCookie,
  createRouterHarness,
  router,
  type RouterHarness,
} from "../../../../../__tests__/router-harness.ts";

const protectedPath = join(process.cwd(), "tmp", "router-protected.txt");
const adoptionRoot = join(
  process.cwd(),
  "public",
  "uploads",
  "_orphan-adoption-test",
);

let harness: RouterHarness;

beforeEach(async () => {
  harness = await createRouterHarness();
  await mkdir(join(process.cwd(), "tmp"), { recursive: true });
  await writeFile(protectedPath, "must survive");
});

afterEach(async () => {
  harness.close();
  await rm(protectedPath, { force: true });
  await rm(adoptionRoot, { recursive: true, force: true });
});

describe("orphan cleanup mutations", () => {
  it("rejects paths that escape the uploads directory", async () => {
    const form = new FormData();
    form.set("intent", "delete-orphans");
    form.set("paths", JSON.stringify(["../../tmp/router-protected.txt"]));

    const response = await router.fetch(
      harness.request(routes.admin.orphans.action.href(), adminCookie, {
        method: "POST",
        body: form,
      }),
    );

    assert.equal(response.status, 400);
    assert.equal(await response.text(), "Invalid orphan path");
    await access(protectedPath);
  });

  it("adopts existing upload files into folders and database records", async () => {
    const wadPath = join(adoptionRoot, "goldsrc", "halflife.wad");
    const contents = Buffer.from("WAD3 existing file contents");
    await mkdir(join(adoptionRoot, "goldsrc"), { recursive: true });
    await writeFile(wadPath, contents);
    const form = new FormData();
    form.set("intent", "adopt-orphans");
    form.set(
      "paths",
      JSON.stringify(["_orphan-adoption-test/goldsrc/halflife.wad"]),
    );

    const response = await router.fetch(
      harness.request(routes.admin.orphans.action.href(), adminCookie, {
        method: "POST",
        body: form,
      }),
    );

    assert.equal(response.status, 303);
    const record = await harness.database.db.query.files.findFirst();
    assert.ok(record);
    assert.equal(record.path, "_orphan-adoption-test/goldsrc/halflife.wad");
    assert.equal(record.source, "filesystem-adopted");
    assert.equal(record.status, "approved");
    assert.equal(record.size, contents.length);
    const adoptedFolders = await harness.database.db.select().from(folders);
    assert.deepEqual(adoptedFolders.map((folder) => folder.slug).toSorted(), [
      "_orphan-adoption-test",
      "_orphan-adoption-test/goldsrc",
    ]);
    assert.equal((await harness.database.db.select().from(files)).length, 1);
    await access(wadPath);
  });
});
