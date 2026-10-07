import * as assert from "remix/assert";
import { describe, it } from "remix/test";

import { NTP_CONSTANTS, epochNow } from "../../data/protocol.ts";
import {
  calculateClockEstimate,
  calculateWaitTimeMilliseconds,
  localTimeAtServerTime,
  ProbePairFilter,
  serverTimeAtLocalTime,
  type NtpMeasurement,
} from "../radio-sync.ts";

function createMeasurement(data: {
  roundTripDelay: number;
  clockOffset: number;
  localTime?: number;
}): NtpMeasurement {
  let localTime = data.localTime ?? 1000;
  return {
    t0: localTime - data.roundTripDelay / 2,
    t1: localTime + data.clockOffset,
    t2: localTime + data.clockOffset,
    t3: localTime + data.roundTripDelay / 2,
    roundTripDelay: data.roundTripDelay,
    clockOffset: data.clockOffset,
  };
}

describe("calculateClockEstimate", () => {
  it("uses the low-delay envelope instead of averaging Wi-Fi spikes", () => {
    let result = calculateClockEstimate([
      createMeasurement({ roundTripDelay: 10, clockOffset: 100 }),
      createMeasurement({ roundTripDelay: 11, clockOffset: 102 }),
      createMeasurement({ roundTripDelay: 12, clockOffset: 101 }),
      createMeasurement({ roundTripDelay: 200, clockOffset: 500 }),
      createMeasurement({ roundTripDelay: 300, clockOffset: 800 }),
    ]);

    assert.equal(result.offset, 101);
    assert.equal(result.roundTrip, 11);
    assert.equal(result.sampleCount, 3);
  });

  it("estimates oscillator skew and projects the clock forward", () => {
    let measurements = Array.from({ length: 8 }, (_, index) => {
      let localTime = 1_000_000 + index * 10_000;
      let clockOffset = 50 + (localTime - 1_000_000) * 40e-6;
      return createMeasurement({
        roundTripDelay: 10 + (index % 2),
        clockOffset,
        localTime,
      });
    });
    let estimate = calculateClockEstimate(measurements);

    assert.ok(Math.abs(estimate.skewPpm - 40) < 0.001);
    let futureLocalTime = 1_200_000;
    let futureServerTime = serverTimeAtLocalTime(futureLocalTime, estimate);
    assert.ok(Math.abs(futureServerTime - (futureLocalTime + 58)) < 0.001);
    assert.ok(
      Math.abs(
        localTimeAtServerTime(futureServerTime, estimate) - futureLocalTime,
      ) < 0.001,
    );
  });

  it("resists one low-latency offset outlier", () => {
    let measurements = Array.from({ length: 9 }, (_, index) =>
      createMeasurement({
        roundTripDelay: 10,
        clockOffset: index === 4 ? 400 : 25 + index * 0.02,
        localTime: 100_000 + index * 1000,
      }),
    );
    let estimate = calculateClockEstimate(measurements);

    assert.ok(Math.abs(estimate.skewPpm - 20) < 0.001);
    assert.ok(Math.abs(estimate.offset - 25.16) < 0.001);
  });
});

describe("calculateWaitTimeMilliseconds", () => {
  it("returns approximately the remaining wait time when the target is in the future", () => {
    let now = epochNow();
    let estimate = calculateClockEstimate([
      createMeasurement({
        roundTripDelay: 10,
        clockOffset: 100,
        localTime: now,
      }),
    ]);
    assert.ok(
      Math.abs(calculateWaitTimeMilliseconds(now + 600, estimate, now) - 500) <
        0.001,
    );
  });

  it("returns 0 when the target time has already passed", () => {
    let now = epochNow();
    let estimate = calculateClockEstimate([
      createMeasurement({ roundTripDelay: 10, clockOffset: 0, localTime: now }),
    ]);
    assert.equal(calculateWaitTimeMilliseconds(now - 1000, estimate, now), 0);
  });
});

describe("coded NTP probes", () => {
  it("keeps the better probe when a pair has a pure gap", () => {
    let filter = new ProbePairFilter();
    let first = filter.handle({
      type: "NTP_RESPONSE",
      t0: epochNow() - 10,
      t1: 1000,
      t2: 1000,
      probeGroupId: 7,
      probeGroupIndex: 0,
    });
    let second = filter.handle({
      type: "NTP_RESPONSE",
      t0: epochNow() - 5,
      t1: 1005,
      t2: 1005,
      probeGroupId: 7,
      probeGroupIndex: 1,
    });

    assert.equal(first, null);
    assert.ok(second);
  });

  it("rejects distorted probe gaps", () => {
    let filter = new ProbePairFilter();
    filter.handle({
      type: "NTP_RESPONSE",
      t0: 1000,
      t1: 2000,
      t2: 2000,
      probeGroupId: 8,
      probeGroupIndex: 0,
    });
    let measurement = filter.handle({
      type: "NTP_RESPONSE",
      t0: 1000 + NTP_CONSTANTS.PROBE_GAP_MS,
      t1:
        2000 +
        NTP_CONSTANTS.PROBE_GAP_MS +
        NTP_CONSTANTS.PROBE_GAP_TOLERANCE_MS +
        1,
      t2: 2000,
      probeGroupId: 8,
      probeGroupIndex: 1,
    });

    assert.equal(measurement, null);
  });
});
