import type { Vec3 } from "./types";
import type {
  CompiledBrush,
  CompiledEntityCapabilities,
  CompiledIndexedMesh,
  CompiledRenderBatch,
  PlayerSpawn,
  ResetMarker,
  Vec2,
  WorldBundle,
  WorldSettings,
} from "./world";

const MAGIC = 0x44525747; // GWRD in little endian
const FORMAT_VERSION = 1;
const HEADER_BYTES = 8;
const SECTION_ENTRY_BYTES = 10;
const METADATA_SECTION = 1;
const ENTITIES_SECTION = 2;
const GEOMETRY_SECTION = 3;

type Section = { type: number; bytes: Uint8Array };
type BrushMetadata = Omit<
  CompiledBrush,
  | "worldVertices"
  | "localVertices"
  | "triangles"
  | "triangleSourceFaces"
  | "triangleNormals"
  | "triangleUvs"
>;

export function encodeWorldBundle<TEntity extends CompiledEntityCapabilities>(
  bundle: WorldBundle<TEntity>,
): Uint8Array {
  if (bundle.bundleVersion !== FORMAT_VERSION)
    throw new Error(
      `unsupported world bundle version ${String((bundle as { bundleVersion: number }).bundleVersion)}`,
    );
  const encoder = new TextEncoder();
  const sections: Section[] = [
    {
      type: METADATA_SECTION,
      bytes: encoder.encode(
        JSON.stringify({
          mapRevision: bundle.mapRevision,
          sourceName: bundle.sourceName,
          settings: bundle.settings,
          playerSpawns: bundle.playerSpawns,
          resetMarkers: bundle.resetMarkers,
          brushes: bundle.brushes.map(
            ({
              worldVertices: _world,
              localVertices: _local,
              triangles: _triangles,
              triangleSourceFaces: _faces,
              triangleNormals: _normals,
              triangleUvs: _uvs,
              ...metadata
            }) => metadata,
          ),
        }),
      ),
    },
    {
      type: ENTITIES_SECTION,
      bytes: encoder.encode(JSON.stringify(bundle.entities)),
    },
    { type: GEOMETRY_SECTION, bytes: encodeGeometry(bundle.brushes) },
  ];
  const tableBytes = sections.length * SECTION_ENTRY_BYTES;
  const totalBytes =
    HEADER_BYTES +
    tableBytes +
    sections.reduce((sum, section) => sum + section.bytes.byteLength, 0);
  const output = new Uint8Array(totalBytes);
  const view = new DataView(output.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint16(4, FORMAT_VERSION, true);
  view.setUint16(6, sections.length, true);
  let payloadOffset = HEADER_BYTES + tableBytes;
  sections.forEach((section, index) => {
    const entry = HEADER_BYTES + index * SECTION_ENTRY_BYTES;
    view.setUint16(entry, section.type, true);
    view.setUint32(entry + 2, payloadOffset, true);
    view.setUint32(entry + 6, section.bytes.byteLength, true);
    output.set(section.bytes, payloadOffset);
    payloadOffset += section.bytes.byteLength;
  });
  return output;
}

export function deriveWorldBuffers(
  brushes: CompiledBrush[],
  entities: CompiledEntityCapabilities[],
): {
  staticCollision: CompiledIndexedMesh;
  renderBatches: CompiledRenderBatch[];
} {
  const staticCollision: CompiledIndexedMesh = {
    vertices: [],
    triangles: [],
    triangleSources: [],
  };
  const batches = new Map<string, CompiledRenderBatch>();
  const bodyBrushes = new Map<number, CompiledEntityCapabilities>();
  entities.forEach((entity) => {
    entity.body?.brushIndices.forEach((brushIndex) =>
      bodyBrushes.set(brushIndex, entity),
    );
  });
  for (const [brushIndex, brush] of brushes.entries()) {
    const owner = bodyBrushes.get(brushIndex);
    const collisionOnlyFaces = new Set(brush.collisionOnlyFaceIndices);
    if (!owner) {
      const offset = staticCollision.vertices.length;
      staticCollision.vertices.push(
        ...brush.worldVertices.map((vertex) => ({ ...vertex })),
      );
      brush.triangles.forEach(([a, b, c], triangleIndex) => {
        staticCollision.triangles.push([a + offset, b + offset, c + offset]);
        staticCollision.triangleSources.push({
          entityIndex: brush.entityIndex,
          brushIndex: brush.sourceBrushIndex,
          faceIndex: brush.triangleSourceFaces[triangleIndex]!,
        });
      });
    }
    if (owner && owner.presentation.kind !== "brush") continue;
    if (
      owner?.presentation.kind === "brush" &&
      owner.presentation.transform === "body"
    )
      continue;
    brush.triangles.forEach((triangle, triangleIndex) => {
      if (collisionOnlyFaces.has(brush.triangleSourceFaces[triangleIndex]!))
        return;
      const material = brush.triangleMaterials[triangleIndex]!;
      const sensor = owner?.body?.kind === "sensor-brush";
      const key = `${material}\0${Number(sensor)}`;
      let batch = batches.get(key);
      if (!batch) {
        batch = {
          material,
          sensor,
          positions: [],
          normals: [],
          uvs: [],
          indices: [],
          triangleSources: [],
        };
        batches.set(key, batch);
      }
      const offset = batch.positions.length;
      for (let corner = 0; corner < 3; corner += 1) {
        batch.positions.push({ ...brush.worldVertices[triangle[corner]!]! });
        batch.normals.push({ ...brush.triangleNormals[triangleIndex]! });
        batch.uvs.push({ ...brush.triangleUvs[triangleIndex]![corner]! });
        batch.indices.push(offset + corner);
      }
      batch.triangleSources.push({
        entityIndex: brush.entityIndex,
        brushIndex: brush.sourceBrushIndex,
        faceIndex: brush.triangleSourceFaces[triangleIndex]!,
      });
    });
  }
  return {
    staticCollision,
    renderBatches: [...batches.values()].toSorted(
      (a, b) =>
        a.material.localeCompare(b.material) ||
        Number(a.sensor) - Number(b.sensor),
    ),
  };
}

export type DecodeCompiledEntities<TEntity extends CompiledEntityCapabilities> =
  (value: unknown) => TEntity[];

export function decodeWorldBundle<TEntity extends CompiledEntityCapabilities>(
  input: ArrayBuffer | ArrayBufferView,
  decodeEntities: DecodeCompiledEntities<TEntity>,
): WorldBundle<TEntity> {
  const bytes =
    input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.byteLength < HEADER_BYTES)
    throw new Error("world bundle header is truncated");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC)
    throw new Error("world bundle magic mismatch");
  if (view.getUint16(4, true) !== FORMAT_VERSION)
    throw new Error("unsupported world bundle version");
  const sectionCount = view.getUint16(6, true);
  if (bytes.byteLength < HEADER_BYTES + sectionCount * SECTION_ENTRY_BYTES)
    throw new Error("world bundle section table is truncated");
  const sections = new Map<number, Uint8Array>();
  for (let index = 0; index < sectionCount; index += 1) {
    const entry = HEADER_BYTES + index * SECTION_ENTRY_BYTES;
    const type = view.getUint16(entry, true);
    const offset = view.getUint32(entry + 2, true);
    const length = view.getUint32(entry + 6, true);
    if (sections.has(type))
      throw new Error(`duplicate world bundle section ${type}`);
    if (
      offset < HEADER_BYTES + sectionCount * SECTION_ENTRY_BYTES ||
      offset + length > bytes.byteLength
    ) {
      throw new Error(`world bundle section ${type} is out of bounds`);
    }
    sections.set(type, bytes.slice(offset, offset + length));
  }
  const decoder = new TextDecoder();
  const metadataBytes = requiredSection(sections, METADATA_SECTION);
  const entityBytes = requiredSection(sections, ENTITIES_SECTION);
  const geometryBytes = requiredSection(sections, GEOMETRY_SECTION);
  const metadata = JSON.parse(decoder.decode(metadataBytes)) as {
    mapRevision: string;
    sourceName: string;
    settings: WorldSettings;
    playerSpawns: PlayerSpawn[];
    resetMarkers: ResetMarker[];
    brushes: BrushMetadata[];
  };
  if (!/^[0-9a-f]{64}$/.test(metadata.mapRevision))
    throw new Error("world bundle revision is invalid");
  assertMetadata(metadata);
  const entitiesValue: unknown = JSON.parse(decoder.decode(entityBytes));
  const entities = decodeEntities(entitiesValue);
  const brushes = decodeGeometry(geometryBytes, metadata.brushes);
  validateBrushReferences(entities, brushes.length);
  const derived = deriveWorldBuffers(brushes, entities);
  return {
    bundleVersion: FORMAT_VERSION,
    mapRevision: metadata.mapRevision,
    sourceName: metadata.sourceName,
    settings: metadata.settings,
    playerSpawns: metadata.playerSpawns,
    resetMarkers: metadata.resetMarkers,
    entities,
    brushes,
    ...derived,
  };
}

