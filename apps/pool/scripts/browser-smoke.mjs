import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const externalUrl = process.env.POOL_E2E_URL;
const directory = externalUrl
  ? null
  : await mkdtemp(join(tmpdir(), "tea-pool-browser-"));
let server;
try {
  const url = externalUrl ?? `http://127.0.0.1:${await freePort()}`;
  if (directory) {
    const port = new URL(url).port;
    server = spawn("bun", ["dist/server/index.js"], {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATA_DIR: directory,
        WEB_ROOT: new URL("../dist/client", import.meta.url).pathname,
        API_PORT: port,
        UPDATE_CONTROL_PORT: String(await freePort()),
        PUBLIC_ORIGIN: url,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    for (const stream of [server.stdout, server.stderr])
      stream.on("data", (chunk) => {
        output += chunk.toString();
      });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) break;
      try {
        ready = (await fetch(`${url}/api/health`)).ok;
        if (ready) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error(`Pool server failed to start: ${output}`);
  }
  const test = spawn(
    "bun",
    [new URL("../__tests__/browser/production.ts", import.meta.url).pathname],
    {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, POOL_E2E_URL: url },
      stdio: "inherit",
    },
  );
  const code = await new Promise((resolve) => test.on("exit", resolve));
  if (code !== 0) process.exitCode = code ?? 1;
} finally {
  if (server) {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGTERM");
      await new Promise((resolve) => server.once("exit", resolve));
    }
  }
  if (directory) await rm(directory, { recursive: true, force: true });
}
