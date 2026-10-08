import { extname } from "path";
import mime from "mime-types";
import { fileTypeFromBuffer } from "file-type";

export const CUSTOM_MIME_TYPES: Record<string, string> = {
  // Images
  wal: "image/x-wal",
  pcx: "image/x-pcx",
  tga: "image/x-tga",
  vtf: "image/x-vtf",
  dds: "image/x-dds",

  // Archives
  bsp: "application/x-bsp",
  pak: "application/x-pak",
  pk3: "application/x-pk3",
  pk4: "application/x-pk4",
  wad: "application/x-wad",

  // Models
  mdl: "model/x-mdl",
  md2: "model/x-md2",
  md3: "model/x-md3",
  md5mesh: "model/x-md5mesh",
  md5anim: "model/x-md5anim",
  ase: "model/x-ase",
  iqm: "model/x-iqm",
  lwo: "model/x-lwo",

  // Text/config files (game-specific)
  cfg: "text/plain",
  def: "text/plain",
  mtr: "text/plain",
  script: "text/plain",
  gui: "text/plain",
  skin: "text/plain",
  sndshd: "text/plain",
  af: "text/plain",
  pda: "text/plain",
  lang: "text/plain",
  dict: "text/plain",
  fx: "text/plain",
  particle: "text/plain",
  vfp: "text/plain",
  vp: "text/plain",
  fp: "text/plain",
  glsl: "text/plain",
  vert: "text/x-glsl",
  frag: "text/x-glsl",

  // Source map formats
  map: "text/plain",
  vmf: "text/plain",
  rmf: "application/x-rmf",

  // Compiled formats
  proc: "application/x-proc",
  cm: "application/x-cm",
  aas24: "application/x-aas",
  aas32: "application/x-aas",
  aas48: "application/x-aas",
  aas32_flybot: "application/x-aas",
  aas_cat: "application/x-aas",
  aas_mech: "application/x-aas",
};

/**
 * Check if a buffer appears to be text content.
 * Looks for common text patterns and absence of binary indicators.
 */
function looksLikeText(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;

  // Sample the first 8KB max
  const sampleSize = Math.min(buffer.length, 8192);
  const sample = buffer.subarray(0, sampleSize);

  let nullCount = 0;
  let controlCount = 0;
  let printableCount = 0;

  for (let i = 0; i < sample.length; i++) {
    const byte = sample[i];

    // Null bytes are a strong binary indicator
    if (byte === 0) {
      nullCount++;
      // More than a few nulls = probably binary
      if (nullCount > 2) return false;
    }
    // Control characters (except common whitespace)
    else if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      controlCount++;
    }
    // Printable ASCII or high bytes (could be UTF-8)
    else if ((byte >= 32 && byte < 127) || byte >= 128) {
      printableCount++;
    }
  }

  // If more than 5% control characters, probably binary
  if (controlCount > sampleSize * 0.05) return false;

  // If less than 70% printable, probably binary
  if (printableCount < sampleSize * 0.7) return false;

  return true;
}

/**
 * Get MIME type for a file, using magic bytes if available
 */
export async function getMimeType(
  filename: string,
  buffer?: Buffer,
): Promise<string> {
  const ext = extname(filename).toLowerCase().slice(1);

  // Check custom mappings first (game formats we know about)
  if (CUSTOM_MIME_TYPES[ext]) {
    return CUSTOM_MIME_TYPES[ext];
  }

  // Try magic bytes if buffer provided
  if (buffer) {
    const detected = await fileTypeFromBuffer(buffer);
    if (detected) {
      return detected.mime;
    }
  }

  // Fall back to extension-based lookup
  const mimeType = mime.lookup(filename);
  if (mimeType) {
    return mimeType;
  }

  // If we have buffer content and couldn't identify it,
  // check if it looks like text
  if (buffer && looksLikeText(buffer)) {
    return "text/plain";
  }

  return "application/octet-stream";
}
