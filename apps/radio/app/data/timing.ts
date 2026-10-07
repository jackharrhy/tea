export const MIN_SCHEDULE_TIME_MS = 400;
export const DEFAULT_CLIENT_RTT_MS = 0;
const CAP_SCHEDULE_TIME_MS = 3000;

export function calculateScheduleTimeMs(maxRtt: number): number {
  let dynamicDelay = Math.max(MIN_SCHEDULE_TIME_MS, maxRtt * 1.5 + 200);
  return Math.min(dynamicDelay, CAP_SCHEDULE_TIME_MS);
}
