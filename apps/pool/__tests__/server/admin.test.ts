import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createAdmin } from "../../server/admin";
import type { AuthSession } from "../../server/auth";
import type { AdminMetrics, RoomSettings } from "@tea/pool-protocol";

const origin = "https://hall.example";
const owner: AuthSession = {
  subject: "verified-owner",
  issuer: "https://auth.example",
  name: "Owner",
  owner: true,
  csrf: "session-csrf",
  expiresAt: Date.now() + 60_000,
};
const routes = [
  ["state", "GET"],
  ["metrics", "GET"],
  ["settings", "PATCH"],
  ["rename", "POST"],
  ["unknown", "GET"],
];
let oldOrigin: string | undefined;
beforeEach(() => {
  oldOrigin = process.env.PUBLIC_ORIGIN;
  process.env.PUBLIC_ORIGIN = origin;
});
afterEach(() => {
  if (oldOrigin === undefined) delete process.env.PUBLIC_ORIGIN;
  else process.env.PUBLIC_ORIGIN = oldOrigin;
});

function fixture(session: AuthSession | null = owner) {
  let settings: RoomSettings = {
    lightIntensity: 1,
    gravity: [0, -9.81, 0],
    cutaway: false,
  };
  const state = {
    auditResults: [] as boolean[],
    order: [] as string[],
    busy: false,
    updates: 0,
    renames: [] as string[],
    audits: [] as unknown[][],
    checks: 0,
    session,
  };
  const metrics: AdminMetrics = {
    summary: {
      games: 2,
      shots: 8,
      flaggedShots: 1,
      clientReports: 3,
      correctionCount: 5,
      maxCorrection: 0.2,
      recordedBytes: 200,
    },
    series: [],
    recent: [],
    errors: [],
    activity: [],
    histogram: [1, 2, 2, 0],
    window: { shots: 200, reports: 2000 },
  };
  const hall = {
    getRoomSettings: () => structuredClone(settings),
    setRoomSettings(next: RoomSettings) {
      state.order.push("settings");
      if (state.busy && next.gravity.some((n, i) => n !== settings.gravity[i]))
        return false;
      settings = structuredClone(next);
      state.updates++;
      return true;
    },
    adminPlayers: () => [
      {
        id: "player",
        name: "Guest",
        connected: true,
        bot: undefined,
        token: "never-expose-this",
      },
    ],
    renamePlayer(id: string, name: string) {
      state.order.push("rename");
      if (id !== "player") return false;
      state.renames.push(name);
      return true;
    },
  };
  const recorder = {
    metrics: () => metrics,
    audit: (...args: [string, string, Record<string, unknown>]) => {
      state.audits.push(args);
      state.order.push(String(args[2].phase));
      return state.auditResults.shift() ?? true;
    },
  };
  const auth = {
    session: async () => {
      state.checks++;
      return state.session;
    },
  };
  return {
    state,
    hall,
    recorder,
    auth,
    admin: createAdmin(hall, recorder, auth),
    metrics,
  };
}
function request(
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(`${origin}/api/admin/${path}`, {
    method,
    headers: {
      Origin: origin,
      "X-CSRF-Token": owner.csrf,
      "Content-Type": "application/json",
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("owner administration", () => {
  test("guests and regular accounts cannot access any admin route, even with forged role claims", async () => {
    for (const session of [null, { ...owner, owner: false }]) {
      const f = fixture(session);
      for (const [path, method] of routes) {
        const req = request(
          path,
          method,
          method === "GET"
            ? undefined
            : { owner: true, role: "owner", lightIntensity: 2 },
          { "X-Owner": "true", Authorization: "Bearer forged-owner-role" },
        );
        expect((await f.admin.handle(req))?.status).toBe(403);
      }
      expect(f.state.checks).toBe(routes.length);
      expect(f.state.updates).toBe(0);
      expect(f.state.audits).toEqual([]);
    }
  });
  test("verifies the session again after owner access is revoked", async () => {
    const f = fixture();
    expect((await f.admin.handle(request("state")))?.status).toBe(200);
    f.state.session = null;
    expect((await f.admin.handle(request("metrics")))?.status).toBe(403);
    expect(f.state.checks).toBe(2);
  });
  test("requires both configured Origin and matching session CSRF for every mutation", async () => {
    const f = fixture();
    const invalidHeaders: Record<string, string>[] = [
      { Origin: "https://evil.example" },
      { Origin: "null" },
      { Origin: "" },
      { "X-CSRF-Token": "forged" },
      { "X-CSRF-Token": "" },
    ];
    for (const headers of invalidHeaders) {
      expect(
        (
          await f.admin.handle(
            request("settings", "PATCH", { cutaway: true }, headers),
          )
        )?.status,
      ).toBe(403);
      expect(
        (
          await f.admin.handle(
            request("rename", "POST", { id: "player", name: "New" }, headers),
          )
        )?.status,
      ).toBe(403);
    }
    delete process.env.PUBLIC_ORIGIN;
    expect(
      (await f.admin.handle(request("settings", "PATCH", { cutaway: true })))
        ?.status,
    ).toBe(403);
    expect(f.state.updates).toBe(0);
    expect(f.state.renames).toEqual([]);
  });
  test("state excludes credentials and metrics come only from recorder", async () => {
    const f = fixture();
    const response = (await f.admin.handle(request("state")))!;
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      settings: f.hall.getRoomSettings(),
      players: [{ id: "player", name: "Guest", connected: true, bot: false }],
    });
    expect(await (await f.admin.handle(request("metrics")))!.json()).toEqual(
      f.metrics,
    );
    expect(
      await f.admin.handle(new Request(`${origin}/api/health`)),
    ).toBeNull();
  });
  test("metrics storage failures return 503 without leaking details or mutating the hall", async () => {
    const f = fixture();
    f.recorder.metrics = () => {
      throw new Error("SQLite unavailable: private database path");
    };
    const response = (await f.admin.handle(request("metrics")))!;
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "Recording metrics are unavailable.",
    });
    expect(f.state.updates).toBe(0);
    expect(f.state.renames).toEqual([]);
    expect(f.state.audits).toEqual([]);
    expect((await f.admin.handle(request("state")))?.status).toBe(200);
  });
  test("rejects malformed, unknown and out-of-bounds settings", async () => {
    const f = fixture();
    for (const body of [
      null,
      [],
      {},
      { owner: true },
      { gravity: [0, 0] },
      { gravity: [0, 0, 0, 0] },
      { gravity: [0, "0", 0] },
      { gravity: [16, 0, 0] },
      { gravity: [-15.01, 0, 0] },
      { gravity: [0, null, 0] },
      { lightIntensity: -0.01 },
      { lightIntensity: 3.01 },
      { lightIntensity: "2" },
      { cutaway: 1 },
      { cutaway: true, force: true },
    ]) {
      expect(
        (await f.admin.handle(request("settings", "PATCH", body)))?.status,
      ).toBe(400);
    }
    const nonfinite = new Request(`${origin}/api/admin/settings`, {
      method: "PATCH",
      headers: {
        Origin: origin,
        "X-CSRF-Token": owner.csrf,
        "Content-Type": "application/json",
      },
      body: '{"lightIntensity":1e999}',
    });
    expect((await f.admin.handle(nonfinite))?.status).toBe(400);
    const oversized = request("settings", "PATCH", {
      unknown: "x".repeat(5000),
    });
    expect((await f.admin.handle(oversized))?.status).toBe(400);
    expect(
      (
        await f.admin.handle(
          request(
            "settings",
            "PATCH",
            { cutaway: true },
            { "Content-Type": "text/plain" },
          ),
        )
      )?.status,
    ).toBe(400);
    expect(f.state.updates).toBe(0);
    expect(f.state.audits).toEqual([]);
  });
  test("applies bounded settings and audits the verified subject without credentials", async () => {
    const f = fixture();
    const patch: RoomSettings = {
      lightIntensity: 3,
      gravity: [-15, 15, 0],
      cutaway: true,
    };
    expect(
      (await f.admin.handle(request("settings", "PATCH", patch)))?.status,
    ).toBe(200);
    expect(f.hall.getRoomSettings()).toEqual(patch);
    expect(f.state.audits).toEqual([
      [owner.subject, "room-settings", { ...patch, phase: "attempt" }],
      [
        owner.subject,
        "room-settings",
        { ...patch, phase: "outcome", applied: true, status: 200 },
      ],
    ]);
    expect(f.state.order).toEqual(["attempt", "settings", "outcome"]);
    expect(
      (
        await f.admin.handle(
          request("settings", "PATCH", { lightIntensity: 0 }),
        )
      )?.status,
    ).toBe(200);
    expect(f.hall.getRoomSettings().gravity).toEqual([-15, 15, 0]);
  });
  test("gravity guard returns 409 atomically, permits cosmetic changes and cannot be forced", async () => {
    const f = fixture();
    f.state.busy = true;
    expect(
      (
        await f.admin.handle(
          request("settings", "PATCH", {
            gravity: [1, -9.81, 0],
            cutaway: true,
          }),
        )
      )?.status,
    ).toBe(409);
    expect(f.hall.getRoomSettings().cutaway).toBe(false);
    expect(f.state.audits).toEqual([
      [
        owner.subject,
        "room-settings",
        { gravity: [1, -9.81, 0], cutaway: true, phase: "attempt" },
      ],
      [
        owner.subject,
        "room-settings",
        {
          gravity: [1, -9.81, 0],
          cutaway: true,
          phase: "outcome",
          applied: false,
          status: 409,
        },
      ],
    ]);
    expect(
      (
        await f.admin.handle(
          request("settings", "PATCH", { gravity: [1, -9.81, 0], force: true }),
        )
      )?.status,
    ).toBe(400);
    expect(
      (
        await f.admin.handle(
          request("settings", "PATCH", {
            lightIntensity: 2,
            cutaway: true,
            gravity: [0, -9.81, 0],
          }),
        )
      )?.status,
    ).toBe(200);
    f.state.busy = false;
    expect(
      (
        await f.admin.handle(
          request("settings", "PATCH", { gravity: [1, -9.81, 0] }),
        )
      )?.status,
    ).toBe(200);
  });
  test("validates rename names and IDs, handles missing players, and audits success", async () => {
    const f = fixture();
    for (const name of [
      "",
      "  ",
      "x".repeat(25),
      "<owner>",
      "bad\nname",
      "bad\u007fname",
      42,
    ])
      expect(
        (
          await f.admin.handle(
            request("rename", "POST", { id: "player", name }),
          )
        )?.status,
      ).toBe(400);
    expect(
      (
        await f.admin.handle(
          request("rename", "POST", {
            id: "player",
            name: "Good",
            role: "owner",
          }),
        )
      )?.status,
    ).toBe(400);
    expect(
      (
        await f.admin.handle(
          request("rename", "POST", { id: "missing", name: "Good" }),
        )
      )?.status,
    ).toBe(404);
    expect(
      (
        await f.admin.handle(
          request("rename", "POST", { id: "player", name: "  New name  " }),
        )
      )?.status,
    ).toBe(200);
    expect(f.state.renames).toEqual(["New name"]);
    expect(f.state.audits).toEqual([
      [
        owner.subject,
        "rename-player",
        { id: "missing", name: "Good", phase: "attempt" },
      ],
      [
        owner.subject,
        "rename-player",
        {
          id: "missing",
          name: "Good",
          phase: "outcome",
          applied: false,
          status: 404,
        },
      ],
      [
        owner.subject,
        "rename-player",
        { id: "player", name: "New name", phase: "attempt" },
      ],
      [
        owner.subject,
        "rename-player",
        {
          id: "player",
          name: "New name",
          phase: "outcome",
          applied: true,
          status: 200,
        },
      ],
    ]);
  });
  test("rename length uses UTF-16 and rejects controls before trimming", async () => {
    const f = fixture();
    for (const name of ["\nValid", "Valid\t", "😀".repeat(13)])
      expect(
        (
          await f.admin.handle(
            request("rename", "POST", { id: "player", name }),
          )
        )?.status,
      ).toBe(400);
    for (const name of ["😀".repeat(12), "  " + "a".repeat(24) + "  "])
      expect(
        (
          await f.admin.handle(
            request("rename", "POST", { id: "player", name }),
          )
        )?.status,
      ).toBe(200);
    expect(f.state.renames).toEqual(["😀".repeat(12), "a".repeat(24)]);
  });
  test("a failed durable attempt prevents all mutations", async () => {
    const f = fixture();
    f.state.auditResults = [false, false];
    expect(
      (await f.admin.handle(request("settings", "PATCH", { cutaway: true })))
        ?.status,
    ).toBe(503);
    expect(
      (
        await f.admin.handle(
          request("rename", "POST", { id: "player", name: "New" }),
        )
      )?.status,
    ).toBe(503);
    expect(f.state.updates).toBe(0);
    expect(f.state.renames).toEqual([]);
    expect(f.state.order).toEqual(["attempt", "attempt"]);
  });
  test("outcome audit failure reports the actual mutation result with a warning", async () => {
    const f = fixture();
    f.state.auditResults = [true, false, true, false, true, false, true, false];
    const settings = (await f.admin.handle(
      request("settings", "PATCH", { cutaway: true }),
    ))!;
    expect(settings.status).toBe(200);
    expect(await settings.json()).toMatchObject({
      settings: { cutaway: true },
      auditWarning: expect.any(String),
    });
    const rename = (await f.admin.handle(
      request("rename", "POST", { id: "player", name: "New" }),
    ))!;
    expect(rename.status).toBe(200);
    expect(await rename.json()).toMatchObject({
      id: "player",
      name: "New",
      auditWarning: expect.any(String),
    });
    const missing = (await f.admin.handle(
      request("rename", "POST", { id: "missing", name: "New" }),
    ))!;
    expect(missing.status).toBe(404);
    expect(await missing.json()).toHaveProperty("auditWarning");
    f.state.busy = true;
    const busy = (await f.admin.handle(
      request("settings", "PATCH", { gravity: [1, 0, 0] }),
    ))!;
    expect(busy.status).toBe(409);
    expect(await busy.json()).toHaveProperty("auditWarning");
    expect(f.state.updates).toBe(1);
    expect(f.state.renames).toEqual(["New"]);
  });
  test("stream cap counts bytes without trusting Content-Length", async () => {
    const f = fixture();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('{"name":"' + "é".repeat(2050)),
        );
      },
      cancel() {
        cancelled = true;
      },
    });
    const req = new Request(`${origin}/api/admin/rename`, {
      method: "POST",
      headers: {
        Origin: origin,
        "X-CSRF-Token": owner.csrf,
        "Content-Type": "application/json",
        "Content-Length": "10",
      },
      body: stream,
    });
    expect((await f.admin.handle(req))?.status).toBe(400);
    expect(cancelled).toBe(true);
    expect(f.state.audits).toEqual([]);
  });
  test("unsupported APIs never perform recovery or accept unsupported methods", async () => {
    const f = fixture();
    expect((await f.admin.handle(request("restore", "POST", {})))?.status).toBe(
      404,
    );
    expect(
      (await f.admin.handle(request("settings", "POST", { cutaway: true })))
        ?.status,
    ).toBe(405);
    expect(f.state.updates).toBe(0);
  });
  test("fails closed when audit recording is unavailable", async () => {
    const f = fixture();
    const admin = createAdmin(f.hall, undefined, f.auth);
    expect((await admin.handle(request("metrics")))?.status).toBe(503);
    expect(
      (await admin.handle(request("settings", "PATCH", { cutaway: true })))
        ?.status,
    ).toBe(503);
    expect(
      (
        await admin.handle(
          request("rename", "POST", { id: "player", name: "New" }),
        )
      )?.status,
    ).toBe(503);
    expect(f.state.updates).toBe(0);
    expect(f.state.renames).toEqual([]);
  });
});
