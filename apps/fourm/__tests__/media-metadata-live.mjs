import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { reviewSourceFingerprint } from "../scripts/review-source.mjs";
const root = "/home/jack/.local/state/form-harrhy-integration/candidate",
  origin = "http://127.0.0.1:18974",
  oracle = "http://127.0.0.1:18964";
const tokenFile = process.env.FOURM_ACCESS_TOKEN_FILE;
if (!tokenFile)
  throw Error("A private fixture resource token file is required");
const token = (await readFile(tokenFile, "utf8")).trim();
const inventory = JSON.parse(
  await readFile(
    root + "/parity-cohort-metadata-20261112/inventory.json",
    "utf8",
  ),
);
const output =
  root + "/media-metadata-" + new Date().toISOString().replace(/[:.]/g, "");
await mkdir(output, { mode: 0o700 });
const results = [];
let phase = "readiness";
try {
  assert.equal(
    (await (await fetch(origin + "/ready")).json()).sourceFingerprint,
    await reviewSourceFingerprint(resolve("apps/fourm")),
  );
  const headers = { Authorization: "Bearer " + token };
  async function stage(item, overrides = {}) {
    const bytes = await readFile(
      root + "/parity-cohort-20261112/uploads/" + item.path,
    );
    assert.equal(createHash("sha256").update(bytes).digest("hex"), item.sha256);
    return fetch(
      origin +
        "/api/archive/media/" +
        item.path.split("/").map(encodeURIComponent).join("/"),
      {
        method: "PUT",
        headers: {
          ...headers,
          "Content-Type": item.content_type,
          "X-Content-SHA256": item.sha256,
          "X-Source-Last-Modified": item.last_modified,
          "X-Source-ETag": item.etag,
          "X-Source-Mtime-Ns": item.mtime_ns,
          ...overrides,
        },
        body: bytes,
        signal: AbortSignal.timeout(30000),
      },
    );
  }
  phase = "stage-verified-stat-metadata";
  for (const item of inventory.assets) {
    const r = await stage(item);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, sha256: item.sha256 });
  }
  phase = "metadata-replay";
  assert.equal((await stage(inventory.assets[0])).status, 200);
  phase = "invalid-metadata";
  assert.equal(
    (await stage(inventory.assets[0], { "X-Source-ETag": "invalid" })).status,
    422,
  );
  phase = "all-original-file-headers";
  for (const item of inventory.assets) {
    const path =
      "/uploads/" + item.path.split("/").map(encodeURIComponent).join("/");
    for (const base of [oracle, origin]) {
      const r = await fetch(base + path, { method: "HEAD" });
      assert.equal(r.status, 200);
      assert.equal(
        r.headers.get("Cache-Control"),
        null,
        "Public media must retain the source cache policy",
      );
      for (const [header, value] of [
        ["Content-Type", item.content_type],
        ["Content-Length", String(item.bytes)],
        ["Last-Modified", item.last_modified],
        ["ETag", item.etag],
      ])
        assert.equal(
          r.headers.get(header),
          value,
          `${header} differs from source backup`,
        );
      const conditional = await fetch(base + path, {
        headers: { "If-None-Match": item.etag },
      });
      assert.equal(conditional.status, 304);
    }
    results.push({
      sha256: item.sha256,
      bytes: item.bytes,
      contentType: true,
      lastModified: true,
      etag: true,
      conditional: true,
    });
  }
  phase = "archive-stat-readback";
  const archiveResponse = await fetch(origin + "/api/archive", { headers });
  assert.equal(archiveResponse.status, 200);
  const archive = await archiveResponse.json();
  for (const item of inventory.assets) {
    const descriptor = archive.objects.find(
      (object) => object.storage_path === item.path,
    );
    assert.ok(descriptor);
    assert.equal(descriptor.mtime_ns, item.mtime_ns);
    assert.equal(descriptor.last_modified, item.last_modified);
    assert.equal(descriptor.etag, item.etag);
    assert.equal(descriptor.content_type, item.content_type);
  }
  await writeFile(
    output + "/receipt.json",
    JSON.stringify(
      {
        status: "PASS",
        assets: results.length,
        metadataReplay: true,
        invalidMetadataRejected: true,
        nanosecondArchiveReadback: true,
        results,
        productionTouched: false,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({ status: "PASS", assets: results.length, output }),
  );
} catch (error) {
  await writeFile(
    output + "/failure.json",
    JSON.stringify(
      { phase, message: error.message, completed: results.length },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(JSON.stringify({ status: "FAIL", phase, output }));
  process.exitCode = 1;
}
