import { beforeAll, describe, expect, it, vi } from "vitest";
import { createStarterDocument } from "../src/core/index.js";
import { buildRemotePresenceBuffer } from "../src/render/remote-presence-buffers.js";
import { buildSelectionOverlayBuffers } from "../src/render/selection-overlay-buffers.js";

beforeAll(() => {
  Object.assign(globalThis, { GPUBufferUsage: { VERTEX: 1, COPY_DST: 2 } });
});

function gpu() {
  const writes: ArrayBufferView[] = [];
  const device = {
    createBuffer: () => ({ destroy: vi.fn() }),
    queue: {
      writeBuffer: (_buffer: unknown, _offset: number, data: ArrayBufferView) =>
        writes.push(data),
    },
  } as unknown as GPUDevice;
  return { device, writes };
}

describe("selection overlay buffers", () => {
  it("builds one shared edge and face treatment for a selected brush", () => {
    const document = createStarterDocument();
    const brush = document.entities[0]!.primitives[0]!;
    if (brush.kind !== "brush") throw new Error("Expected starter brush");
    const { device } = gpu();

    const overlay = buildSelectionOverlayBuffers(device, [
      {
        key: "local",
        color: [1, 0, 0],
        document,
        objectIds: [brush.id],
      },
    ]);

    expect(overlay.lineCount).toBe(24);
    expect(overlay.solids).toHaveLength(1);
    expect(overlay.solids[0]?.count).toBe(36);
  });

  it("tints a stationary remote selection as well as a live preview", () => {
    const document = createStarterDocument();
    const brush = document.entities[0]!.primitives[0]!;
    if (brush.kind !== "brush") throw new Error("Expected starter brush");
    const { device } = gpu();

    const remote = buildRemotePresenceBuffer(device, [
      {
        actorId: "red-shambler",
        color: [1, 0, 0],
        document,
        selectedObjectIds: [brush.id],
        previewObjectIds: [],
      },
    ]);

    expect(remote.lineCount).toBe(24);
    expect(remote.solids[0]?.count).toBe(36);
  });
});
