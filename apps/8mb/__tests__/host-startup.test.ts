import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createDiagnosticsStore } from "../app/diagnostics/store.ts";

test("host prunes expired diagnostics at startup without another consented request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "8mb-startup-"));
  const path = join(directory, "diagnostics.sqlite");
  const old = createDiagnosticsStore({
    path,
    revision: "old",
    now: () => new Date("2020-01-01T00:00:00Z"),
  });
  old.add({ schema: 1, stage: "export" });
  old.close();

  const child = spawn(
    process.execPath,
    ["--import", "remix/node-tsx", "server.ts"],
    {
      cwd: new URL("..", import.meta.url).pathname,
      env: {
        ...process.env,
        PORT: "0",
        DIAGNOSTICS_DB_FILE: path,
        APP_REVISION: "test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        child.stdout.on("data", (chunk) => {
          if (String(chunk).includes("8mb ready")) resolve();
        });
        child.on("exit", (code) =>
          reject(new Error(`8mb host exited ${code}`)),
        );
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("8mb host startup timed out")),
          10000,
        );
      }),
    ]);
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(
        db.prepare("SELECT count(*) count FROM diagnostics").get()?.count,
        0,
      );
    } finally {
      db.close();
    }
    assert.equal(existsSync(`${path}-wal`), true);
  } finally {
    clearTimeout(timeout);
    child.kill("SIGTERM");
    if (child.exitCode === null && child.signalCode === null)
      await new Promise((resolve) => child.once("exit", resolve));
    assert.equal(existsSync(`${path}-wal`), false);
    await rm(directory, { recursive: true, force: true });
  }
});

test("unavailable diagnostics storage leaves the editor usable and recovers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "8mb-unavailable-"));
  const parent = join(directory, "blocked");
  const path = join(parent, "diagnostics.sqlite");
  await writeFile(parent, "not a directory");
  const child = spawn(
    process.execPath,
    ["--import", "remix/node-tsx", "server.ts"],
    {
      cwd: new URL("..", import.meta.url).pathname,
      env: {
        ...process.env,
        PORT: "0",
        DIAGNOSTICS_DB_FILE: path,
        APP_ORIGIN: "https://jackharrhy.dev",
        APP_REVISION: "test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += String(chunk)));
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const port = await Promise.race([
      new Promise<number>((resolve, reject) => {
        child.stdout.on("data", (chunk) => {
          const match = String(chunk).match(/8mb ready (\d+)/);
          if (match) resolve(Number(match[1]));
        });
        child.on("exit", (code) =>
          reject(new Error(`8mb host exited ${code}`)),
        );
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("8mb host startup timed out")),
          10000,
        );
      }),
    ]);
    const base = `http://127.0.0.1:${port}`;
    const page = await fetch(`${base}/8mb/`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("Cache-Control"), "private, no-store");
    const policy = page.headers.get("Content-Security-Policy") ?? "";
    const nonce = /script-src[^;]*'nonce-([^']+)'/.exec(policy)?.[1];
    assert.ok(nonce);
    assert.match(policy, /worker-src 'self' blob:/);
    assert.match(policy, /'wasm-unsafe-eval'/);
    assert.match(await page.text(), new RegExp(`nonce="${nonce}"`));
    const send = () =>
      fetch(`${base}/8mb/api/diagnostics`, {
        method: "POST",
        headers: {
          Origin: "https://jackharrhy.dev",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          schema: 1,
          browser: "other",
          os: "other",
          input: "unknown",
          duration: "unknown",
          resolution: "unknown",
          container: "unknown",
          video: "unknown",
          audio: "unknown",
          stage: "inspect",
          outcome: "failed",
          reason: "unreadable-input",
          elapsed: "unknown",
        }),
      });
    const unavailable = await send();
    assert.equal(unavailable.status, 503);
    assert.equal(await unavailable.text(), "");
    await rm(parent);
    await mkdir(parent);
    assert.equal((await send()).status, 204);
    assert.equal((await fetch(`${base}/8mb/`)).status, 200);
  } finally {
    clearTimeout(timeout);
    child.kill("SIGTERM");
    if (child.exitCode === null && child.signalCode === null)
      await new Promise((resolve) => child.once("exit", resolve));
    await rm(directory, { recursive: true, force: true });
  }
  assert.match(stderr, /8mb diagnostics storage unavailable/);
  assert.equal(stderr.includes(path), false);
});
