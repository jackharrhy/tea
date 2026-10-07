import { BinaryView } from "./binary.js";
import { identifyBsp, isBsp38Magic } from "./bsp-identification.js";
import {
  bspRecordCount,
  checkedBspProduct,
  finiteBspFloat,
  normalizeBspBounds,
} from "./bsp-binary.js";
import { parseBsp38 } from "./bsp38.js";
import {
  buildBspRenderGeometry,
  type BspRenderFace,
  type BspTextureMapping,
} from "./bsp-render-geometry.js";
import { parseGoldSrcAudioEntities } from "./audio.js";
import { validateBspCollision, type ParsedBspCollision } from "./collision.js";
import { entityValue, parseEntities, wadReferences } from "./entities.js";
import { invalidData, invariant } from "./errors.js";
import { LightmapPacker, LIGHTMAP_PAGE_SIZE } from "./lightmaps.js";
import {
  readQuakeClipnode,
  readQuakeEdge,
  readQuakeFace,
  readQuakeLeaf,
  readQuakeMarkSurface,
  readQuakeTraceNode,
  type QuakeBspLayout,
} from "./quake-bsp-layout.js";
import { parseQuakeBspContainer } from "./quake-bsp-container.js";
import { parseQuakeTextures } from "./quake-bsp-textures.js";
import { validateBspTrace, type ParsedBspTrace } from "./trace.js";
import type { ParsedBspVisibility } from "./visibility.js";
import type {
  Bounds,
  BspWarning,
  GoldSrcRenderMode,
  ParsedLightmap,
  ParsedModel,
  ParsedWorld,
  Vec3Tuple,
} from "./types.js";

export interface ParseBspOptions {
  readonly lightmapPageSize?: number;
}

type TextureMapping = BspTextureMapping;

interface RawModel {
  readonly bounds: Bounds;
  readonly headnodes: readonly number[];
  readonly visLeafCount: number;
  readonly firstFace: number;
  readonly faceCount: number;
}

type RawFace = BspRenderFace;

interface MutableAllocation {
  width: number;
  height: number;
  pageIndex: number;
  pageX: number;
  pageY: number;
}

function parseTrace(
  planes: Float32Array,
  nodeLump: BinaryView,
  leafLump: BinaryView,
  headNode: number,
  layout: QuakeBspLayout,
): ParsedBspTrace | null {
  if (nodeLump.byteLength === 0 && leafLump.byteLength === 0) return null;
  invariant(
    planes.byteLength > 0 && nodeLump.byteLength > 0 && leafLump.byteLength > 0,
    "BSP trace lumps must either all be present or all be empty",
  );
  const nodeCount = bspRecordCount(nodeLump, layout.nodeSize, "node");
  const leafCount = bspRecordCount(leafLump, layout.leafSize, "leaf");
  const nodes = new Int32Array(nodeCount * 3);
  for (let index = 0; index < nodeCount; index += 1) {
    const targetOffset = index * 3;
    nodes.set(readQuakeTraceNode(nodeLump, index, layout), targetOffset);
  }
  const leafContents = new Int32Array(leafCount);
  for (let index = 0; index < leafCount; index += 1) {
    leafContents[index] = readQuakeLeaf(leafLump, index, layout).contents;
  }
  const trace = { planes, nodes, leafContents, headNode };
  validateBspTrace(trace);
  return trace;
}

function validateVisibilityRow(
  data: Uint8Array,
  offset: number,
  byteCount: number,
): boolean {
  let source = offset;
  let destination = 0;
  let clipped = false;
  while (destination < byteCount) {
    invariant(source < data.length, "BSP visibility row is truncated");
    const value = data[source++]!;
    if (value !== 0) {
      destination += 1;
      continue;
    }
    invariant(source < data.length, "BSP visibility run is truncated");
    const length = data[source++]!;
    invariant(length > 0, "BSP visibility contains an empty zero run");
    clipped ||= destination + length > byteCount;
    destination = Math.min(byteCount, destination + length);
  }
  return clipped;
}

