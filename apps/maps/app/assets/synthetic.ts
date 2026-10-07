function align4(value: number): number {
  return (value + 3) & ~3;
}

function mipTexture(name: string, embeddedPalette: boolean): Uint8Array {
  const offsets = [40, 296, 360, 376];
  const pixelEnd = 380;
  const result = new Uint8Array(pixelEnd + (embeddedPalette ? 2 + 768 : 0));
  const view = new DataView(result.buffer);
  new TextEncoder().encodeInto(name, result.subarray(0, 16));
  view.setUint32(16, 16, true);
  view.setUint32(20, 16, true);
  offsets.forEach((offset, index) =>
    view.setUint32(24 + index * 4, offset, true),
  );
  for (let index = 40; index < pixelEnd; index += 1) {
    const x = (index - 40) % 16;
    const y = Math.floor((index - 40) / 16);
    result[index] =
      name.startsWith("{") && (x + y) % 5 === 0
        ? 255
        : ((x >> 2) + (y >> 2)) % 2 === 0
          ? 38
          : 94;
  }
  if (embeddedPalette) {
    view.setUint16(pixelEnd, 256, true);
    result.set(syntheticQuakePalette(), pixelEnd + 2);
  }
  return result;
}

function syntheticBsp(
  version: 29 | 30 | "BSP2",
  textureName: string,
  skyName?: string,
  additionalEntities = "",
  includeTrace = false,
): ArrayBuffer {
  const bsp2 = version === "BSP2";
  const texture = mipTexture(textureName, version === 30);
  const entities = new TextEncoder().encode(
    `{\n"classname" "worldspawn"\n${skyName ? `"skyname" "${skyName}"\n` : ""}}\n{\n"classname" "info_player_start"\n"origin" "8 -48 ${version === 30 ? 36 : 24}"\n"angle" "90"\n}\n${additionalEntities}\0`,
  );
  const textureLump = new Uint8Array(8 + texture.length);
  const textureView = new DataView(textureLump.buffer);
  textureView.setUint32(0, 1, true);
  textureView.setUint32(4, 8, true);
  textureLump.set(texture, 8);

  const vertices = new Uint8Array(48);
  const vertexView = new DataView(vertices.buffer);
  [
    [-128, -128, 0],
    [128, -128, 0],
    [128, 128, 0],
    [-128, 128, 0],
  ]
    .flat()
    .forEach((value, index) => vertexView.setFloat32(index * 4, value, true));
  const texinfo = new Uint8Array(40);
  const texinfoView = new DataView(texinfo.buffer);
  texinfoView.setFloat32(0, 0.125, true);
  texinfoView.setFloat32(20, 0.125, true);
  const face = new Uint8Array(bsp2 ? 28 : 20);
  const faceView = new DataView(face.buffer);
  faceView.setUint32(bsp2 ? 12 : 8, 4, true);
  const stylesOffset = bsp2 ? 20 : 12;
  faceView.setUint8(stylesOffset, 0);
  faceView.setUint8(stylesOffset + 1, 255);
  faceView.setUint8(stylesOffset + 2, 255);
  faceView.setUint8(stylesOffset + 3, 255);
  const lighting = new Uint8Array(version === 30 ? 27 : 9).fill(112);
  const edges = new Uint8Array(bsp2 ? 32 : 16);
  const edgeView = new DataView(edges.buffer);
  [0, 3, 3, 2, 2, 1, 1, 0].forEach((value, index) =>
    bsp2
      ? edgeView.setUint32(index * 4, value, true)
      : edgeView.setUint16(index * 2, value, true),
  );
  const surfedges = new Uint8Array(16);
  const surfedgeView = new DataView(surfedges.buffer);
  [0, 1, 2, 3].forEach((value, index) =>
    surfedgeView.setInt32(index * 4, value, true),
  );
  const model = new Uint8Array(64);
  const modelView = new DataView(model.buffer);
  [-128, -128, -1, 128, 128, 1].forEach((value, index) =>
    modelView.setFloat32(index * 4, value, true),
  );
  for (let index = 0; index < 4; index += 1) {
    const headnode = (includeTrace && index === 0) || index === 1 ? 0 : -1;
    modelView.setInt32(36 + index * 4, headnode, true);
  }
  modelView.setUint32(60, 1, true);

  const lumps: Uint8Array[] = Array.from(
    { length: 15 },
    () => new Uint8Array(),
  );
  {
    const plane = new Uint8Array(includeTrace ? 40 : 20);
    const planeView = new DataView(plane.buffer);
    planeView.setFloat32(8, 1, true);
    planeView.setFloat32(12, version === 30 ? 36 : 24, true);
    lumps[1] = plane;
  }
  {
    const clipnode = new Uint8Array(bsp2 ? 12 : 8);
    const clipnodeView = new DataView(clipnode.buffer);
    if (bsp2) {
      clipnodeView.setInt32(4, -1, true);
      clipnodeView.setInt32(8, -2, true);
    } else {
      clipnodeView.setInt16(4, -1, true);
      clipnodeView.setInt16(6, -2, true);
    }
    lumps[9] = clipnode;
  }
  if (includeTrace) {
    const plane = lumps[1]!;
    new DataView(plane.buffer, plane.byteOffset, plane.byteLength).setFloat32(
      20,
      1,
      true,
    );
    const node = new Uint8Array(24);
    const nodeView = new DataView(node.buffer);
    nodeView.setUint32(0, 1, true);
    nodeView.setInt16(4, -2, true);
    nodeView.setInt16(6, -1, true);
    const leaves = new Uint8Array(56);
    const leafView = new DataView(leaves.buffer);
    leafView.setInt32(0, -2, true);
    leafView.setInt32(28, -1, true);
    lumps[5] = node;
    lumps[10] = leaves;
  }
  lumps[0] = entities;
  lumps[2] = textureLump;
  lumps[3] = vertices;
  lumps[6] = texinfo;
  lumps[7] = face;
  lumps[8] = lighting;
  lumps[12] = edges;
  lumps[13] = surfedges;
  lumps[14] = model;
  let size = 124;
  const offsets: number[] = [];
  for (const lump of lumps) {
    size = align4(size);
    offsets.push(size);
    size += lump.length;
  }
  const bsp = new Uint8Array(size);
  const bspView = new DataView(bsp.buffer);
  if (bsp2) new TextEncoder().encodeInto("BSP2", bsp.subarray(0, 4));
  else bspView.setUint32(0, version, true);
  lumps.forEach((lump, index) => {
    const offset = offsets[index] ?? 124;
    bspView.setUint32(4 + index * 8, offset, true);
    bspView.setUint32(8 + index * 8, lump.length, true);
    bsp.set(lump, offset);
  });
  return bsp.buffer;
}

