import { BinaryView } from "./binary.js";
import { BSP2_MAGIC } from "./quake-bsp-layout.js";
const IBSP_MAGIC = 0x50534249;
export const QBSP_MAGIC = 0x50534251;
export const BSP38_VERSION = 38;

export type BspIdentification =
  | { readonly format: "quake-bsp29"; readonly version: 29 }
  | { readonly format: "quake-bsp2"; readonly version: "BSP2" }
  | { readonly format: "goldsrc-bsp30"; readonly version: 30 }
  | { readonly format: "quake2-bsp38"; readonly version: 38 };

export function isBsp38Magic(value: number): boolean {
  return value === IBSP_MAGIC || value === QBSP_MAGIC;
}

/** Identifies supported BSP containers from their prefix without validating their contents. */
export function identifyBsp(
  input: ArrayBuffer | ArrayBufferView,
): BspIdentification | null {
  const source = new BinaryView(input);
  if (source.byteLength < 4) return null;

  const prefix = source.u32(0);
  if (isBsp38Magic(prefix)) {
    if (source.byteLength < 8 || source.u32(4) !== BSP38_VERSION) return null;
    return { format: "quake2-bsp38", version: 38 };
  }
  if (prefix === 29) return { format: "quake-bsp29", version: 29 };
  if (prefix === 30) return { format: "goldsrc-bsp30", version: 30 };
  if (prefix === BSP2_MAGIC) return { format: "quake-bsp2", version: "BSP2" };
  return null;
}
