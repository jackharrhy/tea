import { describe, expect, it } from "vitest";
import { createCompilerApp } from "../src/app.js";

describe("compiler HTTP boundary", () => {
  it("allows the Tea Maps local editor by default", async () => {
    const app = createCompilerApp({});
    const response = await app.fetch(
      new Request("http://local.test/capabilities", {
        headers: { origin: "http://localhost:8790" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:8790",
    );
    const originalEditor = await app.fetch(
      new Request("http://local.test/capabilities", {
        headers: { origin: "http://localhost:5174" },
      }),
    );
    expect(originalEditor.status).toBe(403);
  });

  it("does not inherit the original compiler or game launch settings", async () => {
    const app = createCompilerApp({
      MAPS_GAME_PROFILE: "quake2",
      MAPS_Q2TOOL: "/original/q2tool",
      MAPS_LAUNCH_EXECUTABLE: "/original/quake",
      MAPS_LAUNCH_WORKING_DIRECTORY: "/original",
      MAPS_LAUNCH_MAP_DIRECTORY: "/original/maps",
    });
    expect(app.configured()).toBe(false);
    const response = await app.fetch(
      new Request("http://local.test/capabilities"),
    );
    expect(await response.json()).toMatchObject({
      compileProfiles: [],
      launchProfiles: [],
    });
  });

  it("reports tool availability and keeps unconfigured compiles closed", async () => {
    const app = createCompilerApp({});
    const health = await app.fetch(new Request("http://local.test/health"));
    expect(health.status).toBe(503);
    expect(await health.json()).toEqual({
      status: "unconfigured",
      activeCompiles: 0,
    });

    const compile = await app.fetch(
      new Request("http://local.test/compile", { method: "POST" }),
    );
    expect(compile.status).toBe(503);
  });

  it("bounds request bodies and applies the configured origin policy", async () => {
    const app = createCompilerApp({
      ERICW_QBSP: "/tools/qbsp",
      ERICW_VIS: "/tools/vis",
      ERICW_LIGHT: "/tools/light",
      TEA_MAPS_COMPILER_MAX_REQUEST_BYTES: "8",
      TEA_MAPS_COMPILER_ORIGINS: "https://editor.example",
    });
    const denied = await app.fetch(
      new Request("http://local.test/health", {
        headers: { origin: "https://other.example" },
      }),
    );
    expect(denied.status).toBe(403);

    const oversized = await app.fetch(
      new Request("http://local.test/compile", {
        method: "POST",
        headers: {
          origin: "https://editor.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ source: "too much data" }),
      }),
    );
    expect(oversized.status).toBe(400);
    expect(await oversized.json()).toEqual({
      error: "Request body is too large",
    });
    expect(oversized.headers.get("access-control-allow-origin")).toBe(
      "https://editor.example",
    );
  });
});
