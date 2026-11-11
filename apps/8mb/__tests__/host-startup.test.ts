import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
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
  } finally {
    clearTimeout(timeout);
    child.kill("SIGTERM");
    if (child.exitCode === null && child.signalCode === null)
      await new Promise((resolve) => child.once("exit", resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