function parseVisibility(
  leafLump: BinaryView,
  markSurfaceLump: BinaryView,
  visibilityLump: BinaryView,
  visLeafCount: number,
  faceCount: number,
  layout: QuakeBspLayout,
): {
  readonly visibility: ParsedBspVisibility | null;
  readonly clippedRun: boolean;
} {
  invariant(
    visLeafCount >= 0,
    "world model has a negative visibility leaf count",
  );
  if (visLeafCount === 0 || visibilityLump.byteLength === 0) {
    return { visibility: null, clippedRun: false };
  }
  const leafCount = bspRecordCount(leafLump, layout.leafSize, "leaf");
  invariant(
    visLeafCount < leafCount,
    "world visibility references missing leaves",
  );
  const markSurfaceCount = bspRecordCount(
    markSurfaceLump,
    layout.marksurfaceSize,
    "marksurface",
  );
  const leafVisOffsets = new Int32Array(leafCount);
  const leafMarkSurfaceStarts = new Uint32Array(leafCount);
  const leafMarkSurfaceCounts = new Uint32Array(leafCount);
  for (let leafIndex = 0; leafIndex < leafCount; leafIndex += 1) {
    const leaf = readQuakeLeaf(leafLump, leafIndex, layout);
    const visOffset = leaf.visibilityOffset;
    const first = leaf.firstMarkSurface;
    const count = leaf.markSurfaceCount;
    invariant(
      first + count <= markSurfaceCount,
      `BSP leaf ${leafIndex} has an invalid marksurface range`,
    );
    invariant(
      visOffset >= -1,
      `BSP leaf ${leafIndex} has an invalid visibility offset`,
    );
    if (visOffset >= 0) {
      invariant(
        visOffset < visibilityLump.byteLength,
        `BSP leaf ${leafIndex} has an invalid visibility offset`,
      );
    }
    leafVisOffsets[leafIndex] = visOffset;
    leafMarkSurfaceStarts[leafIndex] = first;
    leafMarkSurfaceCounts[leafIndex] = count;
  }

  const markSurfaces = new Uint32Array(markSurfaceCount);
  for (let index = 0; index < markSurfaceCount; index += 1) {
    const faceIndex = readQuakeMarkSurface(markSurfaceLump, index, layout);
    invariant(
      faceIndex < faceCount,
      `marksurface ${index} references missing face ${faceIndex}`,
    );
    markSurfaces[index] = faceIndex;
  }
  const data = visibilityLump.uint8Array(0, visibilityLump.byteLength).slice();
  const rowByteCount = Math.ceil(visLeafCount / 8);
  let clippedRun = false;
  for (let leafIndex = 1; leafIndex <= visLeafCount; leafIndex += 1) {
    const offset = leafVisOffsets[leafIndex]!;
    if (offset >= 0)
      clippedRun ||= validateVisibilityRow(data, offset, rowByteCount);
  }
  return {
    visibility: {
      leafCount: visLeafCount,
      worldFaceCount: faceCount,
      leafVisOffsets,
      leafMarkSurfaceStarts,
      leafMarkSurfaceCounts,
      markSurfaces,
      data,
    },
    clippedRun,
  };
}

function parsePlanes(lump: BinaryView): Float32Array {
  const planeCount = bspRecordCount(lump, 20, "plane");
  const planes = new Float32Array(planeCount * 4);
  for (let index = 0; index < planeCount; index += 1) {
    const sourceOffset = index * 20;
    const targetOffset = index * 4;
    for (let component = 0; component < 4; component += 1) {
      planes[targetOffset + component] = finiteBspFloat(
        lump,
        sourceOffset + component * 4,
        `plane ${index} component ${component}`,
      );
    }
  }
  return planes;
}

