import assert from "node:assert/strict";
import { test } from "node:test";
import { createHandler } from "../src/index.ts";

const mcp = createHandler({
  name: "test",
  version: "1.0.0",
  maxRequestBytes: 8,
});

test("rejects a declared oversized JSON body before parsing it", async () => {
  const request = new Request("https://example.test/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "9" },
    body: "{}",
  });
  const response = await mcp.fetch(request);
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "body_too_large" });
});

test("rejects an oversized stream without Content-Length", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("12345678"));
      controller.enqueue(new TextEncoder().encode("9"));
      controller.close();
    },
  });
  const options = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    duplex: "half" as const,
  };
  const request = new Request("https://example.test/mcp", options);
  const response = await mcp.fetch(request);
  assert.equal(response.status, 413);
});
