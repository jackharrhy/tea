import {
  createDiagnostics,
  diagnosticReason,
} from "../app/ui/public/diagnostics.mjs";
import { clearStaleExports } from "./storage";
import { initAdvanced } from "./advanced";
import { clearLegacyCache } from "./legacy-cache";
import { $, num, value, setValue, bytes } from "./ui";
import {
  createIcons,
  FolderOpen,
  Film,
  Crop as CropIcon,
  Play,
  Download,
} from "lucide";
import { createPreview } from "./preview";
import {
  timeLabel,
  videoBudget,
  DEFAULT_LIMIT,
  WASM_INPUT_LIMIT,
  conversionAdvice,
  MIB,
  automaticAudioBitrate,
} from "./domain.mjs";
import type { Crop, Metadata, ExportOptions, MediaResponse } from "./types";
createIcons({
  icons: { FolderOpen, Film, Crop: CropIcon, Play, Download },
  attrs: { "aria-hidden": "true" },
});
const mediaWorker = () =>
  new Worker(new URL("./media.worker.ts", import.meta.url), { type: "module" });
const even = (n: number) =>
  Math.max(0, Math.floor((Number.isFinite(n) ? n : 0) / 2) * 2);
let file: File | undefined,
  meta: Metadata | undefined,
  inspector: Worker | undefined,
  encoder: Worker | undefined;
let resultUrl = "",
  temporary: string | undefined;
let crop: Crop | undefined,
  busy = false,
  peaks: number[] = [];
