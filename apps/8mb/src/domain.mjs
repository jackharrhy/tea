export const MIB = 1024 * 1024;
export const WASM_INPUT_LIMIT = 2 * 1024 ** 3;
export function conversionAdvice(fileSize) {
  return fileSize >= WASM_INPUT_LIMIT
    ? "This file is too large for browser FFmpeg. Use desktop HandBrake or FFmpeg."
    : "Try FFmpeg in Advanced.";
}
export async function supportedVideoBitrate(requested, supports) {
  if (await supports(requested)) return requested;
  let upper = requested;
  let lower = Math.floor(requested / 2);
  while (lower >= 10000 && !(await supports(lower))) {
    upper = lower;
    lower = Math.floor(lower / 2);
  }
  if (lower < 10000) return null;
  for (let i = 0; i < 6; i++) {
    const middle = Math.floor((lower + upper) / 2);
    if (await supports(middle)) lower = middle;
    else upper = middle;
  }
  return lower;
}
export function calibratedVideoBitrate(bitrate, size, limit, audioBytes) {
  if (size < limit * 0.6 || size >= limit * 0.88) return null;
  const ratio = (limit * 0.96 - audioBytes) / Math.max(1, size - audioBytes);
  return Math.floor(bitrate * Math.min(1.5, ratio));
}
export function encoderRateStalled(previous, bitrate, size) {
  return (
    previous && bitrate < previous.bitrate * 0.8 && size > previous.size * 0.95
  );
}
export function videoBudget(targetMiB, duration, audioBytes) {
  if (
    ![targetMiB, duration, audioBytes].every(Number.isFinite) ||
    targetMiB <= 0 ||
    duration <= 0 ||
    audioBytes < 0
  )
    throw new Error("Enter a positive size and a valid clip range.");
  const bytes = Math.floor(targetMiB * MIB);
  const video = ((bytes * 0.94 - audioBytes) * 8) / duration;
  if (video < 10000)
    throw new Error(
      "The audio and clip length exceed this size budget. Increase the target size, shorten the clip, or compress/remove audio.",
    );
  return { bytes, bitrate: Math.floor(video) };
}
export function parseCommand(command, inputPath) {
  const args = [];
  let token = "";
  let quote = "";
  let escaped = false;
  let started = false;
  for (const char of command.trim()) {
    if (escaped) {
      token += char;
      escaped = false;
      started = true;
    } else if (char === "\\" && quote !== "'") {
      escaped = true;
      started = true;
    } else if (quote) {
      if (char === quote) quote = "";
      else token += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) {
        args.push(token);
        token = "";
        started = false;
      }
    } else {
      token += char;
      started = true;
    }
  }
  if (quote || escaped)
    throw new Error("Close the quotes or finish the escape in your command.");
  if (started) args.push(token);
  if (args[0] === "ffmpeg") args.shift();
  if (!args.length)
    throw new Error("Enter FFmpeg arguments and an output filename.");
  const replaced = args.map((x) => (x === "input.ext" ? inputPath : x));
  if (!replaced.includes("-i")) replaced.unshift("-i", inputPath);
  const output = replaced.at(-1);
  if (
    !output ||
    output.startsWith("-") ||
    output.includes("/") ||
    output === "input.ext" ||
    !/^[\w .-]+\.[a-z0-9]+$/i.test(output)
  )
    throw new Error(
      "End the command with a simple output filename, such as output.mp4.",
    );
  return { args: replaced, output };
}
export function timeLabel(seconds) {
  const s = Math.max(0, seconds || 0);
  return `${Math.floor(s / 60)}:${Math.floor(s % 60)
    .toString()
    .padStart(2, "0")}`;
}

export const DEFAULT_LIMIT = 8_000_000;
export function fitDimensions(width, height, scale) {
  return {
    width: Math.max(2, Math.floor((width * Math.min(1, scale)) / 2) * 2),
    height: Math.max(2, Math.floor((height * Math.min(1, scale)) / 2) * 2),
  };
}
export function automaticDimensions(width, height, bitrate, fps) {
  // Estimate a starting pixel budget; actual encoded bytes decide subsequent adjustments.
  const pixels = bitrate / (Math.max(15, Math.min(60, fps || 30)) * 0.07);
  return fitDimensions(
    width,
    height,
    Math.min(
      1,
      1920 / Math.max(width, height),
      Math.sqrt(pixels / (width * height)),
    ),
  );
}
export function smallerDimensions(width, height, ratio = 0.75) {
  if (Math.min(width, height) <= 96) return null;
  return fitDimensions(
    width,
    height,
    Math.max(96 / Math.min(width, height), Math.min(0.8, ratio)),
  );
}

export function automaticAudioBitrate(limit, duration) {
  return Math.min(
    128000,
    Math.max(
      16000,
      Math.floor((((limit * 8) / duration) * 0.16) / 1000) * 1000,
    ),
  );
}
