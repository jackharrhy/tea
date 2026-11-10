import { describe, expect, test } from "bun:test";
import { SourceTickMapper, unwrapTick32 } from "../src";

describe("source tick mapping", () => {
  test("preserves fixed source cadence when packet delay changes", () => {
    const mapper = new SourceTickMapper();
    const arrivals = [110, 112, 118, 119, 130];
    const mapped = [100, 102, 104, 106, 108].map((tick, index) =>
      mapper.map(tick, arrivals[index]!),
    );

    expect(mapped).toEqual([110, 112, 114, 116, 118]);
  });

  test("does not retime cadence when packet delay improves", () => {
    const mapper = new SourceTickMapper();
    expect(mapper.map(1_000, 1_020)).toBe(1_020);
    expect(mapper.map(1_002, 1_021)).toBe(1_022);
    expect(mapper.map(1_004, 1_022)).toBe(1_024);
  });

  test("rejects backwards and implausibly future source clocks", () => {
    const backwards = new SourceTickMapper();
    expect(backwards.map(100, 200)).toBe(200);
    expect(() => backwards.map(99, 201)).toThrow("source tick moved backwards");

    const future = new SourceTickMapper();
    expect(future.map(1_000, 1_000)).toBe(1_000);
    expect(() =>
      future.map(1_000 + SourceTickMapper.MAX_FUTURE_LEAD_TICKS + 2, 1_001),
    ).toThrow("source tick is implausibly far ahead");
  });

  test("unwraps the unsigned wire tick across rollover", () => {
    expect(unwrapTick32(1, 0xffff_fffe)).toBe(0x1_0000_0001);
    const mapper = new SourceTickMapper();
    expect(mapper.map(0xffff_fffe, 10_000)).toBe(10_000);
    expect(mapper.map(0, 10_002)).toBe(10_002);
    expect(mapper.map(2, 10_004)).toBe(10_004);
  });
});
