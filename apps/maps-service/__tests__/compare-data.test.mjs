import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { initializeWorldviewDatabase } from "../src/database-schema.ts";

const script = fileURLToPath(
  new URL("../scripts/compare-data.mjs", import.meta.url),
);

function compare(source, target) {
  const result = spawnSync(process.execPath, [script, source, target], {
    encoding: "utf8",
  });
  return { exitCode: result.status, report: JSON.parse(result.stdout) };
}

test("compares copied hosted metadata and blob bytes, and catches divergence", async () => {
  const state = await mkdtemp(join(tmpdir(), "tea-maps-data-compare-"));
  const source = join(state, "source");
  const target = join(state, "target");
  try {
    await mkdir(source);
    await mkdir(target);
    const sql = new DatabaseSync(join(source, "maps.db"));
    initializeWorldviewDatabase(sql);
    sql
      .prepare(
        "INSERT INTO users(id,fourm_sub,username,display_name,is_admin,created_at,updated_at) VALUES ('user','sub','maker','Maker',0,1,1)",
      )
      .run();
    sql
      .prepare(
        "INSERT INTO projects(id,name,game,created_by,created_at,updated_at) VALUES ('project','Example','quake','user',1,1)",
      )
      .run();
    sql
      .prepare(
        "INSERT INTO maps(id,project_id,name,format,created_by,created_at,updated_at) VALUES ('map','project','Start','quake','user',1,1)",
      )
      .run();
    sql.close();
    await copyFile(join(source, "maps.db"), join(target, "maps.db"));
    const body = Buffer.from("copied hosted resource");
    const hash = createHash("sha256").update(body).digest("hex");
    const sourceBlob = join(source, "blobs", hash.slice(0, 2), hash.slice(2));
    const targetBlob = join(target, "blobs", hash.slice(0, 2), hash.slice(2));
    await mkdir(join(source, "blobs", hash.slice(0, 2)), { recursive: true });
    await mkdir(join(target, "blobs", hash.slice(0, 2)), { recursive: true });
    await writeFile(sourceBlob, body);
    await copyFile(sourceBlob, targetBlob);

    const matched = compare(source, target);
    assert.equal(matched.exitCode, 0);
    assert.equal(matched.report.status, "passed");
    assert.equal(matched.report.source.tables.maps.rows, 1);
    assert.equal(matched.report.source.blobs.files, 1);

    const targetSql = new DatabaseSync(join(target, "maps.db"));
    targetSql.prepare("UPDATE maps SET name='Changed' WHERE id='map'").run();
    targetSql.close();
    const changed = compare(source, target);
    assert.equal(changed.exitCode, 1);
    assert.deepEqual(changed.report.mismatches, ["table:maps"]);

    await copyFile(join(source, "maps.db"), join(target, "maps.db"));
    await unlink(targetBlob);
    const missing = compare(source, target);
    assert.equal(missing.exitCode, 1);
    assert.deepEqual(missing.report.mismatches, ["blobs"]);

    await writeFile(targetBlob, "damaged hosted resource");
    const damaged = compare(source, target);
    assert.equal(damaged.exitCode, 1);
    assert.equal(damaged.report.status, "failed");
    assert.match(damaged.report.error, /Blob content does not match its name/);
  } finally {
    await rm(state, { recursive: true, force: true });
  }
});
