import { layoutWithLines, prepareWithSegments } from "@chenglou/pretext";

import { DESKTOP_FONT_FAMILY } from "../ui/desktop/theme.ts";

const TEXT_FONT = `14px ${DESKTOP_FONT_FAMILY}`;

export interface TextSurfaces {
  nowPlaying: number;
  queueTrack: number;
}

export function getTextSurfaces(viewportWidth: number): TextSurfaces {
  let shell = Math.min(960, Math.max(320, viewportWidth - 32));
  let hasSidePanel = shell > 820;
  let queue = hasSidePanel ? shell - 240 - 32 : shell - 28;
  return {
    nowPlaying:
      viewportWidth <= 560
        ? Math.max(180, shell - 112)
        : Math.max(220, shell - 48),
    queueTrack: Math.max(160, queue - 88),
  };
}

export function getMaxTitleFontSize(width: number): number {
  return width <= 480 ? 22 : 34;
}

export function fitFontSize(
  text: string,
  width: number,
  maxSize: number,
  minSize: number,
): number {
  let normalized = normalizeText(text);
  if (normalized.length === 0 || width <= 0 || !canMeasureText())
    return maxSize;

  for (let size = maxSize; size >= minSize; size--) {
    let prepared = prepareWithSegments(
      normalized,
      `${size}px ${DESKTOP_FONT_FAMILY}`,
    );
    let laidOut = layoutWithLines(prepared, width * 0.92, size);
    if (laidOut.lineCount <= 1) return size;
  }

  return minSize;
}

export function fitText(
  text: string,
  width: number,
  maxLines: number,
  font = TEXT_FONT,
): string {
  let normalized = normalizeText(text);
  if (normalized.length === 0 || width <= 0 || !canMeasureText())
    return normalized;

  let prepared = prepareWithSegments(normalized, font);
  let laidOut = layoutWithLines(prepared, width, 26);
  if (laidOut.lineCount <= maxLines) return normalized;

  let visible = laidOut.lines
    .slice(0, maxLines)
    .map((line) => line.text.trim())
    .join(" ");
  return fitSingleLine(`${normalizeText(visible)}...`, width, maxLines, font);
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function fitSingleLine(
  text: string,
  width: number,
  maxLines: number,
  font: string,
): string {
  let low = 0;
  let high = text.length;
  let best = text;

  while (low <= high) {
    let middle = Math.floor((low + high) / 2);
    let candidate =
      middle >= text.length
        ? text
        : `${text.slice(0, Math.max(0, middle - 3)).trimEnd()}...`;
    let prepared = prepareWithSegments(candidate, font);
    let laidOut = layoutWithLines(prepared, width, 26);
    if (laidOut.lineCount <= maxLines) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return best;
}

function canMeasureText(): boolean {
  return (
    typeof OffscreenCanvas !== "undefined" ||
    (typeof document !== "undefined" &&
      typeof document.createElement === "function")
  );
}
