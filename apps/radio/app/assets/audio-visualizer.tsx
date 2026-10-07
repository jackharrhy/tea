import { ref, type Handle } from "remix/component";

import type { RadioClient } from "./radio-client.ts";
import { radioStyle } from "./radio-room-styles.ts";

interface AudioVisualizerProps {
  client: RadioClient | null;
  playing: boolean;
  positionSeconds: number;
}

const PREVIEW_HALF = Array.from({ length: 24 }, (_, index) => {
  return (
    15 + Math.abs(Math.sin(index * 0.63 + 0.8) * Math.cos(index * 0.21)) * 74
  );
});
const PREVIEW_BARS = [...PREVIEW_HALF.toReversed(), ...PREVIEW_HALF];

export function AudioVisualizer(handle: Handle<AudioVisualizerProps>) {
  return () => (
    <canvas
      aria-hidden="true"
      mix={[
        radioStyle.audioVisualizer,
        ref((canvas, signal) =>
          startDrawing(canvas, () => handle.props, signal),
        ),
      ]}
    />
  );
}

export function AudioVisualizerPreview(
  handle: Handle<{ hasTrack: boolean; playing: boolean }>,
) {
  return () => (
    <svg
      aria-hidden="true"
      mix={radioStyle.audioVisualizer}
      preserveAspectRatio="none"
      viewBox="0 0 1000 120"
    >
      {handle.props.hasTrack ? (
        <g fill="currentColor" opacity={handle.props.playing ? "0.2" : "0.14"}>
          {PREVIEW_BARS.map((height, index) => (
            <rect
              height={String(height)}
              key={String(index)}
              rx="6"
              width="12"
              x={String(20 + index * 20)}
              y={String((120 - height) / 2)}
            />
          ))}
        </g>
      ) : (
        <>
          <path
            d="M0 60 C100 60 120 29 225 29 S380 91 500 91 S655 29 775 29 S900 60 1000 60"
            fill="none"
            opacity="0.62"
            stroke="currentColor"
            stroke-width="2"
            vector-effect="non-scaling-stroke"
          />
          <path
            d="M0 60 C130 60 150 42 270 42 S410 78 525 78 S680 42 790 42 S910 60 1000 60"
            fill="none"
            opacity="0.22"
            stroke="currentColor"
            stroke-width="1"
            vector-effect="non-scaling-stroke"
          />
        </>
      )}
    </svg>
  );
}

