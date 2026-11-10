import { describe, expect, test } from "bun:test";
import {
  DEBUG_PHYSICS_CAPTURE_SECONDS,
  buildDebugPhysicsCapture,
  debugPhysicsCaptureFilename,
} from "../../web/src/debug-capture";

describe("networked physics debug capture", () => {
  test("builds a cloned, versioned artifact with a filesystem-safe name", () => {
    const server = { complete: true, frames: [{ serverTick: 42 }] };
    const artifact = buildDebugPhysicsCapture({
      capturedAt: {
        startedAtIso: "2026-08-02T10:00:00.000Z",
        completedAtIso: "2026-08-02T10:00:15.000Z",
        clientPerformanceTimeOriginMs: 1_000,
        clientStartedAtMs: 10,
        clientCompletedAtMs: 15_010,
      },
      context: {
        url: "http://localhost:3000/?debug",
        userAgent: "test browser",
        mapRevision: "test-map",
        worldEpoch: 7,
        localPlayerId: { index: 1, generation: 2 },
        network: {
          rttMs: 0,
          jitterMs: 0,
          transport: "webrtc",
          simulatedLatencyMs: 0,
          simulatedJitterMs: 0,
          simulatedLossRate: 0,
          simulatedSeed: 1,
        },
      },
      client: { discardedCatchUpSeconds: 0, feel: {}, frames: [] },
      server,
    });
    server.frames[0]!.serverTick = 999;
    expect(artifact.format).toBe("gurgur-networked-physics-capture");
    expect(artifact.version).toBe(1);
    expect(artifact.durationSeconds).toBe(DEBUG_PHYSICS_CAPTURE_SECONDS);
    expect(artifact.server).toEqual({
      complete: true,
      frames: [{ serverTick: 42 }],
    });
    expect(
      debugPhysicsCaptureFilename(artifact.capturedAt.completedAtIso),
    ).toBe("gurgur-physics-2026-08-02T10-00-15-000Z.json.gz");
  });
});
