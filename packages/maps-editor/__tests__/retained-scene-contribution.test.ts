import { describe, expect, it, vi } from "vitest";
import { retainSceneContribution } from "../src/render/retained-scene-contribution.js";

function buffer() {
  return { destroy: vi.fn() } as unknown as GPUBuffer;
}

describe("retained scene contribution", () => {
  it("reuses an equal dependency key without invoking its builder", () => {
    const owned = buffer();
    const initial = retainSceneContribution({
      name: "diagnostics",
      key: ["document", 1],
      build: () => ({ buffer: owned, count: 1 }),
      buffers: (value) => [value.buffer],
    }).contribution;
    const build = vi.fn(() => ({ buffer: buffer(), count: 2 }));

    const retained = retainSceneContribution({
      name: "diagnostics",
      key: ["document", 1],
      previous: initial,
      build,
      buffers: (value) => [value.buffer],
    });

    expect(retained.rebuilt).toBe(false);
    expect(retained.contribution).toBe(initial);
    expect(build).not.toHaveBeenCalled();
  });

  it("retires only buffers absent from an incrementally rebuilt contribution", () => {
    const shared = buffer();
    const retired = buffer();
    const created = buffer();
    const initial = retainSceneContribution({
      name: "objectLines",
      key: [1],
      build: () => ({ buffers: [shared, retired] }),
      buffers: (value) => value.buffers,
    }).contribution;

    const replacement = retainSceneContribution({
      name: "objectLines",
      key: [2],
      previous: initial,
      build: () => ({ buffers: [shared, created] }),
      buffers: (value) => value.buffers,
    });

    replacement.retirePrevious();
    expect(retired.destroy).toHaveBeenCalledOnce();
    expect(shared.destroy).not.toHaveBeenCalled();
    replacement.contribution.dispose();
    replacement.contribution.dispose();
    expect(shared.destroy).toHaveBeenCalledOnce();
    expect(created.destroy).toHaveBeenCalledOnce();
  });
});
