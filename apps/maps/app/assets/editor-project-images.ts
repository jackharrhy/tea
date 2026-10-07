import { decodeTga, validateTextureDimensions } from "@tea/maps-renderer/core";

const imageExtension = /\.(png|jpe?g|tga)$/i;

export function projectMaterialName(logicalPath: string): string | null {
  const match = /^textures\/(.+)\.(?:wal|png|jpe?g|tga)$/i.exec(logicalPath);
  return match?.[1]?.toLowerCase() ?? null;
}

export async function decodeProjectMaterialImage(
  logicalPath: string,
  bytes: ArrayBuffer,
): Promise<{ width: number; height: number; rgba: Uint8Array }> {
  const extension = imageExtension.exec(logicalPath)?.[1]?.toLowerCase();
  if (!extension) throw new Error(`${logicalPath} is not a material image`);
  if (extension === "tga") return decodeTga(bytes);
  if (typeof createImageBitmap !== "function") {
    throw new Error(`${logicalPath} needs browser image decoding support`);
  }
  const bitmap = await createImageBitmap(
    new Blob([bytes], {
      type: extension === "png" ? "image/png" : "image/jpeg",
    }),
  );
  try {
    validateTextureDimensions(bitmap.width, bitmap.height, logicalPath);
    const canvas =
      typeof OffscreenCanvas === "function"
        ? new OffscreenCanvas(bitmap.width, bitmap.height)
        : Object.assign(document.createElement("canvas"), {
            width: bitmap.width,
            height: bitmap.height,
          });
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error(`${logicalPath} could not decode pixels`);
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return {
      width: bitmap.width,
      height: bitmap.height,
      rgba: new Uint8Array(pixels.data),
    };
  } finally {
    bitmap.close();
  }
}
