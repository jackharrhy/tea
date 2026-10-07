import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const mapId = "map-a";
const source = "original checkpoint source";
const sourceSha256 = createHash("sha256").update(source).digest("hex");
const checkpoint = { id: "checkpoint-a", sourceSha256 };
const snapshot = { mapId, source, sourceSha256, mapVersion: 1 };
const comparator = fileURLToPath(
  new URL("../scripts/compare-cells.mjs", import.meta.url),
);

async function serve(checkpointText, exposeCheckpoint = true) {
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    let body;
    if (path === `/sync/maps/${mapId}/snapshot`) body = snapshot;
    else if (path === `/sync/maps/${mapId}/checkpoints`)
      body = { checkpoints: [checkpoint] };
    else if (
      path === `/sync/maps/${mapId}/checkpoints/${checkpoint.id}` &&
      exposeCheckpoint
    )
      body = { checkpoint, source: checkpointText };
    else {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function compare(database, sourceOrigin, targetOrigin, strict) {
  const child = spawn(
    process.execPath,
    [
      comparator,
      "--maps-db",
      database,
      "--source-origin",
      sourceOrigin,
      "--target-origin",
      targetOrigin,
      ...(strict ? ["--require-source-checkpoints"] : []),
    ],
    {
      env: {
        ...process.env,
        MAPS_SOURCE_TICKET_SECRET: "source-secret-with-at-least-32-characters",
        MAPS_TARGET_TICKET_SECRET: "target-secret-with-at-least-32-characters",
      },
    },
  );
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (output += chunk));
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  return { exitCode, report: JSON.parse(output) };
}

test("checkpoint comparison distinguishes metadata and full source validation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tea-maps-cell-compare-"));
  const database = join(directory, "maps.db");
  const sql = new DatabaseSync(database);
  sql.exec("CREATE TABLE maps(id TEXT PRIMARY KEY)");
  sql.prepare("INSERT INTO maps(id) VALUES (?)").run(mapId);
  sql.close();
  const target = await serve(source);
  const matchingSource = await serve(source);
  const brokenSource = await serve("damaged checkpoint source");
  const oldSource = await serve(source, false);
  try {
    const full = await compare(
      database,
      matchingSource.origin,
      target.origin,
      true,
    );
    assert.equal(full.exitCode, 0);
    assert.equal(full.report.status, "passed");
    assert.equal(full.report.checkpointSourceMode, "full");
    assert.equal(full.report.maps[0].checkpointSourcesCompared, 1);

    const damaged = await compare(
      database,
      brokenSource.origin,
      target.origin,
      true,
    );
    assert.equal(damaged.exitCode, 1);
    assert.equal(damaged.report.status, "mismatch");
    assert.equal(damaged.report.maps[0].matched, false);

    const metadata = await compare(
      database,
      oldSource.origin,
      target.origin,
      false,
    );
    assert.equal(metadata.exitCode, 0);
    assert.equal(metadata.report.checkpointSourceMode, "metadata-only");
    const unavailable = await compare(
      database,
      oldSource.origin,
      target.origin,
      true,
    );
    assert.equal(unavailable.exitCode, 1);
    assert.equal(unavailable.report.status, "mismatch");
  } finally {
    await Promise.all([
      target.close(),
      matchingSource.close(),
      brokenSource.close(),
      oldSource.close(),
    ]);
    await rm(directory, { recursive: true, force: true });
  }
});
