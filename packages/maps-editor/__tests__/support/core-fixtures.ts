import {
  createBoxBrush,
  createSequentialIdFactory,
  createStarterDocument,
  DEFAULT_SIMPLE_SHAPE_OPTIONS,
  deriveBrush,
  setBrushFaceMaterials,
  textureCoordinates,
  type MapBrush,
  type MapDocument,
  type FaceId,
  type SimpleShapeOptions,
} from "../../src/core/index.js";

function simpleShapeOptions(
  overrides: Partial<SimpleShapeOptions>,
): SimpleShapeOptions {
  return { ...DEFAULT_SIMPLE_SHAPE_OPTIONS, ...overrides };
}

function withTestFace(
  brush: MapBrush,
  faceId: FaceId,
  replacement: MapBrush["faces"][number],
): MapBrush {
  const faces = [...brush.faces];
  const index = faces.findIndex((face) => face.id === faceId);
  if (index < 0) throw new Error(`Unknown test face ${faceId}`);
  faces[index] = replacement;
  return { ...brush, faces };
}

function selectionQueryFixture() {
  const ids = createSequentialIdFactory("selection-query");
  const starter = createStarterDocument();
  const query = createBoxBrush([-64, -64, -32], [64, 64, 96], "SELECTOR", ids);
  const inside = createBoxBrush([-16, -16, 0], [16, 16, 32], "INSIDE", ids);
  const crossing = createBoxBrush([48, -16, 0], [80, 16, 32], "CROSSING", ids);
  const outside = createBoxBrush([112, -16, 0], [144, 16, 32], "OUTSIDE", ids);
  const elevated = createBoxBrush(
    [-16, 24, 160],
    [16, 48, 192],
    "ELEVATED",
    ids,
  );
  const marker = {
    id: ids.entity(),
    properties: { classname: "info_target", origin: "0 -32 16" },
    primitives: [],
  };
  const remoteMarker = {
    id: ids.entity(),
    properties: { classname: "info_target", origin: "160 0 16" },
    primitives: [],
  };
  const document: MapDocument = {
    ...starter,
    entities: [
      {
        ...starter.entities[0]!,
        primitives: [query, inside, crossing, outside, elevated],
      },
      marker,
      remoteMarker,
    ],
  };
  return {
    document,
    query,
    inside,
    crossing,
    outside,
    elevated,
    marker,
    remoteMarker,
  };
}

function layerFixture() {
  const ids = createSequentialIdFactory("layers");
  const starter = createStarterDocument();
  const defaultBrush = createBoxBrush(
    [-96, -32, 0],
    [-64, 32, 32],
    "DEFAULT",
    ids,
  );
  const layerBrush = createBoxBrush([-32, -32, 0], [0, 32, 32], "LAYER", ids);
  const detailBrush = createBoxBrush([32, -32, 0], [64, 32, 32], "DETAIL", ids);
  const groupBrush = createBoxBrush([80, -32, 0], [112, 32, 32], "GROUP", ids);
  const nestedBrush = createBoxBrush(
    [128, -32, 0],
    [160, 32, 32],
    "NESTED",
    ids,
  );
  const layerEntity = {
    id: ids.entity(),
    properties: {
      classname: "func_group",
      _tb_type: "_tb_layer",
      _tb_name: "Architecture",
      _tb_id: "7",
      _tb_layer_sort_index: "3",
    },
    primitives: [layerBrush],
  };
  const detail = {
    id: ids.entity(),
    properties: { classname: "func_detail", _tb_layer: "7" },
    primitives: [detailBrush],
  };
  const marker = {
    id: ids.entity(),
    properties: { classname: "info_target", origin: "0 96 16", _tb_layer: "7" },
    primitives: [],
  };
  const rootGroup = {
    id: ids.entity(),
    properties: {
      classname: "func_group",
      _tb_type: "_tb_group",
      _tb_name: "Assembly",
      _tb_id: "8",
      _tb_layer: "7",
    },
    primitives: [groupBrush],
  };
  const nestedGroup = {
    id: ids.entity(),
    properties: {
      classname: "func_group",
      _tb_type: "_tb_group",
      _tb_name: "Nested",
      _tb_id: "9",
      _tb_group: "8",
    },
    primitives: [nestedBrush],
  };
  const groupedMarker = {
    id: ids.entity(),
    properties: { classname: "light", origin: "144 0 48", _tb_group: "9" },
    primitives: [],
  };
  const document: MapDocument = {
    ...starter,
    entities: [
      { ...starter.entities[0]!, primitives: [defaultBrush] },
      layerEntity,
      detail,
      marker,
      rootGroup,
      nestedGroup,
      groupedMarker,
    ],
  };
  return {
    document,
    ids,
    defaultBrush,
    layerBrush,
    detailBrush,
    groupBrush,
    nestedBrush,
    layerEntity,
    detail,
    marker,
    rootGroup,
    nestedGroup,
    groupedMarker,
  };
}

