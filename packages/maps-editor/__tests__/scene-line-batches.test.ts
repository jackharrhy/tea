import { beforeAll, describe, expect, it, vi } from "vitest";
import { LineBatchBuilder } from "../src/render/scene-line-batches.js";

beforeAll(() => {
  Object.assign(globalThis, { GPUBufferUsage: { VERTEX: 1, COPY_DST: 2 } });
});

function gpu() {
  const buffers: Array<{ destroy: ReturnType<typeof vi.fn>; size: number }> =
    [];
  const writes: ArrayBufferView[] = [];
  const device = {
    createBuffer: ({ size }: { size: number }) => {
      const buffer = { destroy: vi.fn(), size };
      buffers.push(buffer);
      return buffer;
    },
    queue: {
      writeBuffer: (_buffer: unknown, _offset: number, data: ArrayBufferView) =>
        writes.push(data),
    },
  } as unknown as GPUDevice;
  return { device, buffers, writes };
}

const firstBounds = { min: [0, 0, 0], max: [32, 32, 32] } as const;
const secondBounds = { min: [64, 0, 0], max: [96, 32, 32] } as const;

describe("LineBatchBuilder", () => {
  it("retains unchanged CPU sources and GPU spatial batches", () => {
    const { device, buffers } = gpu();
    const initial = new LineBatchBuilder(device);
    initial.add("first", "first:0", firstBounds, [0, 0, 0], () => [
      1, 2, 3, 4, 5, 6,
    ]);
    initial.add("second", "second:0", secondBounds, [0, 0, 0], () => [
      7, 8, 9, 10, 11, 12,
    ]);
    const before = initial.finish();
    expect(before).toHaveLength(1);
    expect(buffers).toHaveLength(1);

    const unchanged = new LineBatchBuilder(device, before);
    const rebuildFirst = vi.fn(() => [20, 20, 20, 20, 20, 20]);
    const rebuildSecond = vi.fn(() => [30, 30, 30, 30, 30, 30]);
    unchanged.add("first", "first:0", firstBounds, [0, 0, 0], rebuildFirst);
    unchanged.add("second", "second:0", secondBounds, [0, 0, 0], rebuildSecond);
    const after = unchanged.finish();

    expect(after[0]).toBe(before[0]);
    expect(rebuildFirst).not.toHaveBeenCalled();
    expect(rebuildSecond).not.toHaveBeenCalled();
    expect(buffers).toHaveLength(1);
  });

  it("rebuilds only a changed source and its containing GPU batch", () => {
    const { device, buffers } = gpu();
    const initial = new LineBatchBuilder(device);
    initial.add("first", "first:0", firstBounds, [0, 0, 0], () => [
      1, 2, 3, 4, 5, 6,
    ]);
    initial.add("second", "second:0", secondBounds, [0, 0, 0], () => [
      7, 8, 9, 10, 11, 12,
    ]);
    const before = initial.finish();

    const changed = new LineBatchBuilder(device, before);
    const rebuildFirst = vi.fn(() => [20, 20, 20, 20, 20, 20]);
    const rebuildSecond = vi.fn(() => [30, 30, 30, 30, 30, 30]);
    changed.add("first", "first:1", firstBounds, [0, 0, 0], rebuildFirst);
    changed.add("second", "second:0", secondBounds, [0, 0, 0], rebuildSecond);
    const after = changed.finish();

    expect(after[0]?.buffer).not.toBe(before[0]?.buffer);
    expect(rebuildFirst).toHaveBeenCalledOnce();
    expect(rebuildSecond).not.toHaveBeenCalled();
    expect(buffers).toHaveLength(2);
  });
});