function parseCollision(
  planes: Float32Array,
  lump: BinaryView,
  headNodes: readonly number[],
  layout: QuakeBspLayout,
): ParsedBspCollision | null {
  if (lump.byteLength === 0) return null;
  invariant(planes.length > 0, "BSP clipnodes require planes");
  const nodeCount = bspRecordCount(lump, layout.clipnodeSize, "clipnode");
  const clipnodes = new Int32Array(nodeCount * 3);
  for (let index = 0; index < nodeCount; index += 1) {
    const targetOffset = index * 3;
    clipnodes.set(readQuakeClipnode(lump, index, layout), targetOffset);
  }
  const collision = { planes, clipnodes };
  validateBspCollision(collision, headNodes);
  return collision;
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

const movingBrushClasses = new Set([
  "func_button",
  "func_door",
  "func_door_rotating",
  "func_pendulum",
  "func_plat",
  "func_pushable",
  "func_rotating",
  "func_trackautochange",
  "func_trackchange",
  "func_tracktrain",
  "func_train",
  "func_traincontrols",
  "func_water",
  "momentary_door",
  "momentary_rot_button",
]);

const staticSolidBrushClasses = new Set([
  "func_conveyor",
  "func_detail",
  "func_wall",
]);

function byteValue(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed)
    ? Math.min(255, Math.max(0, parsed))
    : fallback;
}

function parseRenderColor(value: string | undefined): Vec3Tuple {
  const channels = value?.trim().split(/\s+/).map(Number);
  if (
    !channels ||
    channels.length !== 3 ||
    channels.some((channel) => !Number.isFinite(channel))
  ) {
    return [255, 255, 255];
  }
  return [
    Math.min(255, Math.max(0, channels[0] ?? 255)),
    Math.min(255, Math.max(0, channels[1] ?? 255)),
    Math.min(255, Math.max(0, channels[2] ?? 255)),
  ];
}

function textureScrollSpeed(
  entity: ReturnType<typeof parseEntities>[number],
  classname: string,
) {
  if (classname === "func_conveyor") {
    const speed = Number(entityValue(entity, "speed"));
    return Number.isFinite(speed) && speed !== 0 ? speed : 100;
  }

  const channels = entityValue(entity, "rendercolor")
    ?.trim()
    .split(/\s+/)
    .map(Number);
  if (
    !channels ||
    channels.length !== 3 ||
    channels.some((channel) => !Number.isFinite(channel))
  ) {
    return 0;
  }
  const magnitude = ((channels[1] ?? 0) * 256 + (channels[2] ?? 0)) / 16;
  return (channels[0] ?? 0) === 0 ? magnitude : -magnitude;
}

function modelRenderState(
  modelIndex: number,
  entities: ReturnType<typeof parseEntities>,
) {
  if (modelIndex === 0) {
    return {
      visible: true,
      entityIndex: null,
      classname: "worldspawn",
      collidable: true,
      renderMode: 0 as GoldSrcRenderMode,
      renderAmount: 255,
      renderColor: [255, 255, 255] as Vec3Tuple,
      textureScrollSpeed: 0,
    };
  }

  const entityIndex = entities.findIndex(
    (entity) => entityValue(entity, "model") === `*${modelIndex}`,
  );
  const entity = entities[entityIndex];
  if (!entity) {
    return {
      visible: false,
      entityIndex: null,
      classname: "",
      collidable: false,
      renderMode: 0 as GoldSrcRenderMode,
      renderAmount: 255,
      renderColor: [255, 255, 255] as Vec3Tuple,
      textureScrollSpeed: 0,
    };
  }

  const classname = entityValue(entity, "classname")?.toLowerCase() ?? "";
  const rawMode = Number.parseInt(entityValue(entity, "rendermode") ?? "0", 10);
  const renderMode = (
    rawMode >= 0 && rawMode <= 5 ? rawMode : 0
  ) as GoldSrcRenderMode;
  const renderAmount = byteValue(
    entityValue(entity, "renderamt"),
    renderMode === 0 || renderMode === 4 ? 255 : 0,
  );
  const visible =
    !classname.startsWith("trigger_") &&
    !movingBrushClasses.has(classname) &&
    !(
      (renderMode === 1 ||
        renderMode === 2 ||
        renderMode === 3 ||
        renderMode === 5) &&
      renderAmount === 0
    );

  return {
    visible,
    entityIndex,
    classname,
    collidable: staticSolidBrushClasses.has(classname),
    renderMode,
    renderAmount,
    renderColor: parseRenderColor(entityValue(entity, "rendercolor")),
    textureScrollSpeed: textureScrollSpeed(entity, classname),
  };
}

