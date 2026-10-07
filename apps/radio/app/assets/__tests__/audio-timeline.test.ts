import * as assert from "remix/assert";
import { describe, it } from "remix/test";

import { localEpochToAudioTime } from "../audio-timeline.ts";

describe("audio timeline conversion", () => {
  it("uses the browser output timestamp to target audible time", () => {
    let audioTime = localEpochToAudioTime(1_001_500, {
      contextTime: 20,
      performanceNow: 1000,
      timeOrigin: 1_000_000,
      outputLatencySeconds: 0.1,
      outputTimestamp: { contextTime: 19.9, performanceTime: 900 },
    });

    assert.ok(Math.abs(audioTime - 20.5) < 1e-9);
  });

  it("subtracts output latency when output timestamps are unavailable", () => {
    let audioTime = localEpochToAudioTime(1_001_500, {
      contextTime: 20,
      performanceNow: 1000,
      timeOrigin: 1_000_000,
      outputLatencySeconds: 0.08,
    });

    assert.ok(Math.abs(audioTime - 20.42) < 1e-9);
  });
});
