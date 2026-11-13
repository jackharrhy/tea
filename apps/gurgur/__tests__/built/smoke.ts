import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "gurgur-built-"));
const reservation = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: () => new Response(),
});
const port = reservation.port!;
reservation.stop(true);

const server = Bun.spawn([process.execPath, "dist/server/src/index.js"], {
  cwd: new URL("../..", import.meta.url).pathname,
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    DATABASE_PATH: join(directory, "world.sqlite"),
    PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
  },
  stdout: "ignore",
  stderr: "inherit",
});

try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      ready = (await fetch(`http://127.0.0.1:${port}/readyz`)).ok;
      if (ready) break;
    } catch {
      await Bun.sleep(50);
    }
  }
  assert(ready, "the built Gurgur server did not become ready");
  const page = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("Cache-Control"), "private, no-store");
  const policy = page.headers.get("Content-Security-Policy") ?? "";
  const nonce = /script-src[^;]*'nonce-([^']+)'/.exec(policy)?.[1];
  assert.ok(nonce);
  assert.match(policy, /connect-src 'self' ws:\/\//);
  assert((await page.text()).includes(`nonce="${nonce}"`));
  const reset = await fetch(`http://127.0.0.1:${port}/admin/reset`, {
    method: "POST",
  });
  assert.equal(
    reset.status,
    404,
    "production must not expose the test reset route",
  );
  server.kill("SIGTERM");
  const exitCode = await Promise.race([
    server.exited,
    Bun.sleep(3_000).then(() => -1),
  ]);
  assert.equal(exitCode, 0, "the built Gurgur server did not stop cleanly");
  assert(await Bun.file(join(directory, "world.sqlite")).exists());
  console.log("built Gurgur server: ready and clean shutdown");
} finally {
  server.kill("SIGKILL");
  await server.exited;
  await rm(directory, { recursive: true, force: true });
}
