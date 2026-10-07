export interface TimingSample {
  readonly at: number;
  readonly frameMs: number;
  readonly renderCalls: number;
  readonly renderCpuMs: number;
}

export function summarizeTimings(samples: readonly TimingSample[]) {
  const frameTimes = samples
    .map((sample) => sample.frameMs)
    .toSorted((left, right) => left - right);
  const elapsed = frameTimes.reduce((sum, frameMs) => sum + frameMs, 0);
  const renderCalls = samples.reduce(
    (sum, sample) => sum + sample.renderCalls,
    0,
  );
  return {
    frames: samples.length,
    fps: elapsed ? (samples.length * 1000) / elapsed : 0,
    p95Ms:
      frameTimes[Math.max(0, Math.ceil(frameTimes.length * 0.95) - 1)] ?? 0,
    maxMs: frameTimes.at(-1) ?? 0,
    over33Ms: frameTimes.filter((frameMs) => frameMs > 33.34).length,
    over50Ms: frameTimes.filter((frameMs) => frameMs > 50).length,
    renderCalls,
    meanRenderCpuMs: renderCalls
      ? samples.reduce((sum, sample) => sum + sample.renderCpuMs, 0) /
        renderCalls
      : 0,
  };
}

export interface PerformanceState {
  readonly enabled: boolean;
  readonly recording: boolean;
  readonly samples: readonly TimingSample[];
  readonly capture: readonly TimingSample[];
}

export function initEditorPerformance() {
  let enabled = false;
  let recording = false;
  let samples: TimingSample[] = [];
  let capture: TimingSample[] = [];
  let frame = 0;
  let previous = 0;
  let started = 0;
  let published = 0;
  let renderCalls = 0;
  let renderCpuMs = 0;

  function publish() {
    window.dispatchEvent(
      new CustomEvent<PerformanceState>("tea-maps-performance-state", {
        detail: {
          enabled,
          recording,
          samples,
          capture,
        },
      }),
    );
  }

  function resetBaseline() {
    previous = 0;
    renderCalls = 0;
    renderCpuMs = 0;
  }

  function tick(now: number) {
    if (!enabled) return;
    if (document.visibilityState === "visible" && previous) {
      const sample = {
        at: now,
        frameMs: now - previous,
        renderCalls,
        renderCpuMs,
      };
      samples.push(sample);
      if (samples.length > 240) samples.shift();
      if (recording) {
        capture.push(sample);
        if (now - started >= 30_000 || capture.length >= 10_000)
          recording = false;
      }
    }
    previous = document.visibilityState === "visible" ? now : 0;
    renderCalls = 0;
    renderCpuMs = 0;
    if (now - published >= 250) {
      published = now;
      publish();
    }
    frame = requestAnimationFrame(tick);
  }

  function stop() {
    enabled = false;
    recording = false;
    cancelAnimationFrame(frame);
    document.removeEventListener("visibilitychange", resetBaseline);
    publish();
  }

  window.addEventListener("tea-maps-performance-ready", publish);
  window.addEventListener("tea-maps-performance-toggle", () => {
    if (enabled) {
      stop();
      return;
    }
    enabled = true;
    samples = [];
    resetBaseline();
    document.addEventListener("visibilitychange", resetBaseline);
    publish();
    frame = requestAnimationFrame(tick);
  });
  window.addEventListener("tea-maps-performance-record", () => {
    if (recording) recording = false;
    else {
      capture = [];
      started = performance.now();
      recording = true;
    }
    publish();
  });
  window.addEventListener("tea-maps-performance-dispose", stop);
  window.addEventListener("pagehide", stop, { once: true });
  publish();

  return {
    isEnabled: () => enabled,
    recordRender(cpuMs: number) {
      if (!enabled) return;
      renderCalls++;
      renderCpuMs += cpuMs;
    },
  };
}
