import { describe, expect, test } from "bun:test";
import { WorldStore } from "../../server/src/store";

describe("WorldStore", () => {
  test("round-trips host state and rejects another map revision", () => {
    const store = new WorldStore(":memory:");
    try {
      const world = {
        worldEpoch: 4,
        serverTick: 900,
        bodies: [
          {
            authoredId: "physics.crate.1",
            position: { x: 1, y: 2, z: 3 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            linearVelocity: { x: 4, y: 5, z: 6 },
            angularVelocity: { x: 7, y: 8, z: 9 },
            awake: false,
          },
        ],
        gameState: {
          entities: [
            {
              kind: "linear-mover" as const,
              authoredId: "door.1",
              progress: 0.4,
              direction: 1 as const,
              resumeAtTick: 0,
            },
            { authoredId: "relay.1", kind: "relay" as const, fired: true },
            {
              authoredId: "trigger.1",
              kind: "trigger" as const,
              readyAtTick: 910,
              consumed: true,
            },
          ],
          delayedSignals: [{ target: "door.1", dueTick: 920 }],
        },
        players: [
          {
            persistentId: "session-hash",
            position: { x: 10, y: 2, z: -3 },
            yaw: 1,
            verticalVelocity: -2,
            grounded: false,
            lastJumpCounter: 4,
            stepCooldown: 2,
            crouched: true,
            grabbedAuthoredId: "physics.crate.1",
            grabDistance: 1.75,
          },
        ],
      };
      store.save("map-a", world);
      expect(store.load("map-a")).toEqual(world);
      expect(store.load("map-b")).toBeNull();
    } finally {
      store.close();
    }
  });

  test("rolls back the complete tick-boundary transaction when one row fails", () => {
    const store = new WorldStore(":memory:");
    const baseline = {
      worldEpoch: 1,
      serverTick: 10,
      bodies: [
        {
          authoredId: "body",
          position: { x: 0, y: 1, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          linearVelocity: { x: 0, y: 0, z: 0 },
          angularVelocity: { x: 0, y: 0, z: 0 },
          awake: true,
        },
      ],
      gameState: { entities: [], delayedSignals: [] },
      players: [],
    };
    try {
      store.save("map", baseline);
      expect(() =>
        store.save("map", {
          ...baseline,
          serverTick: 11,
          bodies: [baseline.bodies[0]!, baseline.bodies[0]!],
        }),
      ).toThrow();
      expect(store.load("map")).toEqual(baseline);
    } finally {
      store.close();
    }
  });
});
