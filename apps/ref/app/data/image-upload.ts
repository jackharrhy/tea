export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;

const MIME_SIGNATURES: {
  type: string;
  matches: (bytes: Uint8Array) => boolean;
}[] = [
  {
    type: "image/png",
    matches: (b) => b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71,
  },
  {
    type: "image/jpeg",
    matches: (b) => b[0] === 255 && b[1] === 216 && b[2] === 255,
  },
  {
    type: "image/gif",
    matches: (b) => b[0] === 71 && b[1] === 73 && b[2] === 70 && b[3] === 56,
  },
  {
    type: "image/webp",
    matches: (b) =>
      b[0] === 82 &&
      b[1] === 73 &&
      b[2] === 70 &&
      b[3] === 70 &&
      b[8] === 87 &&
      b[9] === 69 &&
      b[10] === 66 &&
      b[11] === 80,
  },
];

export async function imageType(
  file: File,
  limit: number,
): Promise<string | null> {
  if (file.size === 0 || file.size > limit) return null;
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return MIME_SIGNATURES.find((entry) => entry.matches(header))?.type ?? null;
}
