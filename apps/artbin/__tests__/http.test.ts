import { identityEnvironment } from "./identity-fixture.ts";
/**
 * HTTP integration tests
 *
 * Spins up the native Remix Node server and makes real HTTP requests
 * to verify static file serving, auth redirects, and protected routes.
 *
 * This verifies the same source-served runtime used in production.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { dirname, join, relative, resolve, sep } from "path";
import { createRequire } from "node:module";

const PORT = 4389;
const BASE = `http://localhost:${PORT}`;
let server: ChildProcess;

// Test fixture directory -- created in beforeAll, cleaned up in afterAll
const FIXTURE_DIR = join(process.cwd(), "public", "uploads", "_test");

async function waitForServer(url: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`Server did not start within ${timeoutMs}ms`);
}

describe("HTTP integration tests", () => {
  beforeAll(async () => {
    // Create test fixture files for static serving tests
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(join(FIXTURE_DIR, "sample.txt"), "test-asset-content\n");
    writeFileSync(
      join(FIXTURE_DIR, "_underscored.txt"),
      "_test-file-content\n",
    );
    writeFileSync(join(FIXTURE_DIR, ".dotfile.txt"), ".test-dot-content\n");

    server = spawn(
      process.execPath,
      [
        "--import",
        "remix/node-tsx",
        "--import",
        "./__tests__/http-identity.ts",
        "server.ts",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...identityEnvironment,
          PORT: String(PORT),
          NODE_ENV: "production",
          ARTBIN_DB_PATH: ":memory:",
          // This is a real server process: run its migrations instead of inheriting
          // Vitest's in-process database override mode.
          VITEST: "",
        },
        stdio: "pipe",
      },
    );

    server.stderr?.on("data", (data: Buffer) => {
      const msg = data.toString();
      if (msg.includes("Error") || msg.includes("error")) {
        console.error("[server stderr]", msg);
      }
    });

    await waitForServer(BASE);
  }, 15_000);

  afterAll(() => {
    server?.kill("SIGTERM");
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  describe("static file serving", () => {
    test("does not expose database-backed uploads as static files", async () => {
      const res = await fetch(`${BASE}/uploads/_test/sample.txt`);
      expect(res.status).toBe(404);
    });
  });

  describe("auth redirects", () => {
    test("/folders redirects to /login when not authenticated", async () => {
      const res = await fetch(`${BASE}/folders`, { redirect: "manual" });
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/login");
    });

    test("/settings redirects to /login when not authenticated", async () => {
      const res = await fetch(`${BASE}/settings`, { redirect: "manual" });
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/login?returnTo=%2Fsettings");
    });

    test("/admin redirects to /login when not authenticated", async () => {
      const res = await fetch(`${BASE}/admin`, { redirect: "manual" });
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/login");
    });

    test("/admin/users redirects to /login when not authenticated", async () => {
      const res = await fetch(`${BASE}/admin/users`, { redirect: "manual" });
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/login");
    });
  });

  describe("oauth flow", () => {
    test("/auth/login redirects to the central authorize URL", async () => {
      const res = await fetch(`${BASE}/auth/login`, { redirect: "manual" });
      expect(res.status).toBe(302);
      const location = res.headers.get("location") ?? "";
      expect(location).toContain("/oauth/v2/authorize");
      expect(location).toContain("response_type=code");
      expect(location).toContain("code_challenge_method=S256");
      const cookies = res.headers.get("set-cookie") ?? "";
      expect(cookies).toContain("artbin_oauth=");
    });

    test("/auth/callback without code redirects to /login with error", async () => {
      const res = await fetch(`${BASE}/auth/callback`, {
        redirect: "manual",
      });
      expect(res.status).toBe(302);
      const location = res.headers.get("location") ?? "";
      expect(location).toContain("/login");
      expect(location).toContain("error=");
    });
  });

  describe("public pages", () => {
    test("/login returns 200 and shows central login button", async () => {
      const res = await fetch(`${BASE}/login`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Sign in with Jack Auth");
    });

    test("/ returns 200", async () => {
      const res = await fetch(`${BASE}/`);
      expect(res.status).toBe(200);
    });

    test("serves the browser entry, Remix styles, and package dependency", async () => {
      const pageRes = await fetch(`${BASE}/login`);
      const page = await pageRes.text();
      const entryPath = page.match(/<script type="module" src="([^"]+)"/)?.[1];

      expect(entryPath).toBeTruthy();
      expect(page).toContain("<style data-rmx");
      expect(page).not.toContain('rel="stylesheet"');
      expect(page).toContain("@layer rmx");
      expect(page).toContain("max-width: 360px");

      const entryRes = await fetch(new URL(entryPath!, BASE));
      expect(entryRes.status).toBe(200);

      const entry = await entryRes.text();
      const packagePath = entry.match(/"(\/assets\/npm\/[^"]+)"/)?.[1];

      expect(packagePath).toBeTruthy();

      const packageRes = await fetch(new URL(packagePath!, BASE));
      expect(packageRes.status).toBe(200);
      expect(packageRes.headers.get("content-type")).toContain("javascript");
    });

    test("replaces Node environment references in browser dependencies", async () => {
      const mapsRequire = createRequire(
        import.meta.resolve("@jackharrhy/tea-maps-renderer"),
      );
      const envPath = join(
        dirname(mapsRequire.resolve("typegpu")),
        "shared/env.js",
      );
      const assetPath = relative(resolve(process.cwd(), "../.."), envPath)
        .replace(/^node_modules\//, "npm/")
        .split(sep)
        .map(encodeURIComponent)
        .join("/");
      const typeGpuEnv = await fetch(`${BASE}/assets/${assetPath}`);

      expect(typeGpuEnv.status).toBe(200);
      const source = await typeGpuEnv.text();
      expect(source).not.toContain("process.env");
      expect(source).toMatch(/DEV\s*=\s*(?:false|!1)/);
      expect(source).toMatch(/TEST\s*=\s*(?:false|!1)/);
    });
  });

  describe("API routes", () => {
    test("/api/cli/whoami preserves the unauthenticated response", async () => {
      const res = await fetch(`${BASE}/api/cli/whoami`, { redirect: "manual" });

      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual({ error: "Not authenticated" });
    });

    test("/api/uploads returns 401 when not authenticated", async () => {
      const res = await fetch(`${BASE}/api/uploads`, {
        method: "POST",
        redirect: "manual",
      });
      expect(res.status).toBe(401);
    });

    test("/api/folder returns 401 when not authenticated", async () => {
      const res = await fetch(`${BASE}/api/folder`, {
        method: "POST",
        redirect: "manual",
      });
      expect(res.status).toBe(401);
    });
  });

  describe("session cookies", () => {
    test("oauth cookie includes Secure flag in production", async () => {
      const res = await fetch(`${BASE}/auth/login`, { redirect: "manual" });
      const cookies = res.headers.get("set-cookie") ?? "";
      expect(cookies).toContain("Secure");
    });
  });
});
