import { parseWad } from "@tea/maps-renderer/core";

/** Retains original MIPTEX bytes, palettes, and directory order for a map's materials. */
export function subsetWadTextures(
  input: Uint8Array,
  expectedVersion: 2 | 3,
  names: ReadonlySet<string>,
): Uint8Array | null {
  const wad = parseWad(input);
  if (wad.version !== expectedVersion) {
    throw new Error(
      `Expected WAD${expectedVersion}, received WAD${wad.version}`,
    );
  }
  if (wad.warnings[0]) throw new Error(wad.warnings[0].message);
  const lumps = wad.lumps.filter(
    (lump) => lump.mipTexture && names.has(lump.mipTexture.name.toLowerCase()),
  );
  if (lumps.length === 0) return null;

  const directoryOffset =
    12 + lumps.reduce((size, lump) => size + lump.data.byteLength, 0);
  const output = new Uint8Array(directoryOffset + lumps.length * 32);
  const view = new DataView(output.buffer);
  output.set(new TextEncoder().encode(`WAD${wad.version}`));
  view.setUint32(4, lumps.length, true);
  view.setUint32(8, directoryOffset, true);
  let offset = 12;
  for (const [index, lump] of lumps.entries()) {
    output.set(lump.data, offset);
    const entry = directoryOffset + index * 32;
    view.setUint32(entry, offset, true);
    view.setUint32(entry + 4, lump.diskSize, true);
    view.setUint32(entry + 8, lump.size, true);
    output[entry + 12] = lump.type;
    output[entry + 13] = lump.compression;
    output.set(new TextEncoder().encode(lump.name).subarray(0, 16), entry + 16);
    offset += lump.data.byteLength;
  }
  return output;
}
