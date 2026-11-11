const PREFERENCE = "8mb-diagnostics";
const fields = {
  browser: ["edge", "chrome", "firefox", "safari", "other"],
  os: ["windows", "macos", "linux", "android", "ios", "other"],
  input: [
    "under-128m",
    "128-512m",
    "512m-2g",
    "2-8g",
    "8-32g",
    "32-64g",
    "64g-plus",
    "unknown",
  ],
  duration: ["under-1m", "1-10m", "10-60m", "1-3h", "3h-plus", "unknown"],
  resolution: [
    "480p",
    "720p",
    "1080p",
    "1440p",
    "2160p",
    "over-2160p",
    "unknown",
  ],
  container: ["mp4", "mkv", "mov", "webm", "other", "unknown"],
  video: ["avc", "hevc", "vp8", "vp9", "av1", "other", "unknown"],
  audio: [
    "aac",
    "opus",
    "mp3",
    "vorbis",
    "flac",
    "pcm",
    "none",
    "other",
    "unknown",
  ],
  stage: ["inspect", "preview", "waveform", "export", "ffmpeg"],
  outcome: ["succeeded", "failed", "cancelled"],
  reason: [
    "none",
    "unsupported-codec",
    "unreadable-input",
    "budget-limit",
    "storage-unavailable",
    "output-buffer",
    "encode-failed",
    "worker-stopped",
    "unclassified",
  ],
  elapsed: [
    "under-1s",
    "1-5s",
    "5-30s",
    "30-120s",
    "120-600s",
    "600s-plus",
    "unknown",
  ],
};
const keys = ["schema", ...Object.keys(fields)];
export function validateDiagnostic(value) {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key)) &&
    value.schema === 1 &&
    Object.entries(fields).every(([key, values]) => values.includes(value[key]))
  );
}
function bucket(value, bounds, labels) {
  if (!Number.isFinite(value) || value < 0) return "unknown";
  return labels[bounds.findIndex((bound) => value < bound)] ?? labels.at(-1);
}
function choice(field, value) {
  return value === undefined
    ? "unknown"
    : fields[field].includes(value)
      ? value
      : "other";
}
function eventData(context, event, agent) {
  const browser = /Edg\//.test(agent)
    ? "edge"
    : /Chrome\//.test(agent)
      ? "chrome"
      : /Firefox\//.test(agent)
        ? "firefox"
        : /Safari\//.test(agent)
          ? "safari"
          : "other";
  const os = /Android/.test(agent)
    ? "android"
    : /iPhone|iPad/.test(agent)
      ? "ios"
      : /Windows/.test(agent)
        ? "windows"
        : /Macintosh/.test(agent)
          ? "macos"
          : /Linux/.test(agent)
            ? "linux"
            : "other";
  return {
    schema: 1,
    browser,
    os,
    input: bucket(
      context.bytes,
      [128e6, 512e6, 2e9, 8e9, 32e9, 64e9],
      fields.input.slice(0, -1),
    ),
    duration: bucket(
      context.duration,
      [60, 600, 3600, 10800],
      fields.duration.slice(0, -1),
    ),
    resolution: bucket(
      context.height,
      [481, 721, 1081, 1441, 2161],
      fields.resolution.slice(0, -1),
    ),
    container: choice("container", context.container),
    video: choice("video", context.videoCodec),
    audio:
      context.audioCodec === null
        ? "none"
        : choice("audio", context.audioCodec),
    stage: event.stage,
    outcome: event.outcome,
    reason: event.reason,
    elapsed: bucket(
      event.elapsedSeconds,
      [1, 5, 30, 120, 600],
      fields.elapsed.slice(0, -1),
    ),
  };
}
export function diagnosticReason(text) {
  if (/codec/i.test(text)) return "unsupported-codec";
  if (/read|format|notfound|notallowed/i.test(text)) return "unreadable-input";
  if (
    /audio and clip length|too long to fit|fixed settings do not fit|usable resolution/i.test(
      text,
    )
  )
    return "budget-limit";
  if (/storage|quota|opfs/i.test(text)) return "storage-unavailable";
  if (/buffer limit/i.test(text)) return "output-buffer";
  if (/encod/i.test(text)) return "encode-failed";
  return "unclassified";
}
export function createDiagnostics({
  context,
  storage = null,
  request = globalThis.fetch,
  agent = () => globalThis.navigator?.userAgent ?? "",
  now = Date.now,
}) {
  let enabled = false,
    pending,
    count = 0,
    windowStart = now();
  try {
    storage ??= globalThis.localStorage;
    if (storage?.getItem(PREFERENCE) === "true") {
      storage.setItem(PREFERENCE, "true");
      enabled = true;
    }
  } catch {}
  function setEnabled(value) {
    enabled = value === true;
    if (!enabled && pending) {
      clearTimeout(pending.timer);
      pending.controller.abort();
      pending = undefined;
    }
    try {
      if (enabled) storage?.setItem(PREFERENCE, "true");
      else storage?.removeItem(PREFERENCE);
    } catch {}
  }
  function report(event) {
    if (!enabled || pending) return;
    if (now() - windowStart >= 60000) {
      windowStart = now();
      count = 0;
    }
    if (count >= 6) return;
    try {
      const data = eventData(context(), event, agent());
      if (!validateDiagnostic(data)) return;
      const controller = new AbortController();
      const active = {
        controller,
        timer: setTimeout(() => {
          controller.abort();
          if (pending === active) pending = undefined;
        }, 3000),
      };
      pending = active;
      count++;
      Promise.resolve(
        request("/8mb/api/diagnostics", {
          method: "POST",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          mode: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
          signal: controller.signal,
        }),
      )
        .catch(() => {})
        .finally(() => {
          clearTimeout(active.timer);
          if (pending === active) pending = undefined;
        });
    } catch {
      if (pending) {
        clearTimeout(pending.timer);
        pending.controller.abort();
        pending = undefined;
      }
    }
  }
  return {
    get enabled() {
      return enabled;
    },
    setEnabled,
    report,
  };
}