function startDrawing(
  canvas: HTMLCanvasElement,
  getState: () => AudioVisualizerProps,
  signal: AbortSignal,
): void {
  let context = canvas.getContext("2d");
  if (!context) return;

  let frame = 0;
  let analyser: AnalyserNode | null = null;
  let frequencyData = new Uint8Array(0);
  let displayedBars = new Float32Array(0);
  let reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  let resize = () => {
    let bounds = canvas.getBoundingClientRect();
    let scale = Math.min(2, window.devicePixelRatio || 1);
    let width = Math.max(1, Math.round(bounds.width * scale));
    let height = Math.max(1, Math.round(bounds.height * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.setTransform(scale, 0, 0, scale, 0, 0);
  };

  let observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  let draw = (time: number) => {
    let state = getState();
    let width = canvas.clientWidth;
    let height = canvas.clientHeight;
    let color =
      getComputedStyle(canvas).getPropertyValue("--desktop-accent").trim() ||
      "#2aa7b8";

    context.clearRect(0, 0, width, height);
    let nextAnalyser = state.client?.getAnalyser() ?? null;
    if (nextAnalyser !== analyser) {
      analyser = nextAnalyser;
      frequencyData = new Uint8Array(analyser?.frequencyBinCount ?? 0);
    }
    drawBars(
      context,
      width,
      height,
      color,
      state,
      analyser,
      frequencyData,
      (nextBars) => {
        displayedBars = nextBars;
      },
      displayedBars,
      reducedMotion ? 0 : time,
    );

    frame = window.requestAnimationFrame(draw);
  };

  frame = window.requestAnimationFrame(draw);
  signal.addEventListener("abort", () => {
    observer.disconnect();
    window.cancelAnimationFrame(frame);
  });
}

function drawBars(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string,
  state: AudioVisualizerProps,
  analyser: AnalyserNode | null,
  frequencyData: Uint8Array<ArrayBuffer>,
  setDisplayedBars: (bars: Float32Array<ArrayBuffer>) => void,
  previousBars: Float32Array<ArrayBuffer>,
  time: number,
): void {
  let barCount = Math.max(20, Math.min(56, Math.floor(width / 16)));
  barCount -= barCount % 2;
  let displayedBars =
    previousBars.length === barCount
      ? previousBars
      : new Float32Array(barCount);
  if (displayedBars !== previousBars) setDisplayedBars(displayedBars);

  if (analyser && state.playing) analyser.getByteFrequencyData(frequencyData);

  let spectrum =
    analyser && state.playing
      ? sampleMirroredSpectrum(
          frequencyData,
          analyser.context.sampleRate,
          analyser.fftSize,
          barCount,
        )
      : null;
  let gap = 4;
  let barWidth = Math.max(2, (width - gap * (barCount - 1)) / barCount);
  let fill = context.createLinearGradient(0, 0, 0, height);
  fill.addColorStop(0, "transparent");
  fill.addColorStop(0.2, color);
  fill.addColorStop(0.8, color);
  fill.addColorStop(1, "transparent");
  context.fillStyle = fill;
  context.globalAlpha = state.playing ? 0.2 : 0.11;

  context.fillRect(0, height / 2 - 0.5, width, 1);

  for (let index = 0; index < barCount; index++) {
    let target = 0;
    if (spectrum) {
      target = Math.pow(spectrum[index]!, 0.74);
    } else if (!state.client) {
      let half = barCount / 2;
      let mirroredIndex = index < half ? half - 1 - index : index - half;
      let phase = state.playing ? time / 420 : state.positionSeconds * 0.75;
      target =
        0.14 +
        Math.abs(
          Math.sin(mirroredIndex * 0.71 + phase) *
            Math.cos(mirroredIndex * 0.19 - phase * 0.4),
        ) *
          (state.playing ? 0.72 : 0.34);
    } else {
      target = displayedBars[index]! * 0.985;
    }

    displayedBars[index] +=
      (target - displayedBars[index]!) * (state.playing ? 0.24 : 0.08);
    let barHeight = Math.max(2, displayedBars[index]! * height * 0.72);
    let x = index * (barWidth + gap);
    context.beginPath();
    context.roundRect(
      x,
      (height - barHeight) / 2,
      barWidth,
      barHeight,
      barWidth / 2,
    );
    context.fill();
  }

  context.globalAlpha = 1;
}

export function sampleMirroredSpectrum(
  frequencyData: Uint8Array,
  sampleRate: number,
  fftSize: number,
  barCount: number,
): Float32Array {
  let evenBarCount = Math.max(2, barCount - (barCount % 2));
  let half = evenBarCount / 2;
  let bands = new Float32Array(half);
  let spectrum = new Float32Array(evenBarCount);
  if (frequencyData.length === 0 || sampleRate <= 0 || fftSize <= 0)
    return spectrum;

  let binWidth = sampleRate / fftSize;
  let minimumFrequency = Math.max(55, binWidth);
  let maximumFrequency = Math.min(16_000, sampleRate * 0.46);
  let frequencyRange = maximumFrequency / minimumFrequency;

  for (let band = 0; band < half; band++) {
    let startFrequency = minimumFrequency * frequencyRange ** (band / half);
    let endFrequency = minimumFrequency * frequencyRange ** ((band + 1) / half);
    let startBin = Math.max(1, Math.floor(startFrequency / binWidth));
    let endBin = Math.max(startBin + 1, Math.ceil(endFrequency / binWidth));
    endBin = Math.min(frequencyData.length, endBin);

    let energy = 0;
    let samples = 0;
    for (let bin = startBin; bin < endBin; bin++) {
      let normalized = frequencyData[bin]! / 255;
      energy += normalized * normalized;
      samples++;
    }
    bands[band] = samples > 0 ? Math.sqrt(energy / samples) : 0;
  }

  for (let index = 0; index < half; index++) {
    let value = bands[index]!;
    spectrum[half - 1 - index] = value;
    spectrum[half + index] = value;
  }

  return spectrum;
}
