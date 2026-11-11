import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createDiagnosticsStore } from "../app/diagnostics/store.ts";
import { createDiagnosticsRouter } from "../app/diagnostics/router.ts";

const event = {
  schema: 1,
  browser: "edge",
  os: "windows",
  input: "64g-plus",
  duration: "1-3h",
  resolution: "1080p",
  container: "mkv",
  video: "avc",
  audio: "aac",
  stage: "inspect",
  outcome: "failed",
  reason: "unreadable-input",
  elapsed: "1-5s",
};
const origin = "https://jackharrhy.dev";
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + "/8mb/api/diagnostics", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("early origin/type rejection cancels an unread streaming body", async () => {
  const endpoint = createDiagnosticsRouter({
    origin,
    openStore: () => {
      throw new Error("must not open");
    },
  });
  try {
    for (const [headers, status] of [
      [
        { Origin: "https://other.example", "Content-Type": "application/json" },
        403,
      ],
      [{ Origin: origin, "Content-Type": "text/plain" }, 415],
    ] as const) {
      let cancelled = false;
      const input = new Request(origin + "/8mb/api/diagnostics", {
        method: "POST",
        headers,
        body: new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        duplex: "half",
      } as RequestInit);
      assert.equal((await endpoint.router.fetch(input)).status, status);
      assert.equal(cancelled, true);
    }
  } finally {
    endpoint.close();
  }
});

test("real SQLite keeps daily aggregate counts, canonical keys and bounded retention", async () => {
  const directory = await mkdtemp(join(tmpdir(), "8mb-diagnostics-"));
  const path = join(directory, "diagnostics.sqlite");
  let day = new Date("2026-11-01T12:00:00Z");
  const store = createDiagnosticsStore({
    path,
    revision: "test-build",
    maxGroups: 2,
    now: () => day,
  });
  try {
    assert.equal(store.add(event), true);
    assert.equal(
      store.add(Object.fromEntries(Object.entries(event).toReversed())),
      true,
    );
    assert.equal(store.add({ ...event, browser: "chrome" }), true);
    assert.equal(store.add({ ...event, browser: "firefox" }), false);
    const observed = new DatabaseSync(path, { readOnly: true });
    assert.deepEqual(
      observed
        .prepare("SELECT count FROM diagnostics ORDER BY count")
        .all()
        .map((row) => row.count),
      [1, 2],
    );
    observed.close();
    day = new Date("2026-11-08T12:00:00Z");
    store.prune();
    assert.equal(store.add(event), true);
  } finally {
    store.close();
  }
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    const rows = db.prepare("SELECT * FROM diagnostics").all();
    db.close();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].day, "2026-11-08");
    assert.equal(rows[0].count, 1);
    assert.doesNotMatch(
      JSON.stringify(rows),
      /filename|session|address|stack|userAgent|browserMajor/i,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Remix ingestion rejects unknown/private payloads before opening storage", async () => {
  let opens = 0;
  const endpoint = createDiagnosticsRouter({
    origin,
    openStore: () => {
      opens++;
      return createDiagnosticsStore({ path: ":memory:", revision: "test" });
    },
  });
  try {
    assert.equal(
      (
        await endpoint.router.fetch(
          request({ ...event, filename: "C:\\private.mp4" }),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await endpoint.router.fetch(
          request(event, { Origin: "https://other.example" }),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await endpoint.router.fetch(
          request(event, { "Content-Type": "text/plain" }),
        )
      ).status,
      415,
    );
    assert.equal(
      (
        await endpoint.router.fetch(
          request({ ...event, reason: "private error path" }),
        )
      ).status,
      400,
    );
    assert.equal(
      (await endpoint.router.fetch(request({ ...event, browserMajor: 142 })))
        .status,
      400,
    );
    assert.equal(opens, 0);
    assert.equal((await endpoint.router.fetch(request(event))).status, 204);
    assert.equal(opens, 1);
    assert.equal(
      (await endpoint.router.fetch(origin + "/8mb/api/diagnostics")).status,
      405,
    );
  } finally {
    endpoint.close();
  }
});

test("streamed body limits, timeout and global rate bounds need no identifier", async () => {
  const endpoint = createDiagnosticsRouter({
    origin,
    maxPerMinute: 3,
    openStore: () =>
      createDiagnosticsStore({ path: ":memory:", revision: "test" }),
  });
  let cancelled = false;
  try {
    const oversized = new Request(origin + "/8mb/api/diagnostics", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(2049));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    assert.equal((await endpoint.router.fetch(oversized)).status, 413);
    const stalled = new Request(origin + "/8mb/api/diagnostics", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      duplex: "half",
    } as RequestInit);
    assert.equal((await endpoint.router.fetch(stalled)).status, 408);
    assert.equal(cancelled, true);
    assert.equal((await endpoint.router.fetch(request(event))).status, 204);
    assert.equal((await endpoint.router.fetch(request(event))).status, 429);
  } finally {
    endpoint.close();
  }
});

test("unavailable diagnostics storage returns generic failure and can recover", async () => {
  let available = false;
  const endpoint = createDiagnosticsRouter({
    origin,
    openStore: () => {
      if (!available)
        throw new Error("Private storage path must not appear in responses");
      return createDiagnosticsStore({ path: ":memory:", revision: "test" });
    },
  });
  try {
    const response = await endpoint.router.fetch(request(event));
    assert.equal(response.status, 503);
    assert.equal(await response.text(), "");
    available = true;
    assert.equal((await endpoint.router.fetch(request(event))).status, 204);
  } finally {
    endpoint.close();
  }
});