function repetitionFixture() {
  const ids = createSequentialIdFactory("repeat-source");
  const starter = createStarterDocument();
  const first = createBoxBrush([0, 0, 0], [16, 16, 16], "STEP", ids);
  const second = createBoxBrush([128, 0, 0], [144, 16, 16], "OTHER", ids);
  const document: MapDocument = {
    ...starter,
    entities: [
      { ...starter.entities[0]!, primitives: [first, second] },
      ...starter.entities.slice(1),
    ],
  };
  return { document, first, second };
}

function issueFixture() {
  const ids = createSequentialIdFactory("issues");
  const starter = createStarterDocument();
  const valid = createBoxBrush([-64, -32, 0], [-32, 32, 32], "VALID", ids);
  const sourceInvalid = createBoxBrush(
    [32, -32, 0],
    [64, 32, 32],
    "INVALID",
    ids,
  );
  const invalid = { ...sourceInvalid, faces: sourceInvalid.faces.slice(0, 3) };
  const invalidOrigin = {
    id: ids.entity(),
    properties: { classname: "light", origin: "not a vector" },
    primitives: [],
  };
  const missingOrigin = {
    id: ids.entity(),
    properties: { classname: "info_target" },
    primitives: [],
  };
  const unresolved = {
    id: ids.entity(),
    properties: {
      classname: "trigger_once",
      origin: "96 0 16",
      target: "missing_door",
    },
    primitives: [],
  };
  const emptyBrushEntity = {
    id: ids.entity(),
    properties: { classname: "func_door" },
    primitives: [],
  };
  const emptyGroup = {
    id: ids.entity(),
    properties: {
      classname: "func_group",
      _tb_type: "_tb_group",
      _tb_name: "Empty Room",
      _tb_id: "7",
    },
    primitives: [],
  };
  const document: MapDocument = {
    ...starter,
    entities: [
      { ...starter.entities[0]!, primitives: [valid, invalid] },
      invalidOrigin,
      missingOrigin,
      unresolved,
      emptyBrushEntity,
      emptyGroup,
    ],
  };
  return { document, invalid, invalidOrigin, missingOrigin, unresolved };
}

function viewFilterFixture() {
  const ids = createSequentialIdFactory("view-filters");
  const starter = createStarterDocument();
  const world = createBoxBrush([-96, -32, 0], [-64, 32, 32], "STONE", ids);
  const detail = createBoxBrush([-32, -32, 0], [0, 32, 32], "DETAIL", ids);
  const trigger = createBoxBrush([32, -32, 0], [64, 32, 32], "TRIGGER", ids);
  const clip = createBoxBrush([96, -32, 0], [128, 32, 32], "PLAYERCLIP", ids);
  const detailEntity = {
    id: ids.entity(),
    properties: { classname: "func_detail" },
    primitives: [detail],
  };
  const triggerEntity = {
    id: ids.entity(),
    properties: { classname: "trigger_once" },
    primitives: [trigger],
  };
  const clipEntity = {
    id: ids.entity(),
    properties: { classname: "func_wall" },
    primitives: [clip],
  };
  const light = {
    id: ids.entity(),
    properties: { classname: "light", origin: "0 96 24" },
    primitives: [],
  };
  const monster = {
    id: ids.entity(),
    properties: { classname: "monster_army", origin: "96 96 24" },
    primitives: [],
  };
  const document: MapDocument = {
    ...starter,
    entities: [
      { ...starter.entities[0]!, primitives: [world] },
      detailEntity,
      triggerEntity,
      clipEntity,
      light,
      monster,
    ],
  };
  return { document, world, detail, trigger, clip, light, monster };
}

