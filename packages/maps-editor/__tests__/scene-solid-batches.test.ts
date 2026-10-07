import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  createStarterDocument,
  findBrush,
  translateBrush,
} from "../src/core/index.js";
import {
  brushSolidSignature,
  SolidBatchBuilder,
} from "../src/render/scene-solid-batches.js";

beforeAll(() => {
  Object.assign(globalThis, { GPUBufferUsage: { VERTEX: 1, COPY_DST: 2 } });
});

function gpu() {
  const buffers: object[] = [];
  const device = {
    createBuffer: () => {
      const buffer = { destroy: vi.fn() };
      buffers.push(buffer);
      return buffer;
    },
    queue: { writeBuffer: vi.fn() },
  } as unknown as GPUDevice;
  return { device, buffers };
}

const bounds = { min: [0, 0, 0], max: [32, 32, 32] } as const;

describe("SolidBatchBuilder", () => {
  it("distinguishes transient drag previews that share the same next revision", () => {
    const document = createStarterDocument();
    const brush = findBrush(document, document.entities[0]!.primitives[0]!.id)!;
    const firstPreview = translateBrush(brush, [16, 0, 0]);
    const laterPreview = translateBrush(brush, [32, 0, 0]);

    expect(firstPreview.revision).toBe(laterPreview.revision);
    expect(brushSolidSignature(firstPreview, [0, 0, 0])).not.toBe(
      brushSolidSignature(laterPreview, [0, 0, 0]),
    );
    expect(brushSolidSignature(laterPreview, [0, 0, 0])).not.toBe(
      brushSolidSignature(laterPreview, [16, 0, 0]),
    );
  });

  it("discards reconstructed vertices for retained immutable sources", () => {
    const { device, buffers } = gpu();
    const initial = new SolidBatchBuilder();
    initial
      .vertices("brick", bounds, [0, 0, 0], "first:0")
      .push(1, 2, 3, 4, 5, 6, 7, 8);
    const before = initial.finish(device);

    const retained = new SolidBatchBuilder(before);
    const sink = retained.vertices("brick", bounds, [0, 0, 0], "first:0");
    expect(sink.retained).toBe(true);
    expect(sink.push(9, 9, 9, 9, 9, 9, 9, 9)).toBe(0);
    const after = retained.finish(device);

    expect(after[0]).toBe(before[0]);
    expect(after[0]?.buffer).toBe(before[0]?.buffer);
    expect(after[0]?.count).toBe(1);
    expect(buffers).toHaveLength(1);
  });

  it("rebuilds a batch from retained and changed sources without duplicating either", () => {
    const { device, buffers } = gpu();
    const initial = new SolidBatchBuilder();
    initial
      .vertices("brick", bounds, [0, 0, 0], "first:0")
      .push(1, 2, 3, 4, 5, 6, 7, 8);
    initial
      .vertices("brick", bounds, [0, 0, 0], "second:0")
      .push(2, 3, 4, 5, 6, 7, 8, 9);
    const before = initial.finish(device);

    const changed = new SolidBatchBuilder(before);
    changed
      .vertices("brick", bounds, [0, 0, 0], "first:0")
      .push(9, 9, 9, 9, 9, 9, 9, 9);
    changed
      .vertices("brick", bounds, [0, 0, 0], "second:1")
      .push(3, 4, 5, 6, 7, 8, 9, 10);
    const after = changed.finish(device);

    expect(after[0]?.buffer).not.toBe(before[0]?.buffer);
    expect(after[0]?.count).toBe(2);
    expect(buffers).toHaveLength(2);
  });
});
