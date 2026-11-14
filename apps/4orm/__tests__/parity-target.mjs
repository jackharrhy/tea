import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { reviewSourceFingerprint } from "../scripts/review-source.mjs";
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}
function hash(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export function privateEqual(actual, expected, message) {
  assert.equal(hash(actual), hash(expected), message);
}
export async function parityTarget() {
  const root = "/home/jack/.local/state/form-harrhy-integration/candidate";
  const state = resolve(
    process.env.FOURM_PARITY_NATIVE_STATE ?? "apps/4orm/.review/parity-local",
  );
  const database = resolve(
    process.env.FOURM_PARITY_COHORT_DATABASE ??
      join(root, "parity-cohort-20261112/review.sqlite3"),
  );
  const oracle =
    process.env.FOURM_PARITY_ORACLE_ORIGIN ?? "http://127.0.0.1:18964";
  const native =
    process.env.FOURM_PARITY_NATIVE_ORIGIN ?? "http://127.0.0.1:18974";
  for (const origin of [oracle, native]) {
    const url = new URL(origin);
    assert.ok(
      url.origin === origin &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
        url.protocol === "http:",
      "Parity browser targets must be exact loopback origins",
    );
  }
  assert.ok(
    !relative(root, database).startsWith(".."),
    "Cohort database must be private review input",
  );
  assert.ok(
    !relative(resolve("apps/4orm/.review"), state).startsWith(".."),
    "Native runtime must be owned review state",
  );
  const runtime = JSON.parse(
    await readFile(join(state, "runtime.json"), "utf8"),
  );
  assert.equal(
    runtime.origin,
    native,
    "Runtime origin does not match selected target",
  );
  assert.equal(runtime.productionTouched, false);
  assert.equal(
    runtime.sourceFingerprint,
    await reviewSourceFingerprint(resolve("apps/4orm")),
  );
  const response = await fetch(native + "/ready", {
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200, "Selected native runtime is not ready");
  const readiness = await response.json();
  assert.equal(
    readiness.sourceFingerprint,
    runtime.sourceFingerprint,
    "Live runtime differs from recorded source fingerprint",
  );

  return { root, state, database, oracle, native };
}
