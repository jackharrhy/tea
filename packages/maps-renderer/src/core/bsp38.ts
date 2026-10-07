import { BinaryView } from "./binary.js";
import {
  BSP38_VERSION,
  isBsp38Magic,
  QBSP_MAGIC,
} from "./bsp-identification.js";
import {
  bspRecordCount,
  checkedBspProduct,
  finiteBspFloat,
  normalizeBspBounds,
} from "./bsp-binary.js";
import {
  buildBspRenderGeometry,
  type BspLightmapMapping,
  type BspRenderFace,
  type BspTextureMapping,
} from "./bsp-render-geometry.js";
import { entityValue, parseEntities } from "./entities.js";
import { invalidData, invariant, WorldviewError } from "./errors.js";
import { LightmapPacker, LIGHTMAP_PAGE_SIZE } from "./lightmaps.js";
import { classifyMaterial } from "./materials.js";
import type {
  Bounds,
  BspWarning,
  ParsedLightmap,
  ParsedMaterial,
  ParsedModel,
  ParsedWorld,
  Vec3Tuple,
} from "./types.js";

const BSPX_MAGIC = 0x58505342;
const LUMP_COUNT = 19;
const HEADER_SIZE = 8 + LUMP_COUNT * 8;
const BSPX_HEADER_SIZE = 8;
const BSPX_LUMP_NAME_SIZE = 24;
const BSPX_LUMP_RECORD_SIZE = 32;
const DECOUPLED_LIGHTMAP_RECORD_SIZE = 40;

const enum LumpType {
  Entities = 0,
  Vertices = 2,
  Texinfo = 5,
  Faces = 6,
  Lighting = 7,
  Edges = 11,
  Surfedges = 12,
  Models = 13,
}

export interface ParseBsp38Options {
  readonly lightmapPageSize?: number;
}

interface RawModel {
  readonly bounds: Bounds;
  readonly headnode: number;
  readonly firstFace: number;
  readonly faceCount: number;
}

interface MutableAllocation {
  width: number;
  height: number;
  pageIndex: number;
  pageX: number;
  pageY: number;
}

interface Bsp38Lump {
  readonly offset: number;
  readonly length: number;
  readonly view: BinaryView;
}

interface DecoupledLightmap {
  readonly width: number;
  readonly height: number;
  readonly lightOffset: number;
  readonly mapping: BspLightmapMapping;
}

interface Bsp38Layout {
  readonly edgeSize: number;
  readonly faceSize: number;
  readonly readEdge: (
    lump: BinaryView,
    offset: number,
  ) => readonly [number, number];
  readonly readFace: (
    lump: BinaryView,
    offset: number,
  ) => {
    readonly firstEdge: number;
    readonly edgeCount: number;
    readonly mappingIndex: number;
    readonly stylesOffset: number;
    readonly lightOffset: number;
  };
}

const classicLayout: Bsp38Layout = {
  edgeSize: 4,
  faceSize: 20,
  readEdge: (lump, offset) => [lump.u16(offset), lump.u16(offset + 2)],
  readFace: (lump, offset) => ({
    firstEdge: lump.i32(offset + 4),
    edgeCount: lump.i16(offset + 8),
    mappingIndex: lump.i16(offset + 10),
    stylesOffset: offset + 12,
    lightOffset: lump.i32(offset + 16),
  }),
};

const extendedLayout: Bsp38Layout = {
  edgeSize: 8,
  faceSize: 28,
  readEdge: (lump, offset) => [lump.u32(offset), lump.u32(offset + 4)],
  readFace: (lump, offset) => ({
    firstEdge: lump.i32(offset + 8),
    edgeCount: lump.i32(offset + 12),
    mappingIndex: lump.i32(offset + 16),
    stylesOffset: offset + 20,
    lightOffset: lump.i32(offset + 24),
  }),
};

const Q2_SURF_SKY = 0x04;
const Q2_SURF_WARP = 0x08;
const Q2_SURF_TRANS33 = 0x10;
const Q2_SURF_TRANS66 = 0x20;
const Q2_SURF_FLOWING = 0x40;
const Q2_SURF_NODRAW = 0x80;

