import { BinaryView } from "./binary.js";
import { invariant } from "./errors.js";

const PCX_HEADER_SIZE = 128;
const PCX_PALETTE_MARKER = 0x0c;
const PCX_PALETTE_SIZE = 256 * 3;

/** Reads the trailing 256-color palette used by Quake II's `pics/colormap.pcx`. */
export function readPcxPalette(
  input: ArrayBuffer | ArrayBufferView,
): Uint8Array {
  const source = new BinaryView(input);
  invariant(
    source.byteLength >= PCX_HEADER_SIZE + 1 + PCX_PALETTE_SIZE,
    "PCX file is too small to contain a 256-color palette",
  );
  invariant(source.u8(0) === 0x0a, "PCX file has an invalid manufacturer byte");
  invariant(source.u8(2) === 1, "PCX file does not use RLE encoding");
  invariant(source.u8(3) === 8, "PCX file does not use 8-bit color planes");
  invariant(source.u8(65) === 1, "PCX file does not contain one color plane");
  const markerOffset = source.byteLength - PCX_PALETTE_SIZE - 1;
  invariant(
    source.u8(markerOffset) === PCX_PALETTE_MARKER,
    "PCX file does not contain a trailing 256-color palette",
  );
  return source.uint8Array(markerOffset + 1, PCX_PALETTE_SIZE).slice();
}