function encodeGeometry(brushes: CompiledBrush[]): Uint8Array {
  const byteLength = brushes.reduce(
    (sum, brush) =>
      sum +
      4 +
      brush.worldVertices.length * 24 +
      4 +
      brush.triangles.length * 88,
    0,
  );
  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (const brush of brushes) {
    assertParallelBrushData(brush);
    view.setUint32(offset, brush.worldVertices.length, true);
    offset += 4;
    for (const vertex of brush.worldVertices)
      offset = writeVec3(view, offset, vertex);
    view.setUint32(offset, brush.triangles.length, true);
    offset += 4;
    for (let index = 0; index < brush.triangles.length; index += 1) {
      const triangle = brush.triangles[index]!;
      view.setUint32(offset, triangle[0], true);
      view.setUint32(offset + 4, triangle[1], true);
      view.setUint32(offset + 8, triangle[2], true);
      view.setUint32(offset + 12, brush.triangleSourceFaces[index]!, true);
      offset = writeVec3(view, offset + 16, brush.triangleNormals[index]!);
      for (const uv of brush.triangleUvs[index]!) {
        view.setFloat64(offset, uv.x, true);
        view.setFloat64(offset + 8, uv.y, true);
        offset += 16;
      }
    }
  }
  return bytes;
}

function decodeGeometry(
  bytes: Uint8Array,
  metadata: BrushMetadata[],
): CompiledBrush[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const brushes: CompiledBrush[] = [];
  for (const brush of metadata) {
    requireBytes(view, offset, 4);
    const vertexCount = view.getUint32(offset, true);
    offset += 4;
    const worldVertices: Vec3[] = [];
    for (let index = 0; index < vertexCount; index += 1) {
      requireBytes(view, offset, 24);
      worldVertices.push(readVec3(view, offset));
      offset += 24;
    }
    requireBytes(view, offset, 4);
    const triangleCount = view.getUint32(offset, true);
    offset += 4;
    const triangles: Array<[number, number, number]> = [];
    const triangleSourceFaces: number[] = [];
    const triangleNormals: Vec3[] = [];
    const triangleUvs: Array<[Vec2, Vec2, Vec2]> = [];
    for (let index = 0; index < triangleCount; index += 1) {
      requireBytes(view, offset, 88);
      const triangle: [number, number, number] = [
        view.getUint32(offset, true),
        view.getUint32(offset + 4, true),
        view.getUint32(offset + 8, true),
      ];
      if (triangle.some((vertex) => vertex >= vertexCount))
        throw new Error("world bundle triangle index is out of bounds");
      triangles.push(triangle);
      triangleSourceFaces.push(view.getUint32(offset + 12, true));
      triangleNormals.push(readVec3(view, offset + 16));
      offset += 40;
      const uvs: Vec2[] = [];
      for (let corner = 0; corner < 3; corner += 1) {
        uvs.push({
          x: view.getFloat64(offset, true),
          y: view.getFloat64(offset + 8, true),
        });
        offset += 16;
      }
      triangleUvs.push(uvs as [Vec2, Vec2, Vec2]);
    }
    if (brush.triangleMaterials.length !== triangleCount)
      throw new Error("world bundle material count mismatch");
    const compiledBrush: CompiledBrush = {
      ...brush,
      worldVertices,
      localVertices: worldVertices.map((vertex) => ({
        x: vertex.x - brush.center.x,
        y: vertex.y - brush.center.y,
        z: vertex.z - brush.center.z,
      })),
      triangles,
      triangleSourceFaces,
      triangleNormals,
      triangleUvs,
    };
    assertParallelBrushData(compiledBrush);
    brushes.push(compiledBrush);
  }
  if (offset !== view.byteLength)
    throw new Error("world bundle geometry has trailing bytes");
  return brushes;
}