function surfaceOpacity(flags: number): number {
  if ((flags & Q2_SURF_TRANS33) !== 0) return 0.33;
  if ((flags & Q2_SURF_TRANS66) !== 0) return 0.66;
  return 1;
}

function surfaceScrollSpeed(flags: number): number {
  if ((flags & Q2_SURF_FLOWING) === 0) return 0;
  return (flags & Q2_SURF_WARP) !== 0 ? 32 : 1.6;
}

function surfaceUsesLightmap(flags: number): boolean {
  return (
    (flags &
      (Q2_SURF_SKY |
        Q2_SURF_WARP |
        Q2_SURF_TRANS33 |
        Q2_SURF_TRANS66 |
        Q2_SURF_NODRAW)) ===
    0
  );
}

function findBspxLump(
  source: BinaryView,
  standardLumps: readonly Bsp38Lump[],
  name: string,
): BinaryView | null {
  let headerOffset = HEADER_SIZE;
  for (const lump of standardLumps) {
    const end = lump.offset + lump.length;
    invariant(Number.isSafeInteger(end), "BSP38 lump end overflows");
    headerOffset = Math.max(headerOffset, Math.ceil(end / 4) * 4);
  }
  if (
    headerOffset + BSPX_HEADER_SIZE > source.byteLength ||
    source.u32(headerOffset) !== BSPX_MAGIC
  ) {
    return null;
  }

  const lumpCount = source.u32(headerOffset + 4);
  const directoryLength = checkedBspProduct(
    lumpCount,
    BSPX_LUMP_RECORD_SIZE,
    "BSPX directory",
  );
  source.require(
    headerOffset + BSPX_HEADER_SIZE,
    directoryLength,
    "BSPX directory",
  );
  let result: BinaryView | null = null;
  for (let index = 0; index < lumpCount; index += 1) {
    const offset =
      headerOffset + BSPX_HEADER_SIZE + index * BSPX_LUMP_RECORD_SIZE;
    const lumpName = source.string(offset, BSPX_LUMP_NAME_SIZE, true);
    const fileOffset = source.u32(offset + BSPX_LUMP_NAME_SIZE);
    const fileLength = source.u32(offset + BSPX_LUMP_NAME_SIZE + 4);
    source.require(fileOffset, fileLength, `BSPX ${lumpName || index}`);
    if (lumpName !== name) continue;
    invariant(result === null, `BSPX contains duplicate ${name} lumps`);
    result = source.slice(fileOffset, fileLength);
  }
  return result;
}

function decoupledLightmap(
  lump: BinaryView,
  faceIndex: number,
): DecoupledLightmap | null {
  const offset = faceIndex * DECOUPLED_LIGHTMAP_RECORD_SIZE;
  const width = lump.u16(offset);
  const height = lump.u16(offset + 2);
  invariant(
    (width === 0) === (height === 0),
    `BSPX DECOUPLED_LM face ${faceIndex} has incomplete zero dimensions`,
  );
  if (width === 0) return null;
  const s = [
    finiteBspFloat(
      lump,
      offset + 8,
      `BSPX DECOUPLED_LM face ${faceIndex} s[0]`,
    ),
    finiteBspFloat(
      lump,
      offset + 12,
      `BSPX DECOUPLED_LM face ${faceIndex} s[1]`,
    ),
    finiteBspFloat(
      lump,
      offset + 16,
      `BSPX DECOUPLED_LM face ${faceIndex} s[2]`,
    ),
    finiteBspFloat(
      lump,
      offset + 20,
      `BSPX DECOUPLED_LM face ${faceIndex} s[3]`,
    ),
  ] as const;
  const t = [
    finiteBspFloat(
      lump,
      offset + 24,
      `BSPX DECOUPLED_LM face ${faceIndex} t[0]`,
    ),
    finiteBspFloat(
      lump,
      offset + 28,
      `BSPX DECOUPLED_LM face ${faceIndex} t[1]`,
    ),
    finiteBspFloat(
      lump,
      offset + 32,
      `BSPX DECOUPLED_LM face ${faceIndex} t[2]`,
    ),
    finiteBspFloat(
      lump,
      offset + 36,
      `BSPX DECOUPLED_LM face ${faceIndex} t[3]`,
    ),
  ] as const;
  return {
    width,
    height,
    lightOffset: lump.i32(offset + 4),
    mapping: { s, t, scale: 1, minimumS: 0, minimumT: 0 },
  };
}