let activeKind: "edit" | "advanced" = "edit";
const diagnostics = createDiagnostics({
  context: () => ({
    bytes: file?.size,
    container: file
      ? (file.name.match(/\.(mp4|mkv|mov|webm)$/i)?.[1]?.toLowerCase() ??
        "other")
      : undefined,
    duration: meta?.duration,
    height: meta?.height,
    videoCodec: meta?.videoCodec,
    audioCodec: meta?.audioCodec,
  }),
});
const consent = $<HTMLInputElement>("diagnostics-consent");
consent.checked = diagnostics.enabled;
consent.addEventListener("change", () =>
  diagnostics.setEnabled(consent.checked),
);
setValue("target", DEFAULT_LIMIT / 1e6);
const playback = createPreview((text) => {
  error(text);
  diagnostics.report({
    stage: "preview",
    outcome: "failed",
    reason: diagnosticReason(text),
  });
}, updatePlayhead);
function updatePlayhead(time: number) {
  const position = Math.max(0, Math.min(meta?.duration ?? 0, time));
  setValue("playhead", position);
  $("current-time").textContent = `${timeLabel(position)}.${Math.floor(
    (position % 1) * 100,
  )
    .toString()
    .padStart(2, "0")}`;
}
function error(text: string) {
  $("error").textContent = text;
  $("error").hidden = !text;
}
function job(text: string) {
  if ($("status").textContent !== text) $("status").textContent = text;
}
function setBusy(next: boolean, kind: "edit" | "advanced" = "edit") {
  busy = next;
  activeKind = kind;
  $<HTMLButtonElement>("choose").disabled = next;
  $<HTMLFieldSetElement>("settings").disabled = next;
  for (const id of [
    "start",
    "end",
    "trim-start",
    "trim-end",
    "playhead",
    "crop-toggle",
    "crop-clear",
    "preview-clip",
  ])
    $<HTMLButtonElement>(id).disabled = next || !meta;
  for (const el of $("crop-fields").querySelectorAll("input"))
    el.disabled = next;
  $<HTMLButtonElement>("run-command").disabled =
    next || !file || file.size >= WASM_INPUT_LIMIT;
  $("run-command").title =
    file && file.size >= WASM_INPUT_LIMIT
      ? "Browser FFmpeg supports files below 2 GiB."
      : "";
  $<HTMLButtonElement>("export").disabled = next || !meta || !meta.decodable;
  $("cancel").hidden = !next || kind === "advanced";
}
function updateBudget() {
  $("export-label").textContent = `Make under ${num("target")} MB`;
  if (!meta) return;
  const duration = num("end") - num("start");
  $("selection-duration").textContent =
    `${Math.max(0, duration).toFixed(2)} sec selected`;
  const audioRate = meta.audioCodec
    ? value("audio") === "keep"
      ? meta.audioBitrate
      : value("audio") === "mute"
        ? 0
        : value("height") === "auto"
          ? automaticAudioBitrate(num("target") * 1e6, duration)
          : 128000
    : 0;
  try {
    $("budget").textContent =
      `${Math.round(videoBudget((num("target") * 1e6) / MIB, duration, (audioRate * duration) / 8).bitrate / 1000).toLocaleString()} kb/s${value("audio") === "keep" ? " ≈" : ""}`;
  } catch {
    $("budget").textContent = "Increase size or trim";
  }
}
function drawWaveform() {
  const canvas = $<HTMLCanvasElement>("waveform");
  const width = canvas.clientWidth,
    height = canvas.clientHeight,
    dpr = devicePixelRatio;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(
    "--muted",
  );
  const max = Math.max(0.05, ...peaks);
  for (let x = 0; x < width; x += 3) {
    const from = Math.floor((x / width) * peaks.length);
    const to = Math.min(
      peaks.length,
      Math.ceil(((x + 3) / width) * peaks.length),
    );
    let peak = 0;
    for (let i = from; i < to; i++) peak = Math.max(peak, peaks[i]);
    const h = Math.max(1, (peak / max) * (height - 14));
    ctx.fillRect(x, (height - h) / 2, 1.5, h);
  }
}
function updateTrim(seek?: number) {
  if (!meta) return;
  const start = num("start"),
    end = num("end");
  setValue("trim-start", start);
  setValue("trim-end", end);
  const selection = $("trim-selection");
  selection.style.left = `${(start / meta.duration) * 100}%`;
  selection.style.right = `${(1 - end / meta.duration) * 100}%`;
  updateBudget();
  if (seek !== undefined) void playback.seek(seek);
}
async function clearOutput() {
  if (resultUrl) {
    URL.revokeObjectURL(resultUrl);
    resultUrl = "";
  }
  $("result").hidden = true;
  $("export").classList.add("primary");
  const video = $<HTMLVideoElement>("result-video");
  video.pause();
  video.removeAttribute("src");
  video.load();
  if (temporary) {
    const name = temporary;
    temporary = undefined;
    const d = await navigator.storage.getDirectory();
    await d.removeEntry(name).catch(() => {});
  }
}
function invalidateOutput() {
  if (busy || (!resultUrl && !temporary)) return;
  void clearOutput().catch(() => {});
  job("");
  $("elapsed").textContent = "";
}
async function loadFile(next: File) {
  if (busy) {
    error(
      "Wait for the current export, or cancel it before opening another file.",
    );
    return;
  }
  if (!next.size) {
    error("This file is empty. Choose another video.");
    return;
  }
  error("");
  file = next;
  $("file-toolbar").hidden = false;
  $("trim-section").hidden = true;
  $("export-actions").hidden = false;
  $("advanced-settings").hidden = false;
  meta = undefined;
  crop = undefined;
  peaks = [];
  void clearOutput().catch(() => {});
  inspector?.terminate();
  playback.load(next);
  $("empty").hidden = true;
  $("crop-overlay").hidden = true;
  $("crop-fields").hidden = true;
  $("crop-toggle").setAttribute("aria-pressed", "false");
  $("dimensions").textContent = "Original frame";
  $("filename").textContent = next.name;
  $("file-meta").textContent = `${bytes(next.size)} · Reading video…`;
  setBusy(false);
  $("advanced-status").textContent = `Input: ${next.name}`;
  $("waveform-status").textContent = "Reading audio waveform…";
  job("Reading video…");
  $("elapsed").textContent = "";
  $("encoding-preview").hidden = true;
  updateBudget();
  drawWaveform();
  inspector = mediaWorker();
  inspector.addEventListener("error", () => {
    error(`The media worker stopped. ${conversionAdvice(next.size)}`);
    diagnostics.report({
      stage: "inspect",
      outcome: "failed",
      reason: "worker-stopped",
    });
  });
  inspector.addEventListener(
    "message",
    (event: MessageEvent<MediaResponse>) => {
      const message = event.data;
      if (message.type === "metadata") {
        meta = message.metadata;
        if (!meta.decodable)
          diagnostics.report({
            stage: "inspect",
            outcome: "failed",
            reason: "unsupported-codec",
          });
        $("trim-section").hidden = false;
        $("file-meta").textContent =
          `${meta.width} × ${meta.height} · ${timeLabel(meta.duration)} · ${bytes(next.size)}`;
        for (const id of ["start", "end", "trim-start", "trim-end", "playhead"])
          $<HTMLInputElement>(id).max = String(meta.duration);
        setValue("start", 0);
        setValue("end", meta.duration.toFixed(3));
        $("timeline-end").textContent = timeLabel(meta.duration);
        $<HTMLSelectElement>("audio").disabled = !meta.audioCodec;
        setBusy(busy, activeKind);
        updateTrim();
        updatePlayhead(0);
        job(
          meta.decodable
            ? ""
            : `Source codec unavailable in this browser. ${conversionAdvice(next.size)}`,
        );
        if (!meta.decodable) {
          $<HTMLButtonElement>("export").disabled = true;
        }
      } else if (message.type === "waveform") {
        peaks = message.peaks;
        drawWaveform();
      } else if (message.type === "waveform-status")
        $("waveform-status").textContent =
          message.text === "No audio track." ? "" : message.text;
      else if (message.type === "error") {
        diagnostics.report({
          stage: meta ? "waveform" : "inspect",
          outcome: "failed",
          reason: diagnosticReason(message.text),
        });
        if (meta)
          $("waveform-status").textContent =
            `Waveform unavailable: ${message.text}`;
        else {
          error(message.text);
          job(conversionAdvice(next.size));
          $("file-meta").textContent = bytes(next.size);
        }
      }
    },
  );
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Worker messages have no targetOrigin argument.
  inspector.postMessage({ type: "inspect", file: next });
}
for (const id of ["choose", "empty-choose"])
  $(id).addEventListener("click", () => $<HTMLInputElement>("file").click());
