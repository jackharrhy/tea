import { describe, expect, test } from "bun:test";
import { decodePersistedGameState, encodePersistedGameState } from "../src";

describe("persisted game state", () => {
  test("round-trips deterministically with every current persistent archetype", () => {
    const state = {
      entities: [
        {
          kind: "button" as const,
          authoredId: "button",
          readyAtTick: 8,
        },
        {
          kind: "linear-mover" as const,
          authoredId: "door",
          progress: 0.5,
          direction: 1 as const,
          resumeAtTick: 0,
        },
        {
          kind: "trigger" as const,
          authoredId: "trigger",
          readyAtTick: 12,
          consumed: true,
        },
        {
          kind: "relay" as const,
          authoredId: "relay",
          fired: false,
        },
        {
          kind: "physics-control" as const,
          authoredId: "conveyor",
          enabled: true,
          reversed: true,
        },
      ],
      delayedSignals: [{ target: "door", dueTick: 20 }],
    };
    const encoded = encodePersistedGameState(state);
    expect(encodePersistedGameState(decodePersistedGameState(encoded))).toBe(
      encoded,
    );
  });

  test("rejects unknown kinds, duplicate IDs, and malformed delayed signals", () => {
    expect(() =>
      decodePersistedGameState(
        '{"entities":[{"kind":"script","authoredId":"x"}],"delayedSignals":[]}',
      ),
    ).toThrow("unknown");
    expect(() =>
      decodePersistedGameState(
        '{"entities":[{"kind":"relay","authoredId":"x","fired":false},{"kind":"relay","authoredId":"x","fired":true}],"delayedSignals":[]}',
      ),
    ).toThrow("duplicate");
    expect(() =>
      decodePersistedGameState(
        '{"entities":[],"delayedSignals":[{"target":"","dueTick":-1}]}',
      ),
    ).toThrow("invalid");
  });
});
