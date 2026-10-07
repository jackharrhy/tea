export interface AudioTimelineSnapshot {
  contextTime: number;
  performanceNow: number;
  timeOrigin: number;
  outputLatencySeconds: number;
  outputTimestamp?: {
    contextTime?: number;
    performanceTime?: number;
  };
}

export function localEpochToAudioTime(
  targetLocalEpochTime: number,
  snapshot: AudioTimelineSnapshot,
): number {
  let timestamp = snapshot.outputTimestamp;
  if (
    typeof timestamp?.contextTime === "number" &&
    typeof timestamp.performanceTime === "number" &&
    timestamp.performanceTime > 0
  ) {
    let targetPerformanceTime = targetLocalEpochTime - snapshot.timeOrigin;
    return (
      timestamp.contextTime +
      (targetPerformanceTime - timestamp.performanceTime) / 1000
    );
  }
  let localNow = snapshot.timeOrigin + snapshot.performanceNow;
  return (
    snapshot.contextTime +
    (targetLocalEpochTime - localNow) / 1000 -
    snapshot.outputLatencySeconds
  );
}
