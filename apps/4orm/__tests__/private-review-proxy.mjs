import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const directory = await mkdtemp(join(tmpdir(), "4orm-proxy-test-"));
const upstream = createServer((req, res) => {
  res.writeHead(req.url.startsWith("/static/") ? 200 : 401, {
    "Content-Type": "text/plain",
    ETag: '"bundled-asset"',
    "Cache-Control": "public, max-age=0, must-revalidate",
  });
  res.end("App authorization still required");
});
upstream.listen(0, "127.0.0.1");
await once(upstream, "listening");
try {
  const keyFile = join(directory, "key");
  await writeFile(keyFile, "a".repeat(64), { mode: 0o600 });
  for (const accessMode of [undefined, "tailnet"]) {
    const probe = createServer();
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    const config = join(directory, "config.json");
    await writeFile(
      config,
      JSON.stringify({
        keyFile,
        accessMode,
        routes: [
          {
            port,
            origin,
            upstream: `http://127.0.0.1:${upstream.address().port}`,
          },
        ],
      }),
    );
    const child = spawn(
      process.execPath,
      [
        new URL("../scripts/private-review-proxy.mjs", import.meta.url)
          .pathname,
        config,
      ],
      { stdio: "ignore" },
    );
    try {
      let response;
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          response = await fetch(origin);
          break;
        } catch {
          await delay(20);
        }
      }
      assert.ok(response, "proxy starts");
      assert.equal(response.status, 401);
      assert.equal(
        (await response.text()).includes("App authorization still required"),
        accessMode === "tailnet",
      );
      const rejected = await fetch(origin + "/_review/access", {
        method: "POST",
        headers: { Origin: "https://wrong.invalid" },
        body: "key=bad",
      });
      assert.equal(rejected.status, 403);
      const sameOrigin = await fetch(origin + "/_review/access", {
        method: "POST",
        headers: { Origin: origin },
        body: "key=bad",
      });
      assert.equal(sameOrigin.status, accessMode === "tailnet" ? 404 : 401);
      assert.equal(sameOrigin.headers.get("set-cookie"), null);
      const asset = await fetch(origin + "/static/style.css");
      assert.equal(
        asset.headers.get("cache-control"),
        accessMode === "tailnet"
          ? "private, max-age=0, must-revalidate"
          : "no-store",
      );
      if (accessMode === "tailnet")
        assert.equal(asset.headers.get("etag"), '"bundled-asset"');
      assert.equal(response.headers.get("cache-control"), "no-store");
    } finally {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
  }
  console.log(
    "Default key gate, explicit Tailnet mode, app auth and Origin checks passed",
  );
} finally {
  await new Promise((resolve) => upstream.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
