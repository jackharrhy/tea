import { BinaryView } from "./binary.js";
import { invalidData, invariant } from "./errors.js";
import { validateTextureDimensions } from "./texture-limits.js";

export interface DecodedTga {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export function decodeTga(input: ArrayBuffer | ArrayBufferView): DecodedTga {
  const source = new BinaryView(input);
  invariant(source.byteLength >= 18, "TGA header is truncated");
  const idLength = source.u8(0);
  invariant(source.u8(1) === 0, "color-mapped TGA images are not supported");
  const imageType = source.u8(2);
  invariant(
    imageType === 2 || imageType === 10,
    `unsupported TGA image type ${imageType}`,
  );
  const width = source.u16(12);
  const height = source.u16(14);
  validateTextureDimensions(width, height, "TGA");
  const pixelDepth = source.u8(16);
  invariant(
    pixelDepth === 24 || pixelDepth === 32,
    `unsupported TGA depth ${pixelDepth}`,
  );
  const descriptor = source.u8(17);
  const bytesPerPixel = pixelDepth / 8;
  const pixelCount = width * height;
  let offset = 18 + idLength;
  source.require(offset, 0, "TGA image data");
  const rgba = new Uint8Array(pixelCount * 4);
  let decoded = 0;

  const writePixel = (sourceOffset: number, pixelIndex: number): void => {
    source.require(sourceOffset, bytesPerPixel, "TGA pixel");
    const sourceX = pixelIndex % width;
    const sourceY = Math.floor(pixelIndex / width);
    const destinationX = descriptor & 0x10 ? width - sourceX - 1 : sourceX;
    const destinationY = descriptor & 0x20 ? sourceY : height - sourceY - 1;
    const destination = (destinationY * width + destinationX) * 4;
    rgba[destination] = source.u8(sourceOffset + 2);
    rgba[destination + 1] = source.u8(sourceOffset + 1);
    rgba[destination + 2] = source.u8(sourceOffset);
    rgba[destination + 3] =
      bytesPerPixel === 4 ? source.u8(sourceOffset + 3) : 255;
  };

  if (imageType === 2) {
    source.require(offset, pixelCount * bytesPerPixel, "TGA image data");
    while (decoded < pixelCount) {
      writePixel(offset, decoded);
      offset += bytesPerPixel;
      decoded += 1;
    }
  } else {
    while (decoded < pixelCount) {
      source.require(offset, 1, "TGA RLE packet");
      const packet = source.u8(offset++);
      const count = (packet & 0x7f) + 1;
      invariant(
        decoded + count <= pixelCount,
        "TGA RLE packet exceeds the image bounds",
      );
      if (packet & 0x80) {
        source.require(offset, bytesPerPixel, "TGA RLE pixel");
        for (let index = 0; index < count; index += 1) {
          writePixel(offset, decoded);
          decoded += 1;
        }
        offset += bytesPerPixel;
      } else {
        source.require(offset, count * bytesPerPixel, "TGA raw packet");
        for (let index = 0; index < count; index += 1) {
          writePixel(offset, decoded);
          offset += bytesPerPixel;
          decoded += 1;
        }
      }
    }
  }

  if (decoded !== pixelCount) invalidData("TGA pixel data is incomplete");
  return { width, height, rgba };
}