function requiredSection(
  sections: Map<number, Uint8Array>,
  type: number,
): Uint8Array {
  const section = sections.get(type);
  if (!section) throw new Error(`world bundle section ${type} is missing`);
  return section;
}
function writeVec3(view: DataView, offset: number, value: Vec3): number {
  view.setFloat64(offset, value.x, true);
  view.setFloat64(offset + 8, value.y, true);
  view.setFloat64(offset + 16, value.z, true);
  return offset + 24;
}
function readVec3(view: DataView, offset: number): Vec3 {
  return {
    x: view.getFloat64(offset, true),
    y: view.getFloat64(offset + 8, true),
    z: view.getFloat64(offset + 16, true),
  };
}
function requireBytes(view: DataView, offset: number, count: number): void {
  if (offset + count > view.byteLength)
    throw new Error("world bundle geometry is truncated");
}
function assertParallelBrushData(brush: CompiledBrush): void {
  const count = brush.triangles.length;
  if (
    brush.triangleMaterials.length !== count ||
    brush.triangleSourceFaces.length !== count ||
    brush.triangleNormals.length !== count ||
    brush.triangleUvs.length !== count
  )
    throw new Error(
      `compiled brush ${brush.entityIndex}:${brush.sourceBrushIndex} has inconsistent triangle data`,
    );
  const sourceFaces = new Set(brush.triangleSourceFaces);
  if (
    new Set(brush.collisionOnlyFaceIndices).size !==
      brush.collisionOnlyFaceIndices.length ||
    brush.collisionOnlyFaceIndices.some(
      (faceIndex) =>
        !Number.isSafeInteger(faceIndex) || !sourceFaces.has(faceIndex),
    )
  )
    throw new Error(
      `compiled brush ${brush.entityIndex}:${brush.sourceBrushIndex} has invalid collision-only faces`,
    );
}