export function syntheticQuakePalette(): Uint8Array {
  const palette = new Uint8Array(768);
  for (let index = 0; index < 256; index += 1) {
    palette[index * 3] = Math.min(255, index * 2);
    palette[index * 3 + 1] = Math.min(255, 48 + index);
    palette[index * 3 + 2] = Math.min(255, 20 + index / 2);
  }
  return palette;
}

export function syntheticGoldSrcBsp(textureName = "wv_grid"): ArrayBuffer {
  return syntheticBsp(30, textureName);
}

export function syntheticGoldSrcSpriteBsp(): ArrayBuffer {
  return syntheticBsp(
    30,
    "wv_grid",
    undefined,
    '{\n"classname" "env_sprite"\n"model" "sprites/fixture.spr"\n"origin" "8 32 28"\n"scale" "2"\n"rendermode" "2"\n"renderamt" "220"\n}\n',
  );
}

export function syntheticGoldSrcAudioBsp(musicSpawnFlags = 3): ArrayBuffer {
  return syntheticBsp(
    30,
    "wv_grid",
    undefined,
    `{\n"classname" "ambient_generic"\n"message" "ambience/tone.wav"\n"origin" "8 -32 40"\n"health" "3"\n"pitch" "100"\n"spawnflags" "1"\n}\n{\n"classname" "env_sound"\n"origin" "8 -32 40"\n"radius" "512"\n"roomtype" "5"\n}\n{\n"classname" "ambient_music"\n"message" "music/tone.wav"\n"volume" "5"\n"spawnflags" "${musicSpawnFlags}"\n"targetname" "fixture_music"\n}\n`,
    true,
  );
}

