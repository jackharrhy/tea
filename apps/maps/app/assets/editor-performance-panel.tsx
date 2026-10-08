import { clientEntry, on, type Handle } from "remix/component";
import {
  summarizeTimings,
  type PerformanceState,
} from "./editor-performance.ts";

function subscribe(handle: Handle, update: (state: PerformanceState) => void) {
  handle.queueTask(() => {
    window.addEventListener(
      "tea-maps-performance-state",
      (event) => update((event as CustomEvent<PerformanceState>).detail),
      { signal: handle.signal },
    );
    window.dispatchEvent(new Event("tea-maps-performance-ready"));
  });
}

export const EditorPerformanceToggle = clientEntry(
  `file:///app/assets/editor-performance-panel.tsx#EditorPerformanceToggle`,
  function EditorPerformanceToggleComponent(handle: Handle) {
    let enabled = false;
    subscribe(handle, (state) => {
      enabled = state.enabled;
      handle.update();
    });
    return () => (
      <button
        id="performance-toggle"
        type="button"
        aria-pressed={enabled}
        mix={on("click", () => {
          window.dispatchEvent(new Event("tea-maps-performance-toggle"));
        })}
      >
        Performance
      </button>
    );
  },
);

export const EditorPerformancePanel = clientEntry(
  `file:///app/assets/editor-performance-panel.tsx#EditorPerformancePanel`,
  function EditorPerformancePanelComponent(handle: Handle) {
    let state: PerformanceState | null = null;
    let report = "";
    handle.queueTask(() => {
      handle.signal.addEventListener(
        "abort",
        () => window.dispatchEvent(new Event("tea-maps-performance-dispose")),
        { once: true },
      );
    });
    subscribe(handle, (next) => {
      state = next;
      handle.update();
    });

    return () => {
      const samples = state?.samples ?? [];
      const capture = state?.capture ?? [];
      const stats = summarizeTimings(samples);
      const captured = summarizeTimings(capture);
      const points = samples
        .slice(-120)
        .map(
          (sample, index) =>
            `${index * 2},${60 - Math.min(60, sample.frameMs)}`,
        )
        .join(" ");

      return (
        <section
          id="performance-panel"
          aria-label="Performance diagnostics"
          hidden={!state?.enabled}
        >
          <strong id="performance-heading">
            Performance · {stats.fps.toFixed(0)} browser FPS
          </strong>
          <span id="performance-frames">
            Last {stats.frames} frames · p95 {stats.p95Ms.toFixed(1)} ms · worst{" "}
            {stats.maxMs.toFixed(1)} ms
          </span>
          <svg
            viewBox="0 0 240 60"
            role="img"
            aria-label="Frame time graph, 0 to 60 milliseconds"
          >
            <path class="performance-budget" d="M0 43.33H240 M0 26.66H240" />
            <polyline id="performance-graph" fill="none" points={points} />
          </svg>
          <span id="performance-slow">
            Slow frames: {stats.over33Ms} above 33 ms · {stats.over50Ms} above
            50 ms
          </span>
          <span id="performance-render">
            Editor: {stats.renderCalls} render calls ·{" "}
            {stats.meanRenderCpuMs.toFixed(2)} ms CPU/call
          </span>
          <small>
            Browser cadence includes idle time. Editor draws on demand. CPU
            timing excludes GPU execution. Graph guides: 16.7 / 33.3 ms.
          </small>
          <div class="performance-actions">
            <button
              id="performance-record"
              type="button"
              mix={on("click", () => {
                report = "";
                window.dispatchEvent(new Event("tea-maps-performance-record"));
              })}
            >
              {state?.recording ? "Stop recording" : "Record 30 seconds"}
            </button>
            <button
              id="performance-report"
              type="button"
              disabled={Boolean(state?.recording) || capture.length === 0}
              mix={on("click", () => {
                report = JSON.stringify(
                  {
                    version: 1,
                    summary: captured,
                    description:
                      "Visible-tab animation frame cadence and editor CPU submission timing; not GPU timings.",
                    samples: capture,
                  },
                  null,
                  2,
                );
                handle.update();
              })}
            >
              Show capture JSON
            </button>
          </div>
          <span id="performance-capture">
            {state?.recording
              ? "Recording — move around the viewport"
              : "Capture"}
            : {captured.frames} frames · {captured.over50Ms} above 50 ms · worst{" "}
            {captured.maxMs.toFixed(1)} ms
          </span>
          <textarea
            id="performance-json"
            aria-label="Performance capture JSON"
            readOnly
            hidden={!report}
            value={report}
          />
        </section>
      );
    };
  },
);
