import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "maps-db": { type: "string" },
    "source-origin": { type: "string" },
    "target-origin": { type: "string" },
    output: { type: "string" },
  },
});
const sourceSecret = process.env.MAPS_SOURCE_TICKET_SECRET;
const targetSecret = process.env.MAPS_TARGET_TICKET_SECRET;
assert.ok(values["maps-db"], "--maps-db is required");
assert.ok(values["source-origin"], "--source-origin is required");
assert.ok(values["target-origin"], "--target-origin is required");
assert.ok(sourceSecret?.length >= 32, "MAPS_SOURCE_TICKET_SECRET is required");
assert.ok(targetSecret?.length >= 32, "MAPS_TARGET_TICKET_SECRET is required");
const sourceOrigin = new URL(values["source-origin"]);
const targetOrigin = new URL(values["target-origin"]);
assert.ok(
  ["http:", "https:"].includes(sourceOrigin.protocol) &&
    ["http:", "https:"].includes(targetOrigin.protocol),
  "Origins must use HTTP or HTTPS",
);
assert.notEqual(
  sourceOrigin.origin,
  targetOrigin.origin,
  "Origins must differ",
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stable(entry)]),
    );
  return value;
}

function fingerprint(value) {
  return sha256(JSON.stringify(stable(value)));
}

function mapIds(path) {
  const sql = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(
      sql.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    const ids = sql
      .prepare("SELECT id FROM maps ORDER BY id")
      .all()
      .map(({ id }) => id);
    assert.ok(ids.length, "Hosted database has no map IDs to compare");
    return ids;
  } finally {
    sql.close();
  }
}

function ticket(mapId, secret) {
  const header = Buffer.from(
    JSON.stringify({ algorithm: "HS256", type: "WVT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      version: 2,
      mapId,
      principalId: "cutover-comparison",
      actorId: "cutover-comparison",
      role: "viewer",
      expiresAt: Date.now() + 300_000,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

async function read(origin, secret, mapId, path) {
  const url = new URL(`/sync/maps/${encodeURIComponent(mapId)}${path}`, origin);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${ticket(mapId, secret)}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`${origin.origin} returned ${response.status} for ${path}`);
  return response.json();
}

async function compareMap(mapId) {
  const [sourceSnapshot, targetSnapshot, sourceList, targetList] =
    await Promise.all([
      read(sourceOrigin, sourceSecret, mapId, "/snapshot"),
      read(targetOrigin, targetSecret, mapId, "/snapshot"),
      read(sourceOrigin, sourceSecret, mapId, "/checkpoints"),
      read(targetOrigin, targetSecret, mapId, "/checkpoints"),
    ]);
  assert.equal(sourceSnapshot.mapId, mapId);
  assert.equal(targetSnapshot.mapId, mapId);
  for (const snapshot of [sourceSnapshot, targetSnapshot]) {
    assert.equal(typeof snapshot.source, "string");
    assert.equal(sha256(snapshot.source), snapshot.sourceSha256);
  }
  assert.ok(Array.isArray(sourceList.checkpoints));
  assert.ok(Array.isArray(targetList.checkpoints));
  const sourceCheckpoints = sourceList.checkpoints.toSorted((a, b) =>
    a.id.localeCompare(b.id),
  );
  const targetCheckpoints = targetList.checkpoints.toSorted((a, b) =>
    a.id.localeCompare(b.id),
  );
  for (const checkpoint of targetCheckpoints) {
    const detail = await read(
      targetOrigin,
      targetSecret,
      mapId,
      `/checkpoints/${encodeURIComponent(checkpoint.id)}`,
    );
    assert.deepEqual(detail.checkpoint, checkpoint);
    assert.equal(sha256(detail.source), checkpoint.sourceSha256);
  }
  return {
    mapId,
    sourceSnapshotSha256: fingerprint(sourceSnapshot),
    targetSnapshotSha256: fingerprint(targetSnapshot),
    sourceCheckpointsSha256: fingerprint(sourceCheckpoints),
    targetCheckpointsSha256: fingerprint(targetCheckpoints),
    checkpoints: sourceCheckpoints.length,
    matched:
      fingerprint(sourceSnapshot) === fingerprint(targetSnapshot) &&
      fingerprint(sourceCheckpoints) === fingerprint(targetCheckpoints),
  };
}

const report = {
  status: "running",
  sourceOrigin: sourceOrigin.origin,
  targetOrigin: targetOrigin.origin,
  maps: [],
};
try {
  for (const mapId of mapIds(values["maps-db"])) {
    try {
      report.maps.push(await compareMap(mapId));
    } catch (error) {
      report.maps.push({ mapId, matched: false, error: String(error) });
    }
  }
  report.status = report.maps.every(({ matched }) => matched)
    ? "passed"
    : "mismatch";
} catch (error) {
  report.status = "failed";
  report.error = String(error);
}
if (values.output)
  await writeFile(values.output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
if (report.status !== "passed") process.exitCode = 1;
