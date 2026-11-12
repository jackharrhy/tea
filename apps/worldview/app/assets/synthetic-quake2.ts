function align4(value: number): number {
  return (value + 3) & ~3;
}

export function syntheticQuake2Bsp(): Uint8Array {
  const entities = new TextEncoder().encode(
    '{\n"classname" "worldspawn"\n}\n{\n"classname" "info_player_start"\n"origin" "8 -48 24"\n"angle" "90"\n}\n\0',
  );
  const vertices = new Uint8Array(48);
  const vertexView = new DataView(vertices.buffer);
  [-128, -128, 0, 128, -128, 0, 128, 128, 0, -128, 128, 0].forEach(
    (value, index) => vertexView.setFloat32(index * 4, value, true),
  );
  const texinfo = new Uint8Array(76);
  const texinfoView = new DataView(texinfo.buffer);
  texinfoView.setFloat32(0, 0.125, true);
  texinfoView.setFloat32(20, 0.125, true);
  new TextEncoder().encodeInto("e1u1/fixture", texinfo.subarray(40, 72));
  texinfoView.setInt32(72, -1, true);
  const face = new Uint8Array(20);
  const faceView = new DataView(face.buffer);
  faceView.setInt16(8, 4, true);
  faceView.setUint8(12, 0);
  face.fill(255, 13, 16);
  const lighting = new Uint8Array(27).fill(128);
  const edges = new Uint8Array(16);
  const edgeView = new DataView(edges.buffer);
  [0, 1, 1, 2, 2, 3, 3, 0].forEach((value, index) =>
    edgeView.setUint16(index * 2, value, true),
  );
  const surfedges = new Uint8Array(16);
  const surfedgeView = new DataView(surfedges.buffer);
  [0, 1, 2, 3].forEach((value, index) =>
    surfedgeView.setInt32(index * 4, value, true),
  );
  const model = new Uint8Array(48);
  const modelView = new DataView(model.buffer);
  [-128, -128, -1, 128, 128, 1].forEach((value, index) =>
    modelView.setFloat32(index * 4, value, true),
  );
  modelView.setInt32(44, 1, true);

  const lumps: Uint8Array[] = Array.from(
    { length: 19 },
    () => new Uint8Array(),
  );
  lumps[0] = entities;
  lumps[2] = vertices;
  lumps[5] = texinfo;
  lumps[6] = face;
  lumps[7] = lighting;
  lumps[11] = edges;
  lumps[12] = surfedges;
  lumps[13] = model;
  const headerSize = 8 + lumps.length * 8;
  let size = headerSize;
  const offsets = lumps.map((lump) => {
    size = align4(size);
    const offset = size;
    size += lump.length;
    return offset;
  });
  const bsp = new Uint8Array(size);
  const view = new DataView(bsp.buffer);
  new TextEncoder().encodeInto("IBSP", bsp.subarray(0, 4));
  view.setUint32(4, 38, true);
  lumps.forEach((lump, index) => {
    view.setUint32(8 + index * 8, offsets[index]!, true);
    view.setUint32(12 + index * 8, lump.length, true);
    bsp.set(lump, offsets[index]!);
  });
  return bsp;
}

export function syntheticQuake2Palette(): Uint8Array {
  const pcx = new Uint8Array(128 + 1 + 768);
  pcx[0] = 0x0a;
  pcx[2] = 1;
  pcx[3] = 8;
  pcx[65] = 1;
  pcx[128] = 0x0c;
  for (let index = 0; index < 256; index += 1) {
    pcx[129 + index * 3] = index;
    pcx[130 + index * 3] = 255 - index;
    pcx[131 + index * 3] = (index * 7) & 255;
  }
  return pcx;
}

export function syntheticQuake2Wal(): Uint8Array {
  const sizes = [256, 64, 16, 4];
  const wal = new Uint8Array(100 + sizes.reduce((sum, size) => sum + size, 0));
  const view = new DataView(wal.buffer);
  new TextEncoder().encodeInto("e1u1/fixture", wal.subarray(0, 32));
  view.setUint32(32, 16, true);
  view.setUint32(36, 16, true);
  let offset = 100;
  for (const [level, size] of sizes.entries()) {
    view.setUint32(40 + level * 4, offset, true);
    wal.fill(level % 2 === 0 ? 7 : 14, offset, offset + size);
    offset += size;
  }
  return wal;
}