$("file").addEventListener("change", () => {
  const input = $<HTMLInputElement>("file");
  if (input.files?.[0]) void loadFile(input.files[0]);
  input.value = "";
});
const preview = $("preview");
preview.addEventListener("dragover", (e) => {
  e.preventDefault();
  preview.classList.add("dragover");
});
preview.addEventListener("dragleave", () =>
  preview.classList.remove("dragover"),
);
preview.addEventListener("drop", (e) => {
  e.preventDefault();
  preview.classList.remove("dragover");
  if (e.dataTransfer?.files[0]) void loadFile(e.dataTransfer.files[0]);
});
for (const id of ["start", "end", "trim-start", "trim-end"])
  $(id).addEventListener("input", () => {
    if (!meta) return;
    const startChanged = id === "start" || id === "trim-start";
    let n = num(id);
    if (!Number.isFinite(n)) return;
    n = Math.max(0, Math.min(meta.duration, n));
    if (startChanged) setValue("start", Math.min(n, num("end") - 0.05));
    else setValue("end", Math.max(n, num("start") + 0.05));
    invalidateOutput();
    updateTrim(
      startChanged ? num("start") : Math.max(num("start"), num("end") - 0.05),
    );
  });
for (const id of ["target", "format", "audio", "height", "fps"])
  $(id).addEventListener("input", () => {
    invalidateOutput();
    updateBudget();
  });
$("preview-clip").addEventListener("click", () => {
  if (meta) void playback.play(num("start"), num("end"));
});
$("playhead").addEventListener("input", () => {
  if (meta && !busy) void playback.seek(num("playhead"));
});
const timeline = $("timeline");
let scrubbing = false;
function scrub(event: PointerEvent) {
  if (!meta) return;
  const rect = timeline.getBoundingClientRect();
  void playback.seek(
    Math.max(
      0,
      Math.min(
        meta.duration,
        ((event.clientX - rect.left) / rect.width) * meta.duration,
      ),
    ),
  );
}
timeline.addEventListener("pointerdown", (event) => {
  if (!meta || busy || event.target instanceof HTMLInputElement) return;
  scrubbing = true;
  timeline.setPointerCapture(event.pointerId);
  event.preventDefault();
  scrub(event);
});
timeline.addEventListener("pointermove", (event) => {
  if (scrubbing) scrub(event);
});
for (const event of ["pointerup", "pointercancel"])
  timeline.addEventListener(event, () => {
    scrubbing = false;
  });