function materialUsageFixture() {
  const ids = createSequentialIdFactory("material-usage");
  const starter = createStarterDocument();
  const firstSource = createBoxBrush(
    [-64, -32, 0],
    [-32, 32, 32],
    "BRICK",
    ids,
  );
  const first = setBrushFaceMaterials(
    firstSource,
    "METAL",
    firstSource.faces.slice(0, 2).map((face) => face.id),
  );
  const second = createBoxBrush([32, -32, 0], [64, 32, 32], "brick", ids);
  const document: MapDocument = {
    ...starter,
    entities: [{ ...starter.entities[0]!, primitives: [first, second] }],
  };
  return { document, first, second };
}

function makeTestPalette(): Uint8Array {
  const palette = new Uint8Array(768);
  for (let index = 0; index < 256; index += 1) {
    palette[index * 3] = index;
    palette[index * 3 + 1] = 255 - index;
    palette[index * 3 + 2] = (index * 7) & 255;
  }
  return palette;
}

function makeTestWad(version: 2 | 3, name = "fixture"): Uint8Array {
  const dimensions = [16, 8, 4, 2];
  const offsets: number[] = [];
  let textureLength = 40;
  for (const dimension of dimensions) {
    offsets.push(textureLength);
    textureLength += dimension * dimension;
  }
  const palette = makeTestPalette();
  const texture = new Uint8Array(
    textureLength + (version === 3 ? 2 + palette.length : 0),
  );
  const textureView = new DataView(texture.buffer);
  new TextEncoder().encodeInto(name, texture.subarray(0, 16));
  textureView.setUint32(16, 16, true);
  textureView.setUint32(20, 16, true);
  offsets.forEach((offset, index) =>
    textureView.setUint32(24 + index * 4, offset, true),
  );
  for (let index = 40; index < textureLength; index += 1)
    texture[index] = index & 255;
  if (version === 3) {
    textureView.setUint16(textureLength, 256, true);
    texture.set(palette, textureLength + 2);
  }

  const directoryOffset = 12 + texture.length;
  const wad = new Uint8Array(directoryOffset + 32);
  const wadView = new DataView(wad.buffer);
  new TextEncoder().encodeInto(`WAD${version}`, wad.subarray(0, 4));
  wadView.setUint32(4, 1, true);
  wadView.setUint32(8, directoryOffset, true);
  wad.set(texture, 12);
  wadView.setUint32(directoryOffset, 12, true);
  wadView.setUint32(directoryOffset + 4, texture.length, true);
  wadView.setUint32(directoryOffset + 8, texture.length, true);
  wadView.setUint8(directoryOffset + 12, version === 2 ? 0x44 : 0x43);
  new TextEncoder().encodeInto(
    name,
    wad.subarray(directoryOffset + 16, directoryOffset + 32),
  );
  return wad;
}

function dotVectors(left: readonly number[], right: readonly number[]): number {
  return left.reduce(
    (sum, component, index) => sum + component * right[index]!,
    0,
  );
}

function normalizeVector(value: readonly number[]): number[] {
  const magnitude = Math.hypot(...value);
  return value.map((component) => component / magnitude);
}

function averagePoints(points: readonly (readonly number[])[]): number[] {
  return points[0]!.map(
    (_, axis) =>
      points.reduce((sum, point) => sum + point[axis]!, 0) / points.length,
  );
}

function faceTextureBounds(brush: MapBrush, faceId: FaceId) {
  const face = brush.faces.find((candidate) => candidate.id === faceId)!;
  const vertices = deriveBrush(brush).faces.find(
    (candidate) => candidate.faceId === faceId,
  )!.vertices;
  const coordinates = vertices.map((vertex) =>
    textureCoordinates(face, vertex),
  );
  return {
    min: [
      Math.min(...coordinates.map((coordinate) => coordinate[0])),
      Math.min(...coordinates.map((coordinate) => coordinate[1])),
    ] as const,
    max: [
      Math.max(...coordinates.map((coordinate) => coordinate[0])),
      Math.max(...coordinates.map((coordinate) => coordinate[1])),
    ] as const,
  };
}

export {
  simpleShapeOptions,
  withTestFace,
  selectionQueryFixture,
  layerFixture,
  repetitionFixture,
  issueFixture,
  viewFilterFixture,
  materialUsageFixture,
  makeTestWad,
  dotVectors,
  normalizeVector,
  averagePoints,
  faceTextureBounds,
};
