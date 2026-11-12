import { expect, it } from "vitest";
import { summarizeTimings } from "../editor-performance.ts";

it("reports frame cadence separately from editor CPU submission time", () => {
  const summary = summarizeTimings([
    { at: 10, frameMs: 10, renderCalls: 0, renderCpuMs: 0 },
    { at: 30, frameMs: 20, renderCalls: 1, renderCpuMs: 2 },
    { at: 90, frameMs: 60, renderCalls: 2, renderCpuMs: 10 },
  ]);

  expect(summary).toMatchObject({
    frames: 3,
    p95Ms: 60,
    maxMs: 60,
    over33Ms: 1,
    over50Ms: 1,
    renderCalls: 3,
    meanRenderCpuMs: 4,
  });
  expect(summary.fps).toBeCloseTo(33.33, 2);
});
