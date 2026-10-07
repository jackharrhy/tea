import { describe, expect, it, vi } from "vitest";

import { AnimationFrameScheduler } from "../src/runtime/frame-scheduler.js";

describe("animation frame scheduler", () => {
  it("coalesces invalidations and sleeps after one idle frame", () => {
    const frames: FrameRequestCallback[] = [];
    const scheduler = new AnimationFrameScheduler((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const render = vi.fn(() => false);

    scheduler.setTarget({ render });
    expect(frames).toHaveLength(0);
    scheduler.start();
    scheduler.request();
    expect(frames).toHaveLength(1);

    frames.shift()!(0);
    expect(render).toHaveBeenCalledOnce();
    expect(frames).toHaveLength(0);
    expect(scheduler.request()).toBe(true);
    expect(scheduler.request()).toBe(false);
  });

  it("continues only while the target reports active animation", () => {
    const frames: FrameRequestCallback[] = [];
    const scheduler = new AnimationFrameScheduler((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const render = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);

    scheduler.setTarget({ render });
    scheduler.start();
    frames.shift()!(0);
    expect(frames).toHaveLength(1);
    frames.shift()!(16);

    expect(render).toHaveBeenCalledTimes(2);
    expect(frames).toHaveLength(0);
  });

  it("cancels a pending frame when stopped or disposed", () => {
    const cancel = vi.fn();
    const scheduler = new AnimationFrameScheduler(() => 42, cancel);
    scheduler.setTarget({ render: () => false });
    scheduler.start();
    scheduler.stop();
    expect(cancel).toHaveBeenCalledWith(42);

    scheduler.start();
    scheduler.dispose();
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(scheduler.request()).toBe(false);
  });
});
