import { MAX_CATCH_UP_TICKS, PHYSICS_DT } from "./config";

export type FixedStepAccumulation = {
  accumulatorSeconds: number;
  discardedSeconds: number;
};

export function accumulateFixedStepTime(
  accumulatorSeconds: number,
  elapsedSeconds: number,
  fixedDt = PHYSICS_DT,
  maxCatchUpTicks = MAX_CATCH_UP_TICKS,
): FixedStepAccumulation {
  if (!Number.isFinite(accumulatorSeconds) || accumulatorSeconds < 0)
    throw new Error("fixed-step accumulator must be finite and non-negative");
  if (!Number.isFinite(elapsedSeconds))
    throw new Error("elapsed time must be finite");
  if (!Number.isFinite(fixedDt) || fixedDt <= 0)
    throw new Error("fixed-step duration must be finite and positive");
  if (!Number.isInteger(maxCatchUpTicks) || maxCatchUpTicks < 1)
    throw new Error("maximum catch-up ticks must be a positive integer");
  const accumulated = accumulatorSeconds + Math.max(0, elapsedSeconds);
  const maximum = fixedDt * maxCatchUpTicks;
  return {
    accumulatorSeconds: Math.min(accumulated, maximum),
    discardedSeconds: Math.max(0, accumulated - maximum),
  };
}
