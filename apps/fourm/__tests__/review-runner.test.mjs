import { test, expect } from "vitest";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("an occupied listener cannot produce a false running receipt or overwrite the current owner's receipt", async () => {
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const occupied = listener.address().port;
  const state = await mkdtemp(join(tmpdir(), "fourm-occupied-review-"));
  const receipt = JSON.stringify({ status: "RUNNING", supervisorPid: 12345 });
  await writeFile(join(state, "runtime.json"), receipt);
  try {
    const child = spawn(process.execPath, ["scripts/review.mjs"], {
      env: {
        ...process.env,
        CELLD_BIN: "/not-invoked",
        FOURM_REVIEW_STATE: state,
        FOURM_REVIEW_PORT: String(occupied),
        FOURM_REVIEW_ISSUER_PORT: String(occupied === 18998 ? 18997 : 18998),
        FOURM_REVIEW_PROVIDER_PORT: String(occupied === 18999 ? 18996 : 18999),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const code = await new Promise((resolve, reject) => {
      child.once("exit", resolve);
      child.once("error", reject);
    });
    expect(code).not.toBe(0);
    expect(output).toContain(`Review port ${occupied} is already occupied`);
    expect(output).not.toContain('"status":"RUNNING"');
    expect(await readFile(join(state, "runtime.json"), "utf8")).toBe(receipt);
  } finally {
    await new Promise((resolve) => listener.close(resolve));
    await rm(state, { recursive: true });
  }
});
