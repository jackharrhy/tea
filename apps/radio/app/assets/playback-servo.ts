export interface PlaybackCorrection {
  errorSeconds: number;
  playbackRate: number;
  hardSeekTo: number | null;
}

const HARD_SEEK_THRESHOLD_SECONDS = 0.75;
const MAX_RATE_CORRECTION = 0.0008;
const CORRECTION_HORIZON_SECONDS = 15;

export function calculatePlaybackCorrection(
  actualPosition: number,
  expectedPosition: number,
): PlaybackCorrection {
  let errorSeconds = actualPosition - expectedPosition;
  if (Math.abs(errorSeconds) >= HARD_SEEK_THRESHOLD_SECONDS) {
    return { errorSeconds, playbackRate: 1, hardSeekTo: expectedPosition };
  }
  let requestedCorrection = -errorSeconds / CORRECTION_HORIZON_SECONDS;
  let boundedCorrection = Math.max(
    -MAX_RATE_CORRECTION,
    Math.min(MAX_RATE_CORRECTION, requestedCorrection),
  );
  return {
    errorSeconds,
    playbackRate: 1 + boundedCorrection,
    hardSeekTo: null,
  };
}