export function syntheticGoldSrcWave(): Uint8Array {
  const sampleRate = 11_025;
  const frameCount = Math.floor(sampleRate / 4);
  const result = new Uint8Array(44 + frameCount);
  const view = new DataView(result.buffer);
  new TextEncoder().encodeInto("RIFF", result.subarray(0, 4));
  view.setUint32(4, result.length - 8, true);
  new TextEncoder().encodeInto("WAVEfmt ", result.subarray(8, 16));
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  new TextEncoder().encodeInto("data", result.subarray(36, 40));
  view.setUint32(40, frameCount, true);
  for (let index = 0; index < frameCount; index += 1)
    result[44 + index] = Math.round(
      128 + Math.sin((index * Math.PI * 2 * 110) / sampleRate) * 24,
    );
  return result;
}

/** Generated WAVs keep automated audio tests asset-free; real fixtures use game samples. */
export function syntheticGoldSrcPlayerSounds(): Readonly<
  Record<string, Uint8Array>
> {
  const families = ["step", "dirt", "grate", "metal", "slosh"];
  const paths = families.flatMap((family) =>
    [1, 2, 3, 4].map((index) => `player/pl_${family}${index}.wav`),
  );
  paths.push(...[1, 2, 3, 4, 5].map((index) => `player/pl_tile${index}.wav`));
  return Object.fromEntries(
    paths.map((path) => [path, syntheticGoldSrcWave()]),
  );
}

export function syntheticGoldSrcSprite(): Uint8Array {
  const width = 16;
  const height = 16;
  const palette = syntheticQuakePalette();
  const result = new Uint8Array(
    40 + 2 + palette.length + 4 + 16 + width * height,
  );
  const view = new DataView(result.buffer);
  view.setUint32(0, 0x5053_4449, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, 2, true);
  view.setUint32(12, 3, true);
  view.setFloat32(16, Math.hypot(width, height) / 2, true);
  view.setInt32(20, width, true);
  view.setInt32(24, height, true);
  view.setInt32(28, 1, true);
  view.setUint16(40, 256, true);
  result.set(palette, 42);
  let offset = 42 + palette.length;
  view.setUint32(offset, 0, true);
  offset += 4;
  view.setInt32(offset, -width / 2, true);
  view.setInt32(offset + 4, height / 2, true);
  view.setInt32(offset + 8, width, true);
  view.setInt32(offset + 12, height, true);
  offset += 16;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const distance = Math.hypot(x - width / 2 + 0.5, y - height / 2 + 0.5);
      result[offset + y * width + x] = distance < 7 ? 190 : 255;
    }
  }
  return result;
}

function solidTga(red: number, green: number, blue: number): Uint8Array {
  const tga = new Uint8Array(21);
  const view = new DataView(tga.buffer);
  tga[2] = 2;
  view.setUint16(12, 1, true);
  view.setUint16(14, 1, true);
  tga[16] = 24;
  tga[17] = 0x20;
  tga.set([blue, green, red], 18);
  return tga;
}

export function syntheticGoldSrcSkyBsp(): ArrayBuffer {
  return syntheticBsp(30, "sky", "fixture");
}

export function syntheticGoldSrcSkybox() {
  return {
    rt: solidTga(24, 32, 48),
    bk: solidTga(32, 24, 48),
    lf: solidTga(48, 24, 32),
    ft: solidTga(24, 48, 32),
    up: solidTga(32, 48, 24),
    dn: solidTga(48, 32, 24),
  };
}

export function syntheticQuakeBsp(): ArrayBuffer {
  return syntheticBsp(29, "sky_fixture");
}

export function syntheticQuakeBsp2(): ArrayBuffer {
  return syntheticBsp("BSP2", "wv_grid");
}
