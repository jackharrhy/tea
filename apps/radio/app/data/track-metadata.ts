const MAX_UPLOAD_SIZE_BYTES = 1024 * 1024 * 1024;

const allowedMediaTypes = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/ogg",
  "audio/webm",
  "audio/mp4",
  "audio/aac",
  "audio/flac",
  "video/webm",
]);

export type UploadMetadata = {
  name: string;
  mediaType: string;
  sizeBytes: number;
};

export function parseUploadMetadata(value: unknown): UploadMetadata | null {
  if (!value || typeof value !== "object") return null;
  let input = value as Record<string, unknown>;
  if (
    typeof input.name !== "string" ||
    typeof input.mediaType !== "string" ||
    typeof input.sizeBytes !== "number"
  ) {
    return null;
  }
  return {
    name: input.name,
    mediaType: input.mediaType,
    sizeBytes: input.sizeBytes,
  };
}

export function validateUploadMetadata(input: UploadMetadata): string | null {
  if (!input.name.trim()) return "Missing filename";
  if (!trackTitleFromFilename(input.name)) return "Track title is required";
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0)
    return "File is empty";
  if (input.sizeBytes > MAX_UPLOAD_SIZE_BYTES) return "File is too large";
  if (input.mediaType && !allowedMediaTypes.has(input.mediaType))
    return "Unsupported audio type";
  return null;
}

export function trackTitleFromFilename(value: string): string {
  let filename = value.split(/[\\/]/).at(-1) ?? value;
  let dot = filename.lastIndexOf(".");
  return normalizeTrackTitle(dot > 0 ? filename.slice(0, dot) : filename);
}

export function normalizeTrackTitle(value: string): string {
  return Array.from(
    value
      .normalize("NFKC")
      .replace(/\p{Cc}/gu, "")
      .replace(/[/\\]/g, "-")
      .replace(/\s+/g, " ")
      .trim(),
  )
    .slice(0, 120)
    .join("");
}