function assertMetadata(value: unknown): asserts value is {
  mapRevision: string;
  sourceName: string;
  settings: WorldSettings;
  playerSpawns: PlayerSpawn[];
  resetMarkers: ResetMarker[];
  brushes: BrushMetadata[];
} {
  if (!isRecord(value))
    throw new Error("world bundle metadata must be an object");
  if (typeof value.sourceName !== "string")
    throw new Error("world bundle sourceName must be a string");
  if (!isRecord(value.settings))
    throw new Error("world bundle settings must be an object");
  assertString(value.settings.title, "world bundle title");
  assertVec3(value.settings.gravity, "world bundle gravity");
  if (
    !isRecord(value.settings.skyColor) ||
    !finite(value.settings.skyColor.r) ||
    !finite(value.settings.skyColor.g) ||
    !finite(value.settings.skyColor.b)
  )
    throw new Error("world bundle skyColor must contain finite RGB components");
  if (!Array.isArray(value.playerSpawns) || value.playerSpawns.length === 0)
    throw new Error("world bundle requires player spawns");
  const spawnNames = new Set<string>();
  for (const spawn of value.playerSpawns) {
    if (!isRecord(spawn))
      throw new Error("world bundle player spawn must be an object");
    assertString(spawn.name, "world bundle player spawn name");
    assertVec3(spawn.position, "world bundle player spawn position");
    if (!finite(spawn.yaw))
      throw new Error("world bundle player spawn yaw must be finite");
    if (spawnNames.has(spawn.name))
      throw new Error(`world bundle duplicate player spawn name ${spawn.name}`);
    spawnNames.add(spawn.name);
  }
  if (!spawnNames.has("default"))
    throw new Error("world bundle requires a player spawn named default");
  if (!Array.isArray(value.resetMarkers))
    throw new Error("world bundle resetMarkers must be an array");
  for (const marker of value.resetMarkers) {
    if (!isRecord(marker))
      throw new Error("world bundle reset marker must be an object");
    assertString(marker.label, "world bundle reset marker label");
    assertVec3(marker.position, "world bundle reset marker position");
  }
  if (!Array.isArray(value.brushes))
    throw new Error("world bundle brushes must be an array");
  for (const brush of value.brushes) {
    if (!isRecord(brush))
      throw new Error("world bundle brush metadata must be an object");
    if (
      !Number.isSafeInteger(brush.entityIndex) ||
      !Number.isSafeInteger(brush.sourceBrushIndex)
    )
      throw new Error("world bundle brush indices must be integers");
    assertVec3(brush.center, "world bundle brush center");
    if (
      !Array.isArray(brush.triangleMaterials) ||
      !brush.triangleMaterials.every((material) => typeof material === "string")
    )
      throw new Error("world bundle brush materials must be strings");
    if (
      !Array.isArray(brush.collisionOnlyFaceIndices) ||
      !brush.collisionOnlyFaceIndices.every(
        (faceIndex) =>
          Number.isSafeInteger(faceIndex) && Number(faceIndex) >= 0,
      )
    )
      throw new Error(
        "world bundle collision-only face indices must be non-negative integers",
      );
  }
}

