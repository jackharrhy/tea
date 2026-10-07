import * as assert from "remix/assert";
import { describe, it } from "remix/test";

import { calculatePlaybackCorrection } from "../playback-servo.ts";

describe("playback drift servo", () => {
  it("slows a player that is ahead and speeds up one that is behind", () => {
    assert.ok(calculatePlaybackCorrection(10.05, 10).playbackRate < 1);
    assert.ok(calculatePlaybackCorrection(9.95, 10).playbackRate > 1);
  });

  it("caps corrections at an inaudible 800 ppm", () => {
    assert.equal(calculatePlaybackCorrection(10.2, 10).playbackRate, 0.9992);
    assert.equal(calculatePlaybackCorrection(9.8, 10).playbackRate, 1.0008);
  });

  it("hard-seeks after a suspension-sized error", () => {
    assert.deepEqual(calculatePlaybackCorrection(14, 10), {
      errorSeconds: 4,
      playbackRate: 1,
      hardSeekTo: 10,
    });
  });
});