function fittedRect() {
  const r = preview.getBoundingClientRect();
  const scale = Math.min(r.width / meta!.width, r.height / meta!.height);
  return {
    left: (r.width - meta!.width * scale) / 2,
    top: (r.height - meta!.height * scale) / 2,
    scale,
  };
}
function drawCrop() {
  if (!meta || !crop) return;
  const r = fittedRect();
  const box = $("crop-box");
  Object.assign(box.style, {
    left: `${r.left + crop.left * r.scale}px`,
    top: `${r.top + crop.top * r.scale}px`,
    width: `${crop.width * r.scale}px`,
    height: `${crop.height * r.scale}px`,
  });
  for (const [id, n] of Object.entries({
    "crop-x": crop.left,
    "crop-y": crop.top,
    "crop-w": crop.width,
    "crop-h": crop.height,
  }))
    setValue(id, n);
  $("dimensions").textContent = `${crop.width} × ${crop.height} crop`;
}
$("crop-toggle").addEventListener("click", () => {
  if (!meta) return;
  invalidateOutput();
  const active = $("crop-overlay").hidden;
  $("crop-overlay").hidden = !active;
  $("crop-fields").hidden = !active;
  $("crop-toggle").setAttribute("aria-pressed", String(active));
  playback.pause();
  if (active) {
    crop ??= {
      left: 0,
      top: 0,
      width: Math.floor(meta.width / 2) * 2,
      height: Math.floor(meta.height / 2) * 2,
    };
    drawCrop();
  }
});
$("crop-clear").addEventListener("click", () => {
  invalidateOutput();
  crop = undefined;
  $("crop-overlay").hidden = true;
  $("crop-fields").hidden = true;
  $("crop-toggle").setAttribute("aria-pressed", "false");
  $("dimensions").textContent = "Original frame";
});
for (const id of ["crop-x", "crop-y", "crop-w", "crop-h"])
  $(id).addEventListener("change", () => {
    if (!meta || !crop) return;
    invalidateOutput();
    crop = {
      left: Math.min(meta.width - 2, even(num("crop-x"))),
      top: Math.min(meta.height - 2, even(num("crop-y"))),
      width: even(num("crop-w")),
      height: even(num("crop-h")),
    };
    crop.width = Math.max(
      2,
      Math.min(crop.width, Math.floor((meta.width - crop.left) / 2) * 2),
    );
    crop.height = Math.max(
      2,
      Math.min(crop.height, Math.floor((meta.height - crop.top) / 2) * 2),
    );
    drawCrop();
  });
let cropOrigin: { x: number; y: number } | undefined;
function cropPoint(e: PointerEvent) {
  const rect = preview.getBoundingClientRect(),
    r = fittedRect();
  return {
    x: Math.max(
      0,
      Math.min(
        meta!.width - 2,
        Math.floor((e.clientX - rect.left - r.left) / r.scale / 2) * 2,
      ),
    ),
    y: Math.max(
      0,
      Math.min(
        meta!.height - 2,
        Math.floor((e.clientY - rect.top - r.top) / r.scale / 2) * 2,
      ),
    ),
  };
}
$("crop-overlay").addEventListener("pointerdown", (e) => {
  if (!meta || busy) return;
  cropOrigin = cropPoint(e);
  $("crop-overlay").setPointerCapture(e.pointerId);
  e.preventDefault();
});
$("crop-overlay").addEventListener("pointermove", (e) => {
  if (!cropOrigin || !meta) return;
  const p = cropPoint(e);
  invalidateOutput();
  crop = {
    left: Math.min(p.x, cropOrigin.x),
    top: Math.min(p.y, cropOrigin.y),
    width: Math.max(2, Math.abs(p.x - cropOrigin.x)),
    height: Math.max(2, Math.abs(p.y - cropOrigin.y)),
  };
  drawCrop();
});
for (const event of ["pointerup", "pointercancel"])
  $("crop-overlay").addEventListener(event, () => {
    cropOrigin = undefined;
  });