function dotMapping(
  position: Vec3Tuple,
  mapping: readonly [number, number, number, number],
): number {
  return Math.fround(
    position[0] * mapping[0] +
      position[1] * mapping[1] +
      position[2] * mapping[2] +
      mapping[3],
  );
}

export function parseBsp38(
  input: ArrayBuffer | ArrayBufferView,
  options: ParseBsp38Options = {},
): ParsedWorld {
  const source = new BinaryView(input);
  invariant(source.byteLength >= HEADER_SIZE, "BSP38 header is truncated");
  const magic = source.u32(0);
  invariant(
    isBsp38Magic(magic),
    "BSP38 has an invalid IBSP or QBSP identifier",
  );
  const layout = magic === QBSP_MAGIC ? extendedLayout : classicLayout;
  const version = source.u32(4);
  if (version !== BSP38_VERSION) {
    throw new WorldviewError(
      "unsupported-bsp",
      `Worldview supports IBSP and QBSP version 38, received ${version}`,
    );
  }
  const lumps = Array.from({ length: LUMP_COUNT }, (_, type): Bsp38Lump => {
    const header = 8 + type * 8;
    const offset = source.u32(header);
    const length = source.u32(header + 4);
    if (length > 0)
      invariant(
        offset >= HEADER_SIZE,
        `BSP38 lump ${type} overlaps its header`,
      );
    source.require(offset, length, `BSP38 lump ${type}`);
    return { offset, length, view: source.slice(offset, length) };
  });
  const lump = (type: LumpType): BinaryView => lumps[type]!.view;

  const entityLump = lump(LumpType.Entities);
  const entities = parseEntities(entityLump.string(0, entityLump.byteLength));
  const worldspawn = entities.find(
    (entity) =>
      entityValue(entity, "classname")?.toLowerCase() === "worldspawn",
  );
  const skyName = entityValue(worldspawn ?? {}, "sky")?.trim() || null;

  const vertexLump = lump(LumpType.Vertices);
  const positions: Vec3Tuple[] = [];
  for (
    let index = 0;
    index < bspRecordCount(vertexLump, 12, "vertex");
    index += 1
  ) {
    const offset = index * 12;
    positions.push([
      finiteBspFloat(vertexLump, offset, `vertex ${index} x`),
      finiteBspFloat(vertexLump, offset + 4, `vertex ${index} y`),
      finiteBspFloat(vertexLump, offset + 8, `vertex ${index} z`),
    ]);
  }

  const edgeLump = lump(LumpType.Edges);
  const edges: Array<readonly [number, number]> = [];
  for (
    let index = 0;
    index < bspRecordCount(edgeLump, layout.edgeSize, "edge");
    index += 1
  ) {
    const offset = index * layout.edgeSize;
    const edge = layout.readEdge(edgeLump, offset);
    invariant(
      edge[0] < positions.length && edge[1] < positions.length,
      `edge ${index} references an invalid vertex`,
    );
    edges.push(edge);
  }

  const surfedgeLump = lump(LumpType.Surfedges);
  const surfedgeCount = bspRecordCount(surfedgeLump, 4, "surfedge");
  const surfaceVertexIndices = new Uint32Array(surfedgeCount);
  for (let index = 0; index < surfedgeCount; index += 1) {
    const value = surfedgeLump.i32(index * 4);
    invariant(
      value !== -2_147_483_648,
      `surfedge ${index} has an invalid index`,
    );
    const edge = edges[Math.abs(value)];
    invariant(
      edge !== undefined,
      `surfedge ${index} references a missing edge`,
    );
    surfaceVertexIndices[index] = value >= 0 ? edge[0] : edge[1];
  }

  const texinfoLump = lump(LumpType.Texinfo);
  const mappings: BspTextureMapping[] = [];
  const materials: ParsedMaterial[] = [];
  const warnings: BspWarning[] = [];
  for (
    let index = 0;
    index < bspRecordCount(texinfoLump, 76, "texinfo");
    index += 1
  ) {
    const offset = index * 76;
    const flags = texinfoLump.u32(offset + 32);
    const value = texinfoLump.i32(offset + 36);
    const name = texinfoLump.string(offset + 40, 32, true);
    const nextMaterialIndex = texinfoLump.i32(offset + 72);
    invariant(
      nextMaterialIndex === -1 ||
        (nextMaterialIndex >= 0 &&
          nextMaterialIndex < texinfoLump.byteLength / 76),
      `texinfo ${index} has an invalid animation link`,
    );
    materials.push({
      name,
      kind: classifyMaterial(name, "quake2-bsp38", flags),
      opacity: surfaceOpacity(flags),
      scrollSpeed: surfaceScrollSpeed(flags),
      nextMaterialIndex: nextMaterialIndex < 0 ? null : nextMaterialIndex,
      surfaceFlags: flags,
      surfaceValue: value,
    });
    mappings.push({
      s: [
        finiteBspFloat(texinfoLump, offset, `texinfo ${index} s[0]`),
        finiteBspFloat(texinfoLump, offset + 4, `texinfo ${index} s[1]`),
        finiteBspFloat(texinfoLump, offset + 8, `texinfo ${index} s[2]`),
        finiteBspFloat(texinfoLump, offset + 12, `texinfo ${index} s[3]`),
      ],
      t: [
        finiteBspFloat(texinfoLump, offset + 16, `texinfo ${index} t[0]`),
        finiteBspFloat(texinfoLump, offset + 20, `texinfo ${index} t[1]`),
        finiteBspFloat(texinfoLump, offset + 24, `texinfo ${index} t[2]`),
        finiteBspFloat(texinfoLump, offset + 28, `texinfo ${index} t[3]`),
      ],
      materialIndex: index,
    });
  }

  const modelLump = lump(LumpType.Models);
  const rawModels: RawModel[] = [];
  for (
    let index = 0;
    index < bspRecordCount(modelLump, 48, "model");
    index += 1
  ) {
    const offset = index * 48;
    const firstFace = modelLump.i32(offset + 40);
    const faceCount = modelLump.i32(offset + 44);
    invariant(
      firstFace >= 0 && faceCount >= 0,
      `model ${index} has an invalid face range`,
    );
    const bounds: Bounds = {
      min: [
        finiteBspFloat(modelLump, offset, `model ${index} min x`),
        finiteBspFloat(modelLump, offset + 4, `model ${index} min y`),
        finiteBspFloat(modelLump, offset + 8, `model ${index} min z`),
      ],
      max: [
        finiteBspFloat(modelLump, offset + 12, `model ${index} max x`),
        finiteBspFloat(modelLump, offset + 16, `model ${index} max y`),
        finiteBspFloat(modelLump, offset + 20, `model ${index} max z`),
      ],
    };
    const normalizedBounds = normalizeBspBounds(bounds);
    if (normalizedBounds.invertedAxes.length > 0) {
      warnings.push({
        code: "noncanonical-inverted-model-bounds",
        message: `model ${index} has inverted ${normalizedBounds.invertedAxes.map((axis) => axis.toUpperCase()).join("/")} bounds; the axis endpoints were safely reordered`,
        modelIndex: index,
        axes: normalizedBounds.invertedAxes,
      });
    }
    rawModels.push({
      bounds: normalizedBounds.bounds,
      headnode: modelLump.i32(offset + 36),
      firstFace,
      faceCount,
    });
  }
  invariant(rawModels.length > 0, "BSP38 has no world model");

  const faceLump = lump(LumpType.Faces);
  const faceCount = bspRecordCount(faceLump, layout.faceSize, "face");
  const decoupledLightmaps = findBspxLump(source, lumps, "DECOUPLED_LM");
  if (decoupledLightmaps) {
    invariant(
      decoupledLightmaps.byteLength ===
        checkedBspProduct(
          faceCount,
          DECOUPLED_LIGHTMAP_RECORD_SIZE,
          "BSPX DECOUPLED_LM",
        ),
      "BSPX DECOUPLED_LM record count does not match the face count",
    );
  }
  const faceToModel = new Int32Array(faceCount).fill(-1);
  rawModels.forEach((model, modelIndex) => {
    invariant(
      model.firstFace + model.faceCount <= faceCount,
      `model ${modelIndex} face range is invalid`,
    );
    for (
      let face = model.firstFace;
      face < model.firstFace + model.faceCount;
      face += 1
    ) {
      invariant(
        faceToModel[face] === -1,
        `face ${face} belongs to multiple models`,
      );
      faceToModel[face] = modelIndex;
    }
  });

  const lighting = lump(LumpType.Lighting);
  const pageSize = options.lightmapPageSize ?? LIGHTMAP_PAGE_SIZE;
  invariant(
    Number.isInteger(pageSize) && pageSize > 0 && pageSize <= 65_535,
    "invalid lightmap page size",
  );
  const packer = new LightmapPacker(pageSize, pageSize);
  const lightmaps: ParsedLightmap[] = [];
  const rawFaces: BspRenderFace[] = [];
  for (let sourceIndex = 0; sourceIndex < faceCount; sourceIndex += 1) {
    const offset = sourceIndex * layout.faceSize;
    const { firstEdge, edgeCount, mappingIndex, stylesOffset, lightOffset } =
      layout.readFace(faceLump, offset);
    invariant(
      firstEdge >= 0 && edgeCount >= 3,
      `face ${sourceIndex} has invalid edges`,
    );
    invariant(
      firstEdge + edgeCount <= surfaceVertexIndices.length,
      `face ${sourceIndex} surfedge range is invalid`,
    );
    const mapping = mappings[mappingIndex];
    invariant(
      mapping !== undefined,
      `face ${sourceIndex} references texinfo ${mappingIndex}`,
    );
    const material = materials[mapping.materialIndex];
    invariant(
      material !== undefined,
      `face ${sourceIndex} references a missing material`,
    );
    const modelIndex = faceToModel[sourceIndex] ?? -1;
    invariant(
      modelIndex >= 0,
      `face ${sourceIndex} does not belong to a model`,
    );

    let minimumS = Number.POSITIVE_INFINITY;
    let minimumT = Number.POSITIVE_INFINITY;
    let maximumS = Number.NEGATIVE_INFINITY;
    let maximumT = Number.NEGATIVE_INFINITY;
    for (let edge = 0; edge < edgeCount; edge += 1) {
      const position =
        positions[surfaceVertexIndices[firstEdge + edge] ?? positions.length];
      invariant(
        position !== undefined,
        `face ${sourceIndex} references a missing vertex`,
      );
      const s = dotMapping(position, mapping.s);
      const t = dotMapping(position, mapping.t);
      invariant(
        Number.isFinite(s) && Number.isFinite(t),
        `face ${sourceIndex} has invalid UVs`,
      );
      minimumS = Math.min(minimumS, s);
      minimumT = Math.min(minimumT, t);
      maximumS = Math.max(maximumS, s);
      maximumT = Math.max(maximumT, t);
    }
    const extendedLightmap = decoupledLightmaps
      ? decoupledLightmap(decoupledLightmaps, sourceIndex)
      : null;
    const width =
      extendedLightmap?.width ??
      Math.ceil(maximumS / 16) - Math.floor(minimumS / 16) + 1;
    const height =
      extendedLightmap?.height ??
      Math.ceil(maximumT / 16) - Math.floor(minimumT / 16) + 1;
    const faceLightOffset = extendedLightmap?.lightOffset ?? lightOffset;
    invariant(
      Number.isSafeInteger(width) &&
        Number.isSafeInteger(height) &&
        width > 0 &&
        height > 0,
      `face ${sourceIndex} has invalid lightmap dimensions`,
    );
    const styles: number[] = [];
    for (let style = 0; style < 4; style += 1) {
      const value = faceLump.u8(stylesOffset + style);
      if (value === 255) break;
      styles.push(value);
    }
    let samples: Uint8Array | null = null;
    const allocation: MutableAllocation = {
      width,
      height,
      pageIndex: -1,
      pageX: 0,
      pageY: 0,
    };
    const surfaceFlags = material.surfaceFlags ?? 0;
    if (
      surfaceUsesLightmap(surfaceFlags) &&
      lighting.byteLength > 0 &&
      faceLightOffset !== -1 &&
      styles.length > 0
    ) {
      invariant(
        faceLightOffset >= 0,
        `face ${sourceIndex} has an invalid light offset`,
      );
      const sampleLength = checkedBspProduct(
        checkedBspProduct(width, height, `face ${sourceIndex} lightmap`),
        styles.length * 3,
        `face ${sourceIndex} styled lightmap`,
      );
      lighting.require(
        faceLightOffset,
        sampleLength,
        `face ${sourceIndex} light samples`,
      );
      samples = lighting.uint8Array(faceLightOffset, sampleLength).slice();
      packer.allocate(allocation);
    }
    const lightmap: ParsedLightmap = {
      faceIndex: sourceIndex,
      width,
      height,
      styles,
      samples,
      pageIndex: allocation.pageIndex,
      pageX: allocation.pageX,
      pageY: allocation.pageY,
    };
    lightmaps.push(lightmap);
    rawFaces.push({
      sourceIndex,
      modelIndex,
      materialIndex: mapping.materialIndex,
      kind: material.kind,
      firstEdge,
      edgeCount,
      mapping,
      lightmapMapping: extendedLightmap?.mapping ?? {
        s: mapping.s,
        t: mapping.t,
        scale: 1 / 16,
        minimumS: Math.floor(minimumS / 16),
        minimumT: Math.floor(minimumT / 16),
      },
      lightmap,
    });
  }

  const geometry = buildBspRenderGeometry(
    positions,
    surfaceVertexIndices,
    materials,
    rawFaces,
  );
  const models: ParsedModel[] = rawModels.map((model, modelIndex) => {
    const entityIndex = entities.findIndex(
      ({ model: value }) => value === `*${modelIndex}`,
    );
    const entity = entityIndex >= 0 ? entities[entityIndex] : undefined;
    const classname =
      entityValue(entity ?? {}, "classname")?.toLowerCase() ??
      (modelIndex === 0 ? "worldspawn" : "unknown");
    return {
      bounds: model.bounds,
      headnodes: [model.headnode],
      faceIndices: Array.from(
        { length: model.faceCount },
        (_, index) => model.firstFace + index,
      ),
      visible: !classname.startsWith("trigger_"),
      entityIndex: entityIndex >= 0 ? entityIndex : null,
      classname,
      collidable: modelIndex === 0,
      renderMode: 0,
      renderAmount: 255,
      renderColor: [255, 255, 255],
      textureScrollSpeed: 0,
    };
  });
  const worldModel = models[0];
  if (!worldModel) invalidData("BSP38 has no world model");
  return {
    format: "quake2-bsp38",
    version: 38,
    warnings,
    bounds: worldModel.bounds,
    entities,
    skyName,
    wadReferences: [],
    ambientSounds: [],
    envSounds: [],
    musicTracks: [],
    trace: null,
    visibility: null,
    collision: null,
    vertices: geometry.vertices,
    indices: geometry.indices,
    materials,
    faces: geometry.faces,
    batches: geometry.batches,
    models,
    hasLighting: lighting.byteLength > 0,
    lightmapPages: packer.finish(lightmaps),
    lightmapBytesPerTexel: 3,
    hasAnimatedLightmaps: lightmaps.some((lightmap) =>
      lightmap.styles.some((style) => style !== 0),
    ),
  };
}
