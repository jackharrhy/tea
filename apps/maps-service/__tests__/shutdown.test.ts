import { createServer } from "node:http";
import { afterEach, expect, test, vi } from "vitest";
import type { BlobStore } from "../src/blob-store.js";
import { RemoteBuildQueue } from "../src/build-queue.js";
import type { MapsDatabase } from "../src/database.js";
import { stopMapsService } from "../src/server.js";

const servers: ReturnType<typeof createServer>[] = [];
const build = (id: string) => ({
  id,
  game: "quake" as const,
  mapName: "test.map",
  source: "test",
  mapVersion: 1,
  sourceSha256: "0".repeat(64),
  profileId: "quake",
  quality: "preview" as const,
  assets: [],
});
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

test("idle shutdown closes the listener before the database", async () => {
  const close = vi.fn();
  const server = createServer((_request, response) => response.end("ok"));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));

  await stopMapsService(server, {
    database: { close } as unknown as MapsDatabase,
  });

  expect(server.listening).toBe(false);
  expect(close).toHaveBeenCalledOnce();
  servers.pop();
});

test("shutdown waits for an in-flight response before closing SQLite", async () => {
  let finish!: () => void;
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => (started = resolve));
  const close = vi.fn();
  const server = createServer((_request, response) => {
    started();
    finish = () => response.end("done");
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  const response = fetch(`http://127.0.0.1:${address.port}/`);
  await requestStarted;

  const shutdown = stopMapsService(server, {
    database: { close } as unknown as MapsDatabase,
  });
  expect(close).not.toHaveBeenCalled();
  finish();
  expect((await response).status).toBe(200);
  await shutdown;
  expect(close).toHaveBeenCalledOnce();
  servers.pop();
});

test("shutdown aborts active compilation and fails queued builds", async () => {
  const updateBuild = vi.fn();
  const database = { updateBuild } as unknown as MapsDatabase;
  const blobs = {} as BlobStore;
  let started!: () => void;
  const running = new Promise<void>((resolve) => (started = resolve));
  const compilerFetch = vi.fn(async (_url: URL, options: RequestInit) => {
    started();
    return new Promise<Response>((_resolve, reject) => {
      options.signal?.addEventListener("abort", () =>
        reject(options.signal?.reason),
      );
    });
  }) as unknown as typeof fetch;
  const queue = new RemoteBuildQueue(
    database,
    blobs,
    { quake: "http://compiler.internal" },
    compilerFetch,
  );
  expect(queue.enqueue(build("active"))).toBe(true);
  await running;
  expect(queue.enqueue(build("queued"))).toBe(true);
  await queue.shutdown();

  expect(queue.enqueue(build("late"))).toBe(false);
  expect(compilerFetch).toHaveBeenCalledOnce();
  expect(updateBuild).toHaveBeenCalledWith(
    "queued",
    "failed",
    expect.objectContaining({ error: expect.any(String) }),
    "0".repeat(64),
  );
  expect(updateBuild).toHaveBeenCalledWith(
    "active",
    "failed",
    expect.objectContaining({ error: expect.any(String) }),
    "0".repeat(64),
  );
});

test("the default compiler fetch works with its Undici dispatcher", async () => {
  let received = 0;
  const compiler = createServer((_request, response) => {
    received += 1;
    response.writeHead(503, { "Content-Type": "application/json" });
    response.end("{}");
  });
  servers.push(compiler);
  await new Promise<void>((resolve) =>
    compiler.listen(0, "127.0.0.1", resolve),
  );
  const address = compiler.address();
  if (!address || typeof address === "string") throw new Error("No port");

  let finish!: () => void;
  const finished = new Promise<void>((resolve) => (finish = resolve));
  const updateBuild = vi.fn((_id: string, status: string) => {
    if (status === "failed") finish();
  });
  const queue = new RemoteBuildQueue(
    { updateBuild } as unknown as MapsDatabase,
    {} as BlobStore,
    { quake: `http://127.0.0.1:${address.port}` },
  );

  expect(queue.enqueue(build("network"))).toBe(true);
  await finished;
  await queue.shutdown();

  expect(received).toBe(1);
  expect(updateBuild).toHaveBeenCalledWith(
    "network",
    "failed",
    { error: "Build worker failed (503)" },
    "0".repeat(64),
  );
});
