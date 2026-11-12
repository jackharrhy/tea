import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { reviewSourceFingerprint } from "../scripts/review-source.mjs";
const root = "/home/jack/.local/state/form-harrhy-integration/candidate";
const cohort = root + "/parity-cohort-20261112";
const inventory = JSON.parse(
  await readFile(cohort + "/inventory.json", "utf8"),
);
const selected = [
  /\.(mp3|ogg|wav)$/i,
  /\.(mp4|webm)$/i,
  /\.(png|jpg|jpeg|gif)$/i,
]
  .map((pattern) => inventory.assets.find((item) => pattern.test(item.path)))
  .filter(Boolean);
const output =
  root + "/media-http-parity-" + new Date().toISOString().replace(/[:.]/g, "");
await mkdir(output, { mode: 0o700 });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
let phase = "readiness";
const results = [];
try {
  const native = "http://127.0.0.1:18974";
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      if (
        (await fetch(native + "/ready", { signal: AbortSignal.timeout(2000) }))
          .ok
      )
        break;
    } catch {}
    if (Date.now() > deadline)
      throw new Error("Private media listener not ready");
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const fingerprint = await reviewSourceFingerprint(
    fileURLToPath(new URL("..", import.meta.url)),
  );
  assert.equal(
    (await (await fetch(native + "/ready")).json()).sourceFingerprint,
    fingerprint,
  );
  for (const asset of selected) {
    const bytes = await readFile(cohort + "/uploads/" + asset.path);
    const observations = [];
    for (const origin of ["http://127.0.0.1:18964", native]) {
      const url =
        origin +
        "/uploads/" +
        asset.path.split("/").map(encodeURIComponent).join("/");
      async function request(method, headers = {}) {
        const response = await fetch(url, { method, headers });
        return { response, bytes: Buffer.from(await response.arrayBuffer()) };
      }
      phase = "whole-file";
      const full = await request("GET");
      assert.equal(full.response.status, 200);
      assert.equal(sha(full.bytes), asset.sha256);
      const length = full.response.headers.get("Content-Length");
      if (length !== null) assert.equal(Number(length), bytes.length);
      else
        assert.equal(full.response.headers.get("Transfer-Encoding"), "chunked");
      assert.equal(full.response.headers.get("Accept-Ranges"), "bytes");
      for (const [range, expected] of [
        ["bytes=0-31", bytes.subarray(0, 32)],
        ["bytes=-32", bytes.subarray(-32)],
        [`bytes=${bytes.length - 32}-`, bytes.subarray(-32)],
      ]) {
        phase = "seek";
        const r = await request("GET", { Range: range });
        assert.equal(r.response.status, 206);
        assert.deepEqual(r.bytes, expected);
        const head = await request("HEAD", { Range: range });
        assert.equal(head.response.status, 206);
        assert.equal(head.bytes.length, 0);
        assert.equal(
          head.response.headers.get("Content-Length"),
          String(expected.length),
        );
      }
      phase = "conditional";
      for (const headers of [
        { "If-None-Match": full.response.headers.get("ETag") },
        { "If-Modified-Since": full.response.headers.get("Last-Modified") },
      ])
        assert.equal((await request("GET", headers)).response.status, 304);
      const stale = await request("GET", {
        Range: "bytes=0-31",
        "If-Range": '"outdated"',
      });
      assert.equal(stale.response.status, 200);
      assert.equal(sha(stale.bytes), asset.sha256);
      phase = "invalid-range";
      const invalid = await request("GET", { Range: `bytes=${bytes.length}-` });
      assert.equal(invalid.response.status, 416);
      assert.equal(
        invalid.response.headers.get("Content-Range"),
        `bytes */${bytes.length}`,
      );
      assert.equal(
        (await request("GET", { Range: "items=0-31" })).response.status,
        400,
      );
      phase = "multipart";
      const multi = await request("GET", {
        Range: `bytes=0-3,${bytes.length - 4}-`,
      });
      assert.equal(multi.response.status, 206);
      assert.ok(multi.bytes.includes(bytes.subarray(0, 4)));
      assert.ok(multi.bytes.includes(bytes.subarray(-4)));
      const multipartLength = multi.response.headers.get("Content-Length");
      if (multipartLength !== null)
        assert.equal(Number(multipartLength), multi.bytes.length);
      observations.push({
        origin,
        contentType: full.response.headers.get("Content-Type"),
        transferEncoding: full.response.headers.get("Transfer-Encoding"),
        wholeFile: true,
        head: true,
        seek: true,
        conditional: true,
        invalidRange: true,
        multipart: true,
      });
    }
    assert.equal(observations[0].contentType, observations[1].contentType);
    results.push({
      assetSha256: asset.sha256,
      bytes: bytes.length,
      observations,
    });
  }
  assert.ok(results.length >= 2);
  await writeFile(
    output + "/receipt.json",
    JSON.stringify(
      {
        status: "PASS",
        sourceFingerprint: fingerprint,
        results,
        productionTouched: false,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({ status: "PASS", output, assets: results.length }),
  );
} catch (error) {
  await writeFile(
    output + "/failure.json",
    JSON.stringify({ phase, message: error.message, results }, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify({ status: "FAIL", phase, output }));
  process.exitCode = 1;
}
