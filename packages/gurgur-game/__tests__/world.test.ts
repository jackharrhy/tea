import { describe, expect, test } from "bun:test";
import { decodeCompiledGameEntities } from "../src";

describe("compiled game entity decoder", () => {
  test("accepts a complete closed-union member", () => {
    expect(
      decodeCompiledGameEntities([
        {
          kind: "relay",
          authoredId: "relay.main",
          targetName: "main",
          target: "door",
          delaySeconds: 0.25,
          once: false,
          body: null,
          presentation: { kind: "none" },
          interaction: "none",
        },
      ]),
    ).toHaveLength(1);
  });

  test("rejects unknown gameplay kinds after generic capability validation", () => {
    expect(() =>
      decodeCompiledGameEntities([
        {
          kind: "logic-counter",
          authoredId: "counter.main",
          body: null,
          presentation: { kind: "none" },
          interaction: "none",
        },
      ]),
    ).toThrow("logic-counter");
  });

  test("validates ambient audio and its typed listener trigger", () => {
    expect(
      decodeCompiledGameEntities([
        {
          kind: "ambient-audio",
          asset: "music/dylan",
          volume: 0.8,
          fadeInSeconds: 0.25,
          fadeOutSeconds: 0.5,
          loop: true,
          priority: 2,
          body: null,
          presentation: { kind: "none" },
          interaction: "none",
        },
        {
          kind: "trigger",
          authoredId: "trigger.audio.garden",
          mode: "multiple",
          outputs: {
            enter: { targetEntityIndices: [0], input: "play" },
            exit: { targetEntityIndices: [0], input: "stop" },
          },
          waitSeconds: 0.5,
          body: { kind: "sensor-brush", brushIndices: [0] },
          presentation: { kind: "none" },
          interaction: "none",
        },
      ]),
    ).toHaveLength(2);
    expect(() =>
      decodeCompiledGameEntities([
        {
          kind: "ambient-audio",
          asset: "../dylan.mp3",
          volume: 0.8,
          fadeInSeconds: 0.25,
          fadeOutSeconds: 0.5,
          loop: true,
          priority: 2,
          body: null,
          presentation: { kind: "none" },
          interaction: "none",
        },
      ]),
    ).toThrow("extensionless logical asset ID");
  });

  test("accepts typed light presentation and rejects malformed light capabilities", () => {
    expect(
      decodeCompiledGameEntities([
        {
          kind: "light",
          origin: { x: 0, y: 2, z: 0 },
          body: null,
          presentation: {
            kind: "light",
            mode: "spot",
            color: { r: 1, g: 0.5, b: 0.25 },
            intensity: 80,
            direction: { x: 0, y: -1, z: 0 },
            range: 12,
            decay: 2,
            angle: Math.PI / 6,
            penumbra: 0.4,
            castShadow: true,
            volumetric: true,
          },
          interaction: "none",
        },
      ]),
    ).toHaveLength(1);
    expect(() =>
      decodeCompiledGameEntities([
        {
          kind: "light",
          origin: { x: 0, y: 2, z: 0 },
          body: null,
          presentation: {
            kind: "light",
            mode: "spot",
            color: { r: 1, g: 0.5, b: 0.25 },
            intensity: 80,
            direction: { x: 0, y: 0, z: 0 },
            range: 12,
            decay: 2,
            angle: Math.PI,
            penumbra: 0.4,
            castShadow: true,
            volumetric: true,
          },
          interaction: "none",
        },
      ]),
    ).toThrow();
  });
});
