import type { TgpuRoot } from "typegpu";
import { describe, expect, it, vi } from "vitest";

import { WorldCanvasTarget } from "../src/render/world-render-targets.js";

function texture(label: string) {
  const view = { label: `${label}-view` } as GPUTextureView;
  const raw = {
    createView: vi.fn(() => view),
  };
  const typed = {
    $usage: vi.fn(function (this: unknown) {
      return this;
    }),
    $name: vi.fn(function (this: unknown) {
      return this;
    }),
    destroy: vi.fn(),
  };
  return { raw, typed, view };
}

describe("compiled-world canvas target ownership", () => {
  it("reuses one target pair per size and destroys replaced resources exactly once", () => {
    const firstMsaa = texture("first-msaa");
    const firstDepth = texture("first-depth");
    const secondMsaa = texture("second-msaa");
    const secondDepth = texture("second-depth");
    const destination = texture("destination");
    const createTexture = vi
      .fn()
      .mockReturnValueOnce(firstMsaa.typed)
      .mockReturnValueOnce(firstDepth.typed)
      .mockReturnValueOnce(secondMsaa.typed)
      .mockReturnValueOnce(secondDepth.typed);
    const unwrap = vi.fn((resource: unknown) => {
      const match = [firstMsaa, firstDepth, secondMsaa, secondDepth].find(
        ({ typed }) => typed === resource,
      );
      if (!match) throw new Error("Unexpected texture");
      return match.raw;
    });
    const target = new WorldCanvasTarget(
      { createTexture, unwrap } as unknown as TgpuRoot,
      {
        getCurrentTexture: () => destination.raw,
      } as unknown as GPUCanvasContext,
      "bgra8unorm",
    );

    expect(target.current()).toBeNull();
    target.resize(640, 360);
    target.resize(640, 360);
    expect(createTexture).toHaveBeenCalledTimes(2);
    expect(target.current()).toEqual({
      destination: destination.view,
      msaa: firstMsaa.view,
      depth: firstDepth.view,
    });

    target.resize(800, 450);
    expect(firstMsaa.typed.destroy).toHaveBeenCalledOnce();
    expect(firstDepth.typed.destroy).toHaveBeenCalledOnce();
    expect(target.current()).toEqual({
      destination: destination.view,
      msaa: secondMsaa.view,
      depth: secondDepth.view,
    });

    target.dispose();
    target.dispose();
    expect(secondMsaa.typed.destroy).toHaveBeenCalledOnce();
    expect(secondDepth.typed.destroy).toHaveBeenCalledOnce();
    expect(target.current()).toBeNull();
  });
});