export function decodeCompiledEntityCapabilities(
  value: unknown,
): CompiledEntityCapabilities[] {
  if (!Array.isArray(value))
    throw new Error("world bundle entities must be an array");
  for (const entity of value) {
    if (!isRecord(entity))
      throw new Error("world bundle entity must be an object");
    assertString(entity.kind, "world bundle entity kind");
    if (
      entity.interaction !== "none" &&
      entity.interaction !== "use" &&
      entity.interaction !== "grab" &&
      entity.interaction !== "manipulate"
    )
      throw new Error("world bundle entity interaction is invalid");
    assertPresentation(entity.presentation);
    if (entity.origin !== undefined)
      assertVec3(entity.origin, "world bundle entity origin");
    if (entity.authoredId !== undefined)
      assertString(entity.authoredId, "world bundle entity authoredId");
    if (entity.body !== null) assertBody(entity.body);
  }
  return value as CompiledEntityCapabilities[];
}

function validateBrushReferences(
  entities: CompiledEntityCapabilities[],
  brushCount: number,
): void {
  const owners = new Set<number>();
  entities.forEach((entity, entityIndex) => {
    for (const brushIndex of entity.body?.brushIndices ?? []) {
      if (
        !Number.isSafeInteger(brushIndex) ||
        brushIndex < 0 ||
        brushIndex >= brushCount
      )
        throw new Error(
          `world bundle entity ${entityIndex} has an invalid brush index`,
        );
      if (owners.has(brushIndex))
        throw new Error(
          `world bundle brush ${brushIndex} has multiple body owners`,
        );
      owners.add(brushIndex);
    }
  });
}

function assertBody(value: unknown): void {
  if (
    !isRecord(value) ||
    (value.kind !== "dynamic-brush" &&
      value.kind !== "kinematic-brush" &&
      value.kind !== "static-brush" &&
      value.kind !== "sensor-brush") ||
    !Array.isArray(value.brushIndices)
  )
    throw new Error("world bundle body kind is invalid");
  if (
    !value.brushIndices.every(
      (index) => Number.isSafeInteger(index) && Number(index) >= 0,
    )
  )
    throw new Error(
      "world bundle body brush indices must be non-negative integers",
    );
  if (value.kind === "dynamic-brush")
    assertFiniteFields(value, [
      "density",
      "friction",
      "restitution",
      "gravityScale",
    ]);
}

