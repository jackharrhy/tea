import test from "node:test";
import assert from "node:assert/strict";
import { readRequestBody } from "../read.ts";

test("reads exactly the allowed number of bytes", async () => {
  const request = new Request("https://example.test", {
    method: "POST",
    body: "hello",
  });
  const result = await readRequestBody(request, { maxBytes: 5 });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(new TextDecoder().decode(result.bytes), "hello");
});

test("rejects both declared and streamed oversize bodies", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  const declaredOptions = {
    method: "POST",
    headers: { "content-length": "9" },
    body,
    duplex: "half" as const,
  };
  const declared = new Request("https://example.test", declaredOptions);
  assert.deepEqual(await readRequestBody(declared, { maxBytes: 5 }), {
    ok: false,
    error: "too_large",
  });
  assert.equal(cancelled, true);

  const streamed = new Request("https://example.test", {
    method: "POST",
    body: "sixsix",
  });
  assert.deepEqual(await readRequestBody(streamed, { maxBytes: 5 }), {
    ok: false,
    error: "too_large",
  });
});

test("distinguishes missing and stalled bodies", async () => {
  assert.deepEqual(
    await readRequestBody(new Request("https://example.test"), { maxBytes: 5 }),
    { ok: false, error: "missing" },
  );

  const body = new ReadableStream<Uint8Array>({});
  const options = { method: "POST", body, duplex: "half" as const };
  const request = new Request("https://example.test", options);
  assert.deepEqual(
    await readRequestBody(request, { maxBytes: 5, timeoutMs: 10 }),
    { ok: false, error: "unreadable" },
  );
});
