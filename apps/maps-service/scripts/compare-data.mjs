import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, realpath, stat, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { output: { type: "string" } },
});
assert.equal(
  positionals.length,
  2,
  "Usage: compare-data.mjs <stopped-source-data-root> <stopped-tea-data-root> [--output report.json]",
);

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function quoted(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function valueKey(value) {
  if (value === null) return ["null"];
  if (typeof value === "bigint") return ["integer", value.toString()];
  if (value instanceof Uint8Array)
    return ["blob", Buffer.from(value).toString("base64")];
  return [typeof value, value];
}

function tableDigest(sql, name) {
  const hashes = [];
  for (const row of sql.prepare(`SELECT * FROM ${quoted(name)}`).iterate())
    hashes.push(
      digest(
        JSON.stringify(
          Object.entries(row).map(([column, value]) => [
            column,
            valueKey(value),
          ]),
        ),
      ),
    );
  hashes.sort();
  return { rows: hashes.length, sha256: digest(hashes.join("\n")) };
}

function databaseReport(path) {
  const sql = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(
      sql.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    assert.equal(sql.prepare("PRAGMA foreign_key_check").get(), undefined);
    const entries = sql
      .prepare(
        "SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all();
    const tables = Object.fromEntries(
      entries.map(({ name, sql: schema }) => [
        name,
        { schemaSha256: digest(schema), ...tableDigest(sql, name) },
      ]),
    );
    const references = [];
    if (tables.resource_mounts) {
      for (const row of sql
        .prepare("SELECT expected_sha256,metadata_json FROM resource_mounts")
        .iterate()) {
        const metadata = JSON.parse(row.metadata_json);
        references.push({
          kind: "resource mount",
          sha256: row.expected_sha256,
          size: metadata.size,
        });
      }
    }
    if (tables.builds) {
      for (const row of sql
        .prepare("SELECT result_json FROM builds WHERE result_json IS NOT NULL")
        .iterate()) {
        const result = JSON.parse(row.result_json);
        if (result.artifacts === undefined) continue;
        assert.ok(Array.isArray(result.artifacts), "Invalid build artifacts");
        for (const artifact of result.artifacts)
          references.push({
            kind: "build artifact",
            sha256: artifact.sha256,
            size: artifact.size,
          });
      }
    }
    return { tables, references };
  } finally {
    sql.close();
  }
}

async function fileDigest(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function blobReport(root, references) {
  const blobs = join(root, "blobs");
  const records = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (directory === blobs && error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      assert.ok(entry.isFile(), `Unexpected blob entry: ${path}`);
      const location = relative(blobs, path);
      assert.match(
        location,
        /^[a-f0-9]{2}\/[a-f0-9]{62}$/,
        `Unexpected blob name: ${path}`,
      );
      const name = location.replace("/", "");
      const details = await stat(path);
      const sha256 = await fileDigest(path);
      assert.equal(
        sha256,
        name,
        `Blob content does not match its name: ${path}`,
      );
      records.push({ name, size: details.size });
    }
  }
  await visit(blobs);
  records.sort((left, right) => left.name.localeCompare(right.name));
  const byHash = new Map(records.map((record) => [record.name, record.size]));
  for (const reference of references) {
    assert.match(reference.sha256, /^[a-f0-9]{64}$/);
    assert.ok(
      Number.isSafeInteger(reference.size) && reference.size >= 0,
      `Invalid ${reference.kind} blob size`,
    );
    assert.ok(
      byHash.has(reference.sha256),
      `Missing ${reference.kind} blob ${reference.sha256}`,
    );
    assert.equal(
      byHash.get(reference.sha256),
      reference.size,
      `Wrong ${reference.kind} blob size ${reference.sha256}`,
    );
  }
  return {
    files: records.length,
    bytes: records.reduce((sum, record) => sum + record.size, 0),
    sha256: digest(JSON.stringify(records)),
    referencedFiles: new Set(references.map((reference) => reference.sha256))
      .size,
  };
}

async function report(root) {
  const { tables, references } = databaseReport(join(root, "maps.db"));
  return {
    tables,
    blobs: await blobReport(root, references),
  };
}

const [sourceRoot, targetRoot] = positionals;
const comparison = { sourceRoot, targetRoot, status: "running" };
try {
  const [sourcePath, targetPath] = await Promise.all([
    realpath(sourceRoot),
    realpath(targetRoot),
  ]);
  assert.notEqual(
    sourcePath,
    targetPath,
    "Compare separate source and Tea data roots",
  );
  const [sourceDatabase, targetDatabase] = await Promise.all([
    stat(join(sourceRoot, "maps.db")),
    stat(join(targetRoot, "maps.db")),
  ]);
  assert.ok(
    sourceDatabase.dev !== targetDatabase.dev ||
      sourceDatabase.ino !== targetDatabase.ino,
    "Compare independent Maps database files",
  );
  comparison.source = await report(sourceRoot);
  comparison.target = await report(targetRoot);
  comparison.mismatches = [];
  for (const table of new Set([
    ...Object.keys(comparison.source.tables),
    ...Object.keys(comparison.target.tables),
  ])) {
    if (
      JSON.stringify(comparison.source.tables[table]) !==
      JSON.stringify(comparison.target.tables[table])
    )
      comparison.mismatches.push(`table:${table}`);
  }
  if (
    JSON.stringify(comparison.source.blobs) !==
    JSON.stringify(comparison.target.blobs)
  )
    comparison.mismatches.push("blobs");
  comparison.status = comparison.mismatches.length ? "mismatch" : "passed";
} catch (error) {
  comparison.status = "failed";
  comparison.error = String(error);
}
if (values.output)
  await writeFile(values.output, `${JSON.stringify(comparison, null, 2)}\n`);
console.log(JSON.stringify(comparison));
if (comparison.status !== "passed") process.exitCode = 1;
