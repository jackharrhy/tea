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

export function initEditorPerformance() {
  const toggle = document.querySelector<HTMLButtonElement>(
    "#performance-toggle",
  )!;
  const panel = document.querySelector<HTMLElement>("#performance-panel")!;
  const heading = document.querySelector<HTMLElement>("#performance-heading")!;
  const frames = document.querySelector<HTMLElement>("#performance-frames")!;
  const graph =
    document.querySelector<SVGPolylineElement>("#performance-graph")!;
  const slow = document.querySelector<HTMLElement>("#performance-slow")!;
  const render = document.querySelector<HTMLElement>("#performance-render")!;
  const record = document.querySelector<HTMLButtonElement>(
    "#performance-record",
  )!;
  const report = document.querySelector<HTMLButtonElement>(
    "#performance-report",
  )!;
  const captureLabel = document.querySelector<HTMLElement>(
    "#performance-capture",
  )!;
  const json =
    document.querySelector<HTMLTextAreaElement>("#performance-json")!;
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

  function update() {
    const stats = summarizeTimings(samples);
    const captured = summarizeTimings(capture);
    heading.textContent = `Performance · ${stats.fps.toFixed(0)} browser FPS`;
    frames.textContent = `Last ${stats.frames} frames · p95 ${stats.p95Ms.toFixed(1)} ms · worst ${stats.maxMs.toFixed(1)} ms`;
    graph.setAttribute(
      "points",
      samples
        .slice(-120)
        .map(
          (sample, index) =>
            `${index * 2},${60 - Math.min(60, sample.frameMs)}`,
        )
        .join(" "),
    );
    slow.textContent = `Slow frames: ${stats.over33Ms} above 33 ms · ${stats.over50Ms} above 50 ms`;
    render.textContent = `Editor: ${stats.renderCalls} render calls · ${stats.meanRenderCpuMs.toFixed(2)} ms CPU/call`;
    record.textContent = recording ? "Stop recording" : "Record 30 seconds";
    report.disabled = recording || capture.length === 0;
    captureLabel.textContent = `${recording ? "Recording — move around the viewport" : "Capture"}: ${captured.frames} frames · ${captured.over50Ms} above 50 ms · worst ${captured.maxMs.toFixed(1)} ms`;
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
      update();
    }
    frame = requestAnimationFrame(tick);
  }

  function stop() {
    enabled = false;
    recording = false;
    cancelAnimationFrame(frame);
    document.removeEventListener("visibilitychange", resetBaseline);
    panel.hidden = true;
    toggle.setAttribute("aria-pressed", "false");
  }

  function resetBaseline() {
    previous = 0;
    renderCalls = 0;
    renderCpuMs = 0;
  }

  toggle.addEventListener("click", () => {
    if (enabled) {
      stop();
      return;
    }
    enabled = true;
    samples = [];
    resetBaseline();
    panel.hidden = false;
    toggle.setAttribute("aria-pressed", "true");
    document.addEventListener("visibilitychange", resetBaseline);
    update();
    frame = requestAnimationFrame(tick);
  });
  record.addEventListener("click", () => {
    if (recording) recording = false;
    else {
      capture = [];
      started = performance.now();
      recording = true;
      json.hidden = true;
      json.value = "";
    }
    update();
  });
  report.addEventListener("click", () => {
    json.value = JSON.stringify(
      {
        version: 1,
        summary: summarizeTimings(capture),
        description:
          "Visible-tab animation frame cadence and editor CPU submission timing; not GPU timings.",
        samples: capture,
      },
      null,
      2,
    );
    json.hidden = false;
  });
  window.addEventListener("pagehide", stop, { once: true });

  return {
    isEnabled: () => enabled,
    recordRender(cpuMs: number) {
      if (!enabled) return;
      renderCalls += 1;
      renderCpuMs += cpuMs;
    },
  };
}
