import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { staticFiles } from "../../server/static-files";

test("built assets have distinct cache policies and HEAD matches GET", async () => {
  const dir = mkdtempSync(join(tmpdir(), "8ball-static-"));
  try {
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets/game.js"), "export const pool=true;");
    writeFileSync(join(dir, "assets/game.css"), "body{color:green}");
    writeFileSync(
      join(dir, "assets/main-abc123.js"),
      "export const pool=true;",
    );
    const serve = staticFiles(dir);
    const get = (path: string, method = "GET") =>
      serve(new Request(`http://localhost${path}`, { method }), path);
    expect(get("/")).toBeNull();
    const entry = get("/assets/game.js")!;
    expect(entry.headers.get("Cache-Control")).toBe("public, max-age=3600");
    const asset = get("/assets/main-abc123.js")!;
    expect(asset.headers.get("Cache-Control")).toContain("immutable");
    expect(asset.headers.get("Content-Type")).toContain("javascript");
    const head = get("/assets/main-abc123.js", "HEAD")!;
    expect([...head.headers]).toEqual([...asset.headers]);
    expect(await head.text()).toBe("");
    expect(get("/assets/game.js", "POST")?.status).toBe(405);
    for (const path of [
      "/missing.js",
      "/src/client.ts",
      "/data/8ball.sqlite",
      "/%2e%2e%2findex.html",
      "/%00",
      "/.env",
    ])
      expect(get(path)).toBeNull();
    expect(get("/%XX")?.status).toBe(400);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("production cannot start without the built frontend", () => {
  const dir = mkdtempSync(join(tmpdir(), "8ball-missing-build-"));
  try {
    expect(() => staticFiles(dir)).toThrow("Built frontend missing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
