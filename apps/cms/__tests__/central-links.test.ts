import { it } from "remix/test";
import * as assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyReviewedLinks } from "../scripts/link-central-auth.ts";

it("preflights every local ID before applying reviewed subject links", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cms-links-"));
  const first = join(dir, "operator.db"),
    second = join(dir, "site.db");
  for (const path of [first, second]) {
    const database = new DatabaseSync(path);
    database.exec(
      "CREATE TABLE users(id INTEGER PRIMARY KEY, auth_subject TEXT); INSERT INTO users(id) VALUES (1)",
    );
    database.close();
  }
  try {
    const targets = [
      { name: "operator", path: first, rows: [{ id: 1, subject: "owner" }] },
      { name: "site", path: second, rows: [{ id: 2, subject: "editor" }] },
    ];
    assert.throws(
      () => applyReviewedLinks(targets, true),
      /Unknown local user ID/,
    );
    const database = new DatabaseSync(first);
    assert.equal(
      database.prepare("SELECT auth_subject FROM users WHERE id=1").get()
        ?.auth_subject,
      null,
    );
    database.close();
    targets[1].rows[0].id = 1;
    assert.deepEqual(applyReviewedLinks(targets, false), [
      { target: "operator", links: 1 },
      { target: "site", links: 1 },
    ]);
    assert.deepEqual(applyReviewedLinks(targets, true), [
      { target: "operator", links: 1 },
      { target: "site", links: 1 },
    ]);
    assert.deepEqual(applyReviewedLinks(targets, true), [
      { target: "operator", links: 1 },
      { target: "site", links: 1 },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
