import test from "node:test";
import assert from "node:assert/strict";
import { createRouter } from "remix/router";
import { limitConcurrency } from "../transport.ts";

test("concurrency middleware releases slots after requests finish", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = 0;
  let allStarted!: () => void;
  const ready = new Promise<void>((resolve) => {
    allStarted = resolve;
  });
  const router = createRouter({ middleware: [limitConcurrency(2)] });
  router.get("/", async () => {
    started++;
    if (started === 2) allStarted();
    await held;
    return new Response("ok");
  });

  const first = router.fetch("http://shell.example/");
  const second = router.fetch("http://shell.example/");
  await ready;
  assert.equal((await router.fetch("http://shell.example/")).status, 429);

  release();
  assert.deepEqual(
    (await Promise.all([first, second])).map((response) => response.status),
    [200, 200],
  );
  assert.equal((await router.fetch("http://shell.example/")).status, 200);
});
