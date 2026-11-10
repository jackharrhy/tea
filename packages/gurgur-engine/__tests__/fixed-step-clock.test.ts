import { describe, expect, test } from "bun:test";
import { accumulateFixedStepTime } from "../src";

describe("fixed-step clock accumulation", () => {
  test("caps catch-up work and reports every discarded second", () => {
    const result = accumulateFixedStepTime(0.5, 10, 0.25, 4);
    expect(result.accumulatorSeconds).toBe(1);
    expect(result.discardedSeconds).toBe(9.5);
  });

  test("retains substep remainder and ignores a backwards wall-clock sample", () => {
    expect(accumulateFixedStepTime(0.01, 0.02, 0.1, 4)).toEqual({
      accumulatorSeconds: 0.03,
      discardedSeconds: 0,
    });
    expect(accumulateFixedStepTime(0.01, -100, 0.1, 4)).toEqual({
      accumulatorSeconds: 0.01,
      discardedSeconds: 0,
    });
    expect(() => accumulateFixedStepTime(0, Number.NaN)).toThrow(
      "elapsed time must be finite",
    );
  });
});