new ResizeObserver(() => {
  drawWaveform();
  drawCrop();
}).observe(preview);
matchMedia("(prefers-color-scheme:dark)").addEventListener(
  "change",
  drawWaveform,
);
async function exportVideo() {
  const automatic = value("height") === "auto";
  if (!file || !meta || busy) return;
  error("");
  playback.pause();
  const options: ExportOptions = {
    start: num("start"),
    end: num("end"),
    target: (num("target") * 1e6) / MIB,
    format: value("format") as ExportOptions["format"],
    audio: value("audio") as ExportOptions["audio"],
    height: automatic ? 0 : num("height"),
    fps: num("fps"),
    automatic,
    preview: true,
    crop,
  };
  if (
    !Number.isFinite(options.target) ||
    num("target") < 0.1 ||
    num("target") > 4096
  ) {
    error("Choose a target size between 0.1 and 4096 MB.");
    return;
  }
  setBusy(true);
  try {
    await clearOutput();
  } catch (e) {
    setBusy(false);
    error(
      `Could not clear the previous export. Reload and try again. ${String(e)}`,
    );
    return;
  }
  job("Preparing export…");
  $("elapsed").textContent = "";
  const begun = performance.now();
  const reportOutcome = (
    outcome: "succeeded" | "failed" | "cancelled",
    reason: string,
  ) =>
    diagnostics.report({
      stage: "export",
      outcome,
      reason,
      elapsedSeconds: (performance.now() - begun) / 1000,
    });
  const timer = setInterval(() => {
    $("elapsed").textContent =
      `${timeLabel((performance.now() - begun) / 1000)} elapsed`;
  }, 1000);
  $("encoding-preview").hidden = true;
  $("encode-position").style.width = "0";
  $("encode-position").setAttribute("aria-valuenow", "0");
  $("encode-position").hidden = false;
  encoder?.terminate();
  encoder = mediaWorker();
  const finish = () => {
    clearInterval(timer);
    $("encode-position").hidden = true;
    $("encoding-preview").hidden = true;
    setBusy(false);
  };
  encoder.addEventListener("error", (e) => {
    finish();
    reportOutcome("failed", "worker-stopped");
    error(`The export stopped unexpectedly. Please retry. ${e.message}`);
    job("Export failed.");
  });
  encoder.addEventListener("message", (event: MessageEvent<MediaResponse>) => {
    const m = event.data;
    if (m.type === "progress") {
      job(m.text);
      const range = num("end") - num("start");
      const position = $("encode-position");
      position.style.left = `${(num("start") / meta!.duration) * 100}%`;
      position.style.width = `${(range / meta!.duration) * m.progress * 100}%`;
      position.setAttribute(
        "aria-valuenow",
        String(Math.round(m.progress * 100)),
      );
      position.setAttribute("aria-valuetext", m.text);
    } else if (m.type === "encoding-frame") {
      const canvas = $<HTMLCanvasElement>("encoder-frame");
      canvas.width = m.bitmap.width;
      canvas.height = m.bitmap.height;
      canvas.getContext("2d")!.drawImage(m.bitmap, 0, 0);
      m.bitmap.close();
      $("encoder-time").textContent = `Encoding frame · ${timeLabel(m.time)}`;
      $("encoding-preview").hidden = false;
    } else if (m.type === "done") {
      finish();
      reportOutcome("succeeded", "none");
      temporary = m.temporary;
      resultUrl = URL.createObjectURL(m.blob);
      const a = $<HTMLAnchorElement>("download");
      a.href = resultUrl;
      a.download = m.name;
      $<HTMLVideoElement>("result-video").src = resultUrl;
      $("result-size").textContent =
        `${(m.blob.size / 1e6).toFixed(2)} MB${m.width ? ` · ${m.width} × ${m.height}` : ""}`;
      $("result").hidden = false;
      $("export").classList.remove("primary");
      $("encoding-preview").hidden = true;
      job(
        m.unchanged ? `Already under ${num("target")} MB.` : "Ready to save.",
      );
    } else if (m.type === "error") {
      finish();
      reportOutcome("failed", diagnosticReason(m.text));
      error(m.text);
      job("Export failed.");
    } else if (m.type === "cancelled") {
      finish();
      reportOutcome("cancelled", "none");
      job("Export cancelled.");
    }
  });
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Worker messages have no targetOrigin argument.
  encoder.postMessage({ type: "export", file, options });
}
$("export").addEventListener("click", () => void exportVideo());
$("cancel").addEventListener("click", () => {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Worker messages have no targetOrigin argument.
  encoder?.postMessage({ type: "cancel" });
  job("Cancelling…");
  $<HTMLButtonElement>("cancel").disabled = true;
  setTimeout(() => {
    $<HTMLButtonElement>("cancel").disabled = false;
  }, 1000);
});
initAdvanced({
  getFile: () => file,
  isBusy: () => busy,
  setBusy: (next) => setBusy(next, "advanced"),
  showError: error,
  onDiagnostic: (outcome, reason, elapsedSeconds) =>
    diagnostics.report({ stage: "ffmpeg", outcome, reason, elapsedSeconds }),
});
addEventListener("beforeunload", (e) => {
  if (busy) {
    e.preventDefault();
  }
});
void clearLegacyCache();

void clearStaleExports();
