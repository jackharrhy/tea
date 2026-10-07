import {
  NTP_CONSTANTS,
  epochNow,
  type ServerMessage,
} from "../data/protocol.ts";
import {
  calculatePlaybackCorrection,
  type PlaybackCorrection,
} from "./playback-servo.ts";
import {
  calculateClockEstimate,
  localTimeAtServerTime,
  ProbePairFilter,
  serverTimeAtLocalTime,
  type ClockEstimate,
  type NtpMeasurement,
} from "./radio-sync.ts";

type NtpResponse = Extract<ServerMessage, { type: "NTP_RESPONSE" }>;

export class RadioSynchronizer {
  private measurements: NtpMeasurement[] = [];
  private estimate: ClockEstimate = calculateClockEstimate([]);
  private probeFilter = new ProbePairFilter();
  private playbackAnchor: {
    trackId: string;
    trackTimeSeconds: number;
    serverTimeToExecute: number;
  } | null = null;
  private lastServoAt = 0;

  constructor(private compensationMs = 0) {}

  handleProbe(response: NtpResponse): ClockEstimate | null {
    let measurement = this.probeFilter.handle(response);
    if (!measurement) return null;
    this.measurements = [
      ...this.measurements.slice(-NTP_CONSTANTS.MAX_HISTORY_MEASUREMENTS + 1),
      measurement,
    ];
    this.estimate = calculateClockEstimate(this.measurements);
    return this.estimate;
  }

  resetClock(): void {
    this.probeFilter.reset();
    this.measurements = [];
    this.estimate = calculateClockEstimate([]);
  }

  get synchronized(): boolean {
    return this.measurements.length >= NTP_CONSTANTS.MAX_MEASUREMENTS;
  }

  get clockEstimate(): ClockEstimate {
    return this.estimate;
  }

  get deviceCompensationMs(): number {
    return this.compensationMs;
  }

  setDeviceCompensation(compensationMs: number): number {
    this.compensationMs = Math.max(-1000, Math.min(1000, compensationMs));
    return this.compensationMs;
  }

  localExecutionTime(serverTime: number): number {
    return (
      localTimeAtServerTime(serverTime, this.estimate) - this.compensationMs
    );
  }

  startPlayback(
    trackId: string,
    trackTimeSeconds: number,
    serverTimeToExecute: number,
  ): void {
    this.playbackAnchor = { trackId, trackTimeSeconds, serverTimeToExecute };
    this.lastServoAt = 0;
  }

  stopPlayback(): void {
    this.playbackAnchor = null;
    this.lastServoAt = 0;
  }

  playbackCorrection(
    trackId: string,
    actualPosition: number,
    boundPosition: (position: number) => number,
    now = epochNow(),
  ): PlaybackCorrection | null {
    if (
      !this.playbackAnchor ||
      this.playbackAnchor.trackId !== trackId ||
      now - this.lastServoAt < 2000
    ) {
      return null;
    }
    this.lastServoAt = now;
    let serverNow = serverTimeAtLocalTime(now, this.estimate);
    let expectedPosition = boundPosition(
      this.playbackAnchor.trackTimeSeconds +
        (serverNow - this.playbackAnchor.serverTimeToExecute) / 1000,
    );
    return calculatePlaybackCorrection(actualPosition, expectedPosition);
  }
}