export function parseBsp(
  input: ArrayBuffer | ArrayBufferView,
  options: ParseBspOptions = {},
): ParsedWorld {
  const source = new BinaryView(input);
  const identification = identifyBsp(input);
  if (
    identification?.format === "quake2-bsp38" ||
    (source.byteLength >= 4 && isBsp38Magic(source.u32(0)))
  ) {
    return parseBsp38(input, options);
  }
  const { layout, lumps } = parseQuakeBspContainer(input);

  const entityLump = lumps.entities;
  const entities = parseEntities(entityLump.string(0, entityLump.byteLength));
  const audioEntities =
    layout.version === 30
      ? parseGoldSrcAudioEntities(entities)
      : { ambientSounds: [], envSounds: [], musicTracks: [] };
  const worldspawn = entities.find(
    (entity) =>
      entityValue(entity, "classname")?.toLowerCase() === "worldspawn",
  );
  const skyName = entityValue(worldspawn ?? {}, "skyname")?.trim() || null;

  const { materials, warnings: parsedTextureWarnings } = parseQuakeTextures(
    lumps.textures,
    layout,
  );
  const warnings: BspWarning[] = [...parsedTextureWarnings];

  const texinfoLump = lumps.texinfo;
  const texinfoCount = bspRecordCount(texinfoLump, 40, "texinfo");
  const mappings: TextureMapping[] = [];
  for (let index = 0; index < texinfoCount; index += 1) {
    const offset = index * 40;
    const materialIndex = texinfoLump.u32(offset + 32);
    invariant(
      materialIndex < materials.length,
      `texinfo ${index} references texture ${materialIndex}`,
    );
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
      materialIndex,
    });
  }

  const vertexLump = lumps.vertices;
  const vertexCount = bspRecordCount(vertexLump, 12, "vertex");
  const positions: Vec3Tuple[] = [];
  for (let index = 0; index < vertexCount; index += 1) {
    const offset = index * 12;
    positions.push([
      finiteBspFloat(vertexLump, offset, `vertex ${index} x`),
      finiteBspFloat(vertexLump, offset + 4, `vertex ${index} y`),
      finiteBspFloat(vertexLump, offset + 8, `vertex ${index} z`),
    ]);
  }

  const edgeLump = lumps.edges;
  const edgeCount = bspRecordCount(edgeLump, layout.edgeSize, "edge");
  const edges: Array<readonly [number, number]> = [];
  for (let index = 0; index < edgeCount; index += 1) {
    const [first, second] = readQuakeEdge(edgeLump, index, layout);
    invariant(
      first < positions.length && second < positions.length,
      `edge ${index} references an invalid vertex`,
    );
    edges.push([first, second]);
  }

  const surfedgeLump = lumps.surfedges;
  const surfedgeCount = bspRecordCount(surfedgeLump, 4, "surfedge");
  const surfaceVertexIndices = new Uint32Array(surfedgeCount);
  for (let index = 0; index < surfedgeCount; index += 1) {
    const value = surfedgeLump.i32(index * 4);
    invariant(
      value !== -2_147_483_648,
      `surfedge ${index} has an invalid index`,
    );
    const edgeIndex = Math.abs(value);
    invariant(
      edgeIndex < edges.length,
      `surfedge ${index} references edge ${edgeIndex}`,
    );
    const edge = edges[edgeIndex];
    invariant(
      edge !== undefined,
      `surfedge ${index} references a missing edge`,
    );
    surfaceVertexIndices[index] = value >= 0 ? edge[0] : edge[1];
  }

  const modelLump = lumps.models;
  const modelCount = bspRecordCount(modelLump, 64, "model");
  invariant(modelCount > 0, "BSP has no world model");
  const rawModels: RawModel[] = [];
  for (let index = 0; index < modelCount; index += 1) {
    const offset = index * 64;
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
      headnodes: [
        modelLump.i32(offset + 36),
        modelLump.i32(offset + 40),
        modelLump.i32(offset + 44),
        modelLump.i32(offset + 48),
      ],
      visLeafCount: modelLump.i32(offset + 52),
      firstFace: modelLump.u32(offset + 56),
      faceCount: modelLump.u32(offset + 60),
    });
  }
  const collisionLump = lumps.clipnodes;
  const collisionNodeCount = bspRecordCount(
    collisionLump,
    layout.clipnodeSize,
    "clipnode",
  );
  rawModels.forEach((model, modelIndex) => {
    const headnodes = model.headnodes.map((headNode, hullIndex) => {
      if (hullIndex === 0 || headNode < collisionNodeCount) return headNode;
      invariant(
        headNode === collisionNodeCount,
        `BSP collision hull has invalid headnode ${headNode}`,
      );
      warnings.push({
        code: "noncanonical-collision-headnode",
        message: `model ${modelIndex} collision hull ${hullIndex} uses one-past-end headnode ${headNode}; the empty hull sentinel was substituted`,
        modelIndex,
        hullIndex,
        headNode,
      });
      return -1;
    });
    rawModels[modelIndex] = { ...model, headnodes };
  });
  const planes = parsePlanes(lumps.planes);
  const trace = parseTrace(
    planes,
    lumps.nodes,
    lumps.leaves,
    rawModels[0]!.headnodes[0]!,
    layout,
  );
  const collision = parseCollision(
    planes,
    collisionLump,
    rawModels.flatMap((model) => model.headnodes.slice(1, 2)),
    layout,
  );

  const faceLump = lumps.faces;
  const faceCount = bspRecordCount(faceLump, layout.faceSize, "face");
  const visibilityResult = parseVisibility(
    lumps.leaves,
    lumps.marksurfaces,
    lumps.visibility,
    rawModels[0]!.visLeafCount,
    faceCount,
    layout,
  );
  const visibility = visibilityResult.visibility;
  if (visibilityResult.clippedRun) {
    warnings.push({
      code: "noncanonical-visibility-run",
      message:
        "BSP visibility contains a zero run longer than its row; the run was safely clipped",
    });
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

  const lighting = lumps.lighting;
  const pageSize = options.lightmapPageSize ?? LIGHTMAP_PAGE_SIZE;
  invariant(
    Number.isInteger(pageSize) && pageSize > 0 && pageSize <= 65_535,
    "invalid lightmap page size",
  );
  const packer = new LightmapPacker(pageSize, pageSize);
  const rawFaces: RawFace[] = [];
  const lightmaps: ParsedLightmap[] = [];

  for (let sourceIndex = 0; sourceIndex < faceCount; sourceIndex += 1) {
    const face = readQuakeFace(faceLump, sourceIndex, layout);
    const { firstEdge, edgeCount: edgeCountForFace, mappingIndex } = face;
    invariant(
      face.planeIndex >= 0 && face.planeIndex < planes.length / 4,
      `face ${sourceIndex} references plane ${face.planeIndex}`,
    );
    invariant(
      face.side === 0 || face.side === 1,
      `face ${sourceIndex} has invalid side ${face.side}`,
    );
    invariant(
      firstEdge >= 0,
      `face ${sourceIndex} has a negative first surfedge`,
    );
    invariant(
      edgeCountForFace >= 0,
      `face ${sourceIndex} has a negative edge count`,
    );
    invariant(
      firstEdge + edgeCountForFace <= surfaceVertexIndices.length,
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
    if (edgeCountForFace < 3) {
      warnings.push({
        code: "degenerate-face",
        message: `face ${sourceIndex} has ${edgeCountForFace} edges and was omitted from render geometry`,
        faceIndex: sourceIndex,
        modelIndex,
        edgeCount: edgeCountForFace,
      });
      continue;
    }

    let minimumS = Number.POSITIVE_INFINITY;
    let minimumT = Number.POSITIVE_INFINITY;
    let maximumS = Number.NEGATIVE_INFINITY;
    let maximumT = Number.NEGATIVE_INFINITY;
    for (let edge = 0; edge < edgeCountForFace; edge += 1) {
      const positionIndex = surfaceVertexIndices[firstEdge + edge];
      const position = positions[positionIndex ?? positions.length];
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

    const width = Math.ceil(maximumS / 16) - Math.floor(minimumS / 16) + 1;
    const height = Math.ceil(maximumT / 16) - Math.floor(minimumT / 16) + 1;
    invariant(
      Number.isSafeInteger(width) &&
        Number.isSafeInteger(height) &&
        width > 0 &&
        height > 0,
      `face ${sourceIndex} has invalid lightmap dimensions`,
    );
    const styles: number[] = [];
    for (const value of face.styles) {
      if (value === 255) break;
      styles.push(value);
    }
    const lightOffset = face.lightOffset;
    let samples: Uint8Array | null = null;
    const allocation: MutableAllocation = {
      width,
      height,
      pageIndex: -1,
      pageX: 0,
      pageY: 0,
    };
    if (lightOffset !== -1 && styles.length > 0) {
      invariant(
        lightOffset >= 0,
        `face ${sourceIndex} has an invalid light offset`,
      );
      const sampleLength = checkedBspProduct(
        checkedBspProduct(width, height, `face ${sourceIndex} lightmap`),
        styles.length * layout.lightmapBytesPerTexel,
        `face ${sourceIndex} styled lightmap`,
      );
      lighting.require(
        lightOffset,
        sampleLength,
        `face ${sourceIndex} light samples`,
      );
      samples = lighting.uint8Array(lightOffset, sampleLength).slice();
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
      edgeCount: edgeCountForFace,
      mapping,
      lightmapMapping: {
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
    const state = modelRenderState(modelIndex, entities);
    return {
      bounds: model.bounds,
      headnodes: model.headnodes,
      faceIndices: Array.from(
        { length: model.faceCount },
        (_, index) => model.firstFace + index,
      ),
      visible: state.visible,
      entityIndex: state.entityIndex,
      classname: state.classname,
      collidable: state.collidable,
      renderMode: state.renderMode,
      renderAmount: state.renderAmount,
      renderColor: state.renderColor,
      textureScrollSpeed: state.textureScrollSpeed,
    };
  });

  const worldModel = models[0];
  if (!worldModel) invalidData("BSP has no world model");
  return {
    format: layout.format,
    version: layout.version,
    warnings,
    bounds: worldModel.bounds,
    entities,
    skyName,
    wadReferences: wadReferences(entities),
    ambientSounds: audioEntities.ambientSounds,
    envSounds: audioEntities.envSounds,
    musicTracks: audioEntities.musicTracks,
    trace,
    visibility,
    collision,
    vertices: geometry.vertices,
    indices: geometry.indices,
    materials,
    faces: geometry.faces,
    batches: geometry.batches,
    models,
    hasLighting: lighting.byteLength > 0,
    lightmapPages: packer.finish(lightmaps),
    lightmapBytesPerTexel: layout.lightmapBytesPerTexel,
    hasAnimatedLightmaps: lightmaps.some((lightmap) =>
      lightmap.styles.some((style) => style !== 0),
    ),
  };
}