function assertPresentation(value: unknown): void {
  if (!isRecord(value))
    throw new Error("world bundle presentation must be an object");
  if (value.kind === "none") return;
  if (value.kind === "brush") {
    if (value.transform !== "world" && value.transform !== "body")
      throw new Error("world bundle brush presentation transform is invalid");
    return;
  }
  if (value.kind === "sprite") {
    assertString(value.asset, "world bundle sprite asset");
    if (!/^[a-z0-9][a-z0-9/_-]*$/.test(value.asset))
      throw new Error(
        "world bundle sprite asset must be an extensionless logical ID",
      );
    if (!finite(value.height) || typeof value.glow !== "boolean")
      throw new Error("world bundle sprite presentation is invalid");
    return;
  }
  if (value.kind === "constraint") {
    if (
      value.style !== "hinge" &&
      value.style !== "motor" &&
      value.style !== "slider" &&
      value.style !== "ball-socket" &&
      value.style !== "rope" &&
      value.style !== "rod" &&
      value.style !== "spring" &&
      value.style !== "weld"
    )
      throw new Error("world bundle constraint presentation style is invalid");
    return;
  }
  if (value.kind === "light") {
    assertRgb(value.color, "world bundle light color");
    if (!finite(value.intensity) || value.intensity < 0)
      throw new Error("world bundle light intensity must not be negative");
    if (value.mode === "ambient") {
      if (!finite(value.volumeDensity) || value.volumeDensity < 0)
        throw new Error(
          "world bundle ambient light volume density must not be negative",
        );
      return;
    }
    if (value.mode === "directional") {
      assertDirection(
        value.direction,
        "world bundle directional light direction",
      );
      if (
        typeof value.castShadow !== "boolean" ||
        !finite(value.shadowDistance) ||
        value.shadowDistance <= 0
      )
        throw new Error(
          "world bundle directional light presentation is invalid",
        );
      return;
    }
    if (value.mode === "point") {
      assertLocalLight(value);
      return;
    }
    if (value.mode === "spot") {
      assertLocalLight(value);
      assertDirection(value.direction, "world bundle spot light direction");
      if (
        !finite(value.angle) ||
        value.angle <= 0 ||
        value.angle > Math.PI / 2 ||
        !finite(value.penumbra) ||
        value.penumbra < 0 ||
        value.penumbra > 1
      )
        throw new Error("world bundle spot light cone is invalid");
      return;
    }
    throw new Error("world bundle light mode is invalid");
  }
  throw new Error("world bundle presentation kind is invalid");
}

function assertLocalLight(value: Record<string, unknown>): void {
  if (
    !finite(value.range) ||
    value.range <= 0 ||
    !finite(value.decay) ||
    value.decay < 0 ||
    typeof value.castShadow !== "boolean" ||
    typeof value.volumetric !== "boolean"
  )
    throw new Error("world bundle local light presentation is invalid");
}

function assertDirection(value: unknown, label: string): void {
  assertVec3(value, label);
  if (Math.hypot(value.x, value.y, value.z) < 1e-6)
    throw new Error(`${label} must not be zero`);
}

function assertRgb(value: unknown, label: string): void {
  if (
    !isRecord(value) ||
    !finite(value.r) ||
    !finite(value.g) ||
    !finite(value.b) ||
    value.r < 0 ||
    value.r > 1 ||
    value.g < 0 ||
    value.g > 1 ||
    value.b < 0 ||
    value.b > 1
  )
    throw new Error(
      `${label} must contain RGB components between zero and one`,
    );
}

function assertFiniteFields(
  value: Record<string, unknown>,
  fields: string[],
): void {
  for (const field of fields)
    if (!finite(value[field]))
      throw new Error(`world bundle ${field} must be finite`);
}

function assertVec3(value: unknown, label: string): asserts value is Vec3 {
  if (
    !isRecord(value) ||
    !finite(value.x) ||
    !finite(value.y) ||
    !finite(value.z)
  )
    throw new Error(`${label} must contain finite x, y, and z`);
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${label} must be a string`);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
