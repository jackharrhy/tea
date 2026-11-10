import { describe, expect, test } from "bun:test";
import {
  PROTOCOL_VERSION,
  decodeClientControl,
  decodeServerControl,
} from "../src";

describe("bounded client control union", () => {
  test("decodes every client discriminator with exact bounded fields", () => {
    const messages: unknown[] = [
      {
        type: "hello",
        protocolVersion: PROTOCOL_VERSION,
        mapRevision: null,
        worldEpoch: null,
        sessionToken: null,
        socketGeneration: 0,
      },
      {
        type: "ping",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        nonce: 2,
        sentAtMs: 3.5,
      },
      {
        type: "rtc-answer",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        description: { type: "answer", sdp: "v=0\r\n" },
      },
      {
        type: "speak",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        requestId: 7,
        text: "Hello from a browser.",
      },
      {
        type: "manipulation-request",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        requestId: 9,
        target: { index: 2, generation: 3 },
        authorityVersion: 4,
        localAnchor: { x: 0.25, y: 0, z: -0.5 },
        holdDistance: 1.75,
      },
      {
        type: "manipulation-drop",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        target: { index: 2, generation: 3 },
        authorityVersion: 4,
        claimVersion: 2,
      },
      {
        type: "use-request",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        requestId: 10,
        target: { index: 2, generation: 3 },
      },
    ];
    for (const message of messages) {
      expect(
        decodeClientControl(JSON.stringify(message)) as typeof message,
      ).toEqual(message);
    }
  });

  test("rejects malformed, oversized, and unexpected control fields", () => {
    const invalid: string[] = [
      "null",
      "[]",
      "1",
      "{}",
      "{",
      JSON.stringify({ type: "unknown", protocolVersion: PROTOCOL_VERSION }),
      JSON.stringify({
        type: "hello",
        protocolVersion: PROTOCOL_VERSION,
        mapRevision: null,
        worldEpoch: null,
        sessionToken: null,
        socketGeneration: -1,
      }),
      JSON.stringify({
        type: "ping",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        nonce: 0,
        sentAtMs: null,
      }),
      JSON.stringify({
        type: "speak",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        requestId: 0,
        text: "",
      }),
      JSON.stringify({
        type: "speak",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        requestId: 0,
        text: "x".repeat(121),
      }),
      JSON.stringify({
        type: "speak",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        requestId: 0,
        text: "[[rate 900]] no",
      }),
      JSON.stringify({
        type: "speak",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        requestId: 0,
        text: "no emoji \u{1f641}",
      }),
      JSON.stringify({
        type: "speak",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        requestId: 0,
        text: "unexpected field",
        voice: 0,
      }),
      JSON.stringify({
        type: "manipulation-request",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        requestId: 1,
        target: { index: 2, generation: 3 },
        authorityVersion: 4,
        localAnchor: { x: 0, y: Number.NaN, z: 0 },
        holdDistance: 1,
      }),
      JSON.stringify({
        type: "manipulation-request",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        requestId: 1,
        target: { index: 2, generation: 3 },
        authorityVersion: 4,
        localAnchor: { x: 0, y: 0, z: 0 },
        holdDistance: 10.01,
      }),
      "x".repeat(32_769),
    ];
    for (const source of invalid)
      expect(() => decodeClientControl(source)).toThrow();
  });
});

describe("bounded server control union", () => {
  test("decodes every server text discriminator with exact bounded fields", () => {
    const messages: unknown[] = [
      {
        type: "welcome",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        playerId: { index: 1, generation: 2 },
        mapRevision: "revision",
        physicsHz: 60,
        stateHz: 30,
        sessionToken: "0123456789abcdef",
        socketGeneration: 0,
      },
      {
        type: "world",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        mapRevision: "revision",
        bundleUrl: "/world.bin",
        runtimeEntities: [
          {
            id: { index: 1, generation: 1 },
            kind: "world-entity",
            entityIndex: 2,
            ownerPlayerId: null,
            authorityVersion: 1,
            transferPolicy: "fixed",
          },
          {
            id: { index: 2, generation: 1 },
            kind: "player",
            ownerPlayerId: { index: 2, generation: 1 },
            authorityVersion: 1,
            transferPolicy: "fixed",
          },
        ],
      },
      {
        type: "pong",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        nonce: 2,
        sentAtMs: 3.5,
        serverTick: 4,
      },
      {
        type: "rtc-offer",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        description: { type: "offer", sdp: "v=0\r\n" },
        iceServers: [
          { urls: "turn:relay.example", username: "u", credential: "p" },
        ],
      },
      {
        type: "speech",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        requestId: 7,
        speakerId: { index: 3, generation: 4 },
        voice: 2,
        text: "Hello from the server.",
      },
      {
        type: "speech-rejected",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        requestId: 8,
        reason: "rate-limited",
        retryAfterMs: 1_500,
      },
      {
        type: "speech-rejected",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 2,
        requestId: 9,
        reason: "world-changed",
        retryAfterMs: 0,
      },
      {
        type: "manipulation-changed",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 2,
        requestId: 11,
        target: { index: 4, generation: 5 },
        authorityVersion: 3,
        claimVersion: 7,
        manipulatorPlayerId: { index: 50_000, generation: 2 },
      },
      {
        type: "manipulation-denied",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 2,
        requestId: 12,
        target: { index: 4, generation: 5 },
        reason: "busy",
      },
    ];
    for (const message of messages) {
      expect(
        decodeServerControl(JSON.stringify(message)) as typeof message,
      ).toEqual(message);
    }
  });

  test("rejects malformed server control packets before they reach browser state", () => {
    const invalid = [
      "null",
      "[]",
      "{",
      "x".repeat(32_769),
      JSON.stringify({
        type: "world",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        mapRevision: "r",
        bundleUrl: "/",
        runtimeEntities: [
          {
            id: { index: -1, generation: 0 },
            kind: "player",
            unexpected: "bad",
          },
        ],
      }),
      JSON.stringify({
        type: "not-supported",
        protocolVersion: PROTOCOL_VERSION,
      }),
      JSON.stringify({
        type: "pong",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        nonce: 0,
        sentAtMs: 0,
        serverTick: 0,
        surprise: true,
      }),
      JSON.stringify({
        type: "speech",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        requestId: 0,
        speakerId: { index: -1, generation: 0 },
        voice: 0,
        text: "hello",
      }),
      JSON.stringify({
        type: "speech",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        requestId: 0,
        speakerId: { index: 1, generation: 0, spoofed: true },
        voice: 0,
        text: "hello",
      }),
      JSON.stringify({
        type: "speech",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        requestId: 0,
        speakerId: { index: 1, generation: 0 },
        voice: 5,
        text: "hello",
      }),
      JSON.stringify({
        type: "speech-rejected",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        requestId: 0,
        reason: "made-up",
        retryAfterMs: 0,
      }),
      JSON.stringify({
        type: "speech-rejected",
        protocolVersion: PROTOCOL_VERSION,
        worldEpoch: 1,
        requestId: 0,
        reason: "rate-limited",
        retryAfterMs: -1,
      }),
    ];
    for (const source of invalid)
      expect(() => decodeServerControl(source)).toThrow();
  });
});
