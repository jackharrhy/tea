/*
 * WAD directory behavior adapted from noclip.website's Common/IdTech2/WAD.ts.
 * See THIRD_PARTY_NOTICES.md and docs/plan.md for provenance.
 */

import { BinaryView } from "./binary.js";
import { invalidData, invariant, WorldviewError } from "./errors.js";
import { parseMipTexturePayload } from "./miptex-payload.js";
import { readMipTextureHeader } from "./miptex.js";
import type { ParsedMipTexture } from "./types.js";

export const WAD2_MIPTEX = 0x44;
export const WAD3_MIPTEX = 0x43;

export interface WadIdentification {
  readonly version: 2 | 3;
}

export interface WadLump {
  readonly sourceIndex: number;
  readonly name: string;
  readonly type: number;
  readonly compression: number;
  readonly diskSize: number;
  readonly size: number;
  readonly data: Uint8Array;
  /** Present only when this is a valid, uncompressed MIPTEX record for the WAD version. */
  readonly mipTexture?: ParsedMipTexture;
}

export type WadWarning =
  | {
      readonly code: "unsupported-wad-compression";
      readonly message: string;
      readonly lumpIndex: number;
      readonly lumpName: string;
      readonly compression: number;
    }
  | {
      readonly code: "inconsistent-wad-lump-size";
      readonly message: string;
      readonly lumpIndex: number;
      readonly lumpName: string;
      readonly diskSize: number;
      readonly size: number;
    }
  | {
      readonly code: "unusable-wad-miptex";
      readonly message: string;
      readonly lumpIndex: number;
      readonly lumpName: string;
      readonly reason: string;
    };

export interface ParsedWad {
  readonly version: 2 | 3;
  readonly lumps: readonly WadLump[];
  readonly warnings: readonly WadWarning[];
}

export function identifyWad(
  input: ArrayBuffer | ArrayBufferView,
): WadIdentification | null {
  const source = new BinaryView(input);
  if (source.byteLength < 4) return null;
  const magic = source.string(0, 4);
  if (magic === "WAD2") return { version: 2 };
  if (magic === "WAD3") return { version: 3 };
  return null;
}

export function parseWad(input: ArrayBuffer | ArrayBufferView): ParsedWad {
  const source = new BinaryView(input);
  invariant(source.byteLength >= 12, "WAD header is truncated");
  const identification = identifyWad(input);
  if (!identification)
    invalidData(`unsupported WAD magic ${JSON.stringify(source.string(0, 4))}`);

  const { version } = identification;
  const count = source.u32(4);
  const directoryOffset = source.u32(8);
  invariant(
    count <= 1_000_000,
    "WAD directory has an unreasonable record count",
  );
  if (count > 0)
    invariant(directoryOffset >= 12, "WAD directory overlaps its header");
  source.require(directoryOffset, count * 32, "WAD directory");

  const lumps: WadLump[] = [];
  const warnings: WadWarning[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = directoryOffset + index * 32;
    const fileOffset = source.u32(offset);
    const diskSize = source.u32(offset + 4);
    const size = source.u32(offset + 8);
    const type = source.u8(offset + 12);
    const compression = source.u8(offset + 13);
    if (diskSize > 0)
      invariant(fileOffset >= 12, `WAD lump ${index} overlaps its header`);
    source.require(fileOffset, diskSize, `WAD lump ${index}`);
    const name = source.string(offset + 16, 16, true);
    const record = source.slice(fileOffset, diskSize);
    if (compression !== 0) {
      warnings.push({
        code: "unsupported-wad-compression",
        message: `WAD lump ${name || index} uses unsupported compression ${compression}`,
        lumpIndex: index,
        lumpName: name,
        compression,
      });
    }
    if (size !== diskSize) {
      warnings.push({
        code: "inconsistent-wad-lump-size",
        message: `WAD lump ${name || index} declares ${size} bytes but stores ${diskSize}`,
        lumpIndex: index,
        lumpName: name,
        diskSize,
        size,
      });
    }

    const expectedType = version === 2 ? WAD2_MIPTEX : WAD3_MIPTEX;
    let mipTexture: ParsedMipTexture | undefined;
    if (type === expectedType && compression === 0 && size === diskSize) {
      try {
        const header = readMipTextureHeader(record.bytes);
        mipTexture = parseMipTexturePayload(
          record,
          header,
          index,
          version === 3,
        );
        if (!mipTexture)
          invalidData(`MIPTEX ${header.name} has no embedded pixels`);
      } catch (error) {
        if (!(error instanceof WorldviewError) || error.code !== "invalid-data")
          throw error;
        warnings.push({
          code: "unusable-wad-miptex",
          message: `WAD MIPTEX ${name || index} is unusable: ${error.message}`,
          lumpIndex: index,
          lumpName: name,
          reason: error.message,
        });
      }
    }
    const data =
      mipTexture?.data.byteLength === diskSize
        ? mipTexture.data
        : record.bytes.slice();
    lumps.push({
      sourceIndex: index,
      name,
      type,
      compression,
      diskSize,
      size,
      data,
      ...(mipTexture ? { mipTexture } : {}),
    });
  }

  return { version, lumps, warnings };
}

export function findMipTexture(
  wad: ParsedWad,
  name: string,
): Uint8Array | undefined {
  const expectedType = wad.version === 2 ? WAD2_MIPTEX : WAD3_MIPTEX;
  const lower = name.toLowerCase();
  return wad.lumps.find(
    (lump) => lump.type === expectedType && lump.name.toLowerCase() === lower,
  )?.mipTexture?.data;
}
