import {
  NTP_CONSTANTS,
  epochNow,
  type ServerMessage,
} from "../data/protocol.ts";

export interface NtpMeasurement {
  t0: number;
  t1: number;
  t2: number;
  t3: number;
  roundTripDelay: number;
  clockOffset: number;
}

export interface ClockEstimate {
  offset: number;
  roundTrip: number;
  skewPpm: number;
  uncertaintyMs: number;
  referenceLocalTime: number;
  sampleCount: number;
}

type NtpResponse = Extract<ServerMessage, { type: "NTP_RESPONSE" }>;

export class ProbePairFilter {
  private firstByGroup = new Map<number, NtpMeasurement>();

  handle(
    response: NtpResponse,
    receivedAt = epochNow(),
  ): NtpMeasurement | null {
    let measurement = measurementFromResponse(response, receivedAt);
    if (response.probeGroupIndex === 0) {
      this.firstByGroup.set(response.probeGroupId, measurement);
      return null;
    }

    let first = this.firstByGroup.get(response.probeGroupId);
    this.firstByGroup.delete(response.probeGroupId);
    if (!first) return null;
    let clientGap = measurement.t0 - first.t0;
    let serverGap = measurement.t1 - first.t1;
    if (Math.abs(serverGap - clientGap) > NTP_CONSTANTS.PROBE_GAP_TOLERANCE_MS)
      return null;
    return first.roundTripDelay <= measurement.roundTripDelay
      ? first
      : measurement;
  }

  reset(): void {
    this.firstByGroup.clear();
  }
}

export function sendProbePair(data: {
  send: (value: unknown) => void;
  currentRTT?: number;
  compensationMs?: number;
  nudgeMs?: number;
}): void {
  let probeGroupId = nextProbeGroupId++;
  sendProbe(data, probeGroupId, 0);
  setTimeout(
    () => sendProbe(data, probeGroupId, 1),
    NTP_CONSTANTS.PROBE_GAP_MS,
  );
}

let nextProbeGroupId = 0;

function sendProbe(
  data: Parameters<typeof sendProbePair>[0],
  probeGroupId: number,
  probeGroupIndex: 0 | 1,
): void {
  data.send({
    type: "NTP_REQUEST",
    t0: epochNow(),
    clientRTT: data.currentRTT,
    clientCompensationMs: data.compensationMs,
    clientNudgeMs: data.nudgeMs,
    probeGroupId,
    probeGroupIndex,
  });
}

export function calculateClockEstimate(
  measurements: NtpMeasurement[],
): ClockEstimate {
  let valid = measurements.filter(
    (sample) =>
      Number.isFinite(sample.roundTripDelay) &&
      sample.roundTripDelay >= 0 &&
      Number.isFinite(sample.clockOffset),
  );
  if (valid.length === 0) return emptyEstimate();

  let sorted = valid.toSorted(
    (left, right) => left.roundTripDelay - right.roundTripDelay,
  );
  let minimumRtt = sorted[0]!.roundTripDelay;
  let envelope = Math.max(2, minimumRtt * 0.25);
  let filtered = sorted.filter(
    (sample) => sample.roundTripDelay <= minimumRtt + envelope,
  );
  let minimumUsefulSamples = Math.min(3, sorted.length);
  if (filtered.length < minimumUsefulSamples)
    filtered = sorted.slice(0, minimumUsefulSamples);

  let referenceLocalTime = Math.max(...filtered.map(measurementLocalTime));
  let { intercept, slope } = robustLinearFit(
    filtered.map((sample) => ({
      x: measurementLocalTime(sample) - referenceLocalTime,
      y: sample.clockOffset,
    })),
  );
  let boundedSlope = Math.max(-0.001, Math.min(0.001, slope));
  let residuals = filtered
    .map((sample) => {
      let projected =
        intercept +
        boundedSlope * (measurementLocalTime(sample) - referenceLocalTime);
      return Math.abs(sample.clockOffset - projected);
    })
    .toSorted((left, right) => left - right);

  return {
    offset: intercept,
    roundTrip: median(filtered.map((sample) => sample.roundTripDelay)),
    skewPpm: boundedSlope * 1_000_000,
    uncertaintyMs: minimumRtt / 2 + median(residuals),
    referenceLocalTime,
    sampleCount: filtered.length,
  };
}

export function serverTimeAtLocalTime(
  localTime: number,
  estimate: ClockEstimate,
): number {
  let rate = 1 + estimate.skewPpm / 1_000_000;
  return (
    estimate.referenceLocalTime +
    estimate.offset +
    (localTime - estimate.referenceLocalTime) * rate
  );
}

export function localTimeAtServerTime(
  serverTime: number,
  estimate: ClockEstimate,
): number {
  let rate = 1 + estimate.skewPpm / 1_000_000;
  return (
    estimate.referenceLocalTime +
    (serverTime - estimate.referenceLocalTime - estimate.offset) / rate
  );
}

export function calculateWaitTimeMilliseconds(
  targetServerTime: number,
  estimate: ClockEstimate,
  localNow = epochNow(),
): number {
  return Math.max(
    0,
    localTimeAtServerTime(targetServerTime, estimate) - localNow,
  );
}

function measurementFromResponse(
  response: NtpResponse,
  receivedAt: number,
): NtpMeasurement {
  return {
    t0: response.t0,
    t1: response.t1,
    t2: response.t2,
    t3: receivedAt,
    roundTripDelay: receivedAt - response.t0 - (response.t2 - response.t1),
    clockOffset: (response.t1 - response.t0 + (response.t2 - receivedAt)) / 2,
  };
}

function measurementLocalTime(measurement: NtpMeasurement): number {
  return (measurement.t0 + measurement.t3) / 2;
}

function robustLinearFit(points: Array<{ x: number; y: number }>): {
  intercept: number;
  slope: number;
} {
  let slopes: number[] = [];
  for (let left = 0; left < points.length; left++) {
    for (let right = left + 1; right < points.length; right++) {
      let run = points[right]!.x - points[left]!.x;
      if (run !== 0) slopes.push((points[right]!.y - points[left]!.y) / run);
    }
  }
  let slope = slopes.length > 0 ? median(slopes) : 0;
  let intercept = median(points.map((point) => point.y - slope * point.x));
  return { intercept, slope };
}

function median(values: number[]): number {
  let sorted = values.toSorted((left, right) => left - right);
  let middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function emptyEstimate(): ClockEstimate {
  return {
    offset: 0,
    roundTrip: 0,
    skewPpm: 0,
    uncertaintyMs: Infinity,
    referenceLocalTime: epochNow(),
    sampleCount: 0,
  };
}
