import { translatedBounds, unionBounds } from "../core/math.js";
import type { Bounds, MapBrush, Vec3 } from "../core/index.js";
import { uploadFloatBuffer } from "./gpu-buffer.js";

export interface SolidBatch {
  readonly cacheKey: string;
  readonly signature: string;
  readonly materialName: string;
  readonly buffer: GPUBuffer;
  readonly count: number;
  readonly bounds: Bounds;
  readonly sources: readonly SolidBatchSource[];
}

interface SolidBatchSource {
  readonly key: string;
  readonly vertices: number[];
}

interface PendingSolidBatch {
  readonly cacheKey: string;
  readonly materialName: string;
  readonly sources: Map<string, SolidBatchSource>;
  bounds: Bounds;
}

export interface SolidVertexSink {
  readonly retained: boolean;
  push(...vertices: number[]): number;
}

const SPATIAL_BATCH_SIZE = 512;
const floatBits = new DataView(new ArrayBuffer(8));
const brushGeometrySignatures = new WeakMap<MapBrush, string>();

/** Identifies the actual GPU input, including same-revision transient drag previews. */
export function brushSolidSignature(brush: MapBrush, offset: Vec3): string {
  const cached = brushGeometrySignatures.get(brush);
  if (cached) return `${cached}:${offset.join(",")}`;
  let hash = 2166136261;
  const mixInteger = (value: number) => {
    hash ^= value;
    hash = Math.imul(hash, 16777619);
  };
  const mixString = (value: string) => {
    for (const character of value) mixInteger(character.charCodeAt(0));
  };
  const mixNumber = (value: number) => {
    floatBits.setFloat64(0, value, true);
    mixInteger(floatBits.getUint32(0, true));
    mixInteger(floatBits.getUint32(4, true));
  };
  mixString(brush.id);
  mixInteger(brush.revision);
  for (const face of brush.faces) {
    mixString(face.id);
    mixString(face.material);
    for (const point of face.planePoints)
      for (const component of point) mixNumber(component);
    for (const component of face.projection.uAxis) mixNumber(component);
    for (const component of face.projection.vAxis) mixNumber(component);
    for (const component of face.projection.offset) mixNumber(component);
    mixNumber(face.projection.rotationDegrees);
    for (const component of face.projection.scale) mixNumber(component);
  }
  const signature = `${brush.id}:${brush.revision}:${(hash >>> 0).toString(16)}`;
  brushGeometrySignatures.set(brush, signature);
  return `${signature}:${offset.join(",")}`;
}

function upload(device: GPUDevice, data: Float32Array): GPUBuffer {
  return uploadFloatBuffer(
    device,
    data,
    GPUBufferUsage.VERTEX,
    "Worldview solid batch",
  );
}

/** Collects material batches in stable world-space cells so viewports can frustum-cull dense maps. */
export class SolidBatchBuilder {
  private readonly batches = new Map<string, PendingSolidBatch>();
  private readonly previousSources: ReadonlyMap<string, SolidBatchSource>;
  private readonly retainedSourceKeys = new Set<string>();
  private readonly discardedWrites: SolidVertexSink = {
    retained: true,
    push: () => 0,
  };

  public constructor(private readonly previous: readonly SolidBatch[] = []) {
    this.previousSources = new Map(
      previous.flatMap((batch) =>
        batch.sources.map((source) => [source.key, source] as const),
      ),
    );
  }

  public vertices(
    materialName: string,
    bounds: Bounds,
    offset: Vec3,
    sourceSignature: string,
  ): SolidVertexSink {
    const translated = translatedBounds(bounds, offset);
    const center = translated.min.map(
      (minimum, axis) => (minimum + translated.max[axis]!) / 2,
    );
    const cell = center.map((value) => Math.floor(value / SPATIAL_BATCH_SIZE));
    const key = `${materialName.trim().toLowerCase()}\0${cell.join(",")}`;
    const sourceKey = `${key}\0${sourceSignature}`;
    const existing = this.batches.get(key);
    if (existing) {
      existing.bounds = unionBounds(existing.bounds, translated);
      const source = existing.sources.get(sourceKey);
      if (source) {
        return this.retainedSourceKeys.has(sourceKey)
          ? this.discardedWrites
          : {
              retained: false,
              push: (...vertices) => source.vertices.push(...vertices),
            };
      }
      const previousSource = this.previousSources.get(sourceKey);
      const created = previousSource ?? { key: sourceKey, vertices: [] };
      if (previousSource) this.retainedSourceKeys.add(sourceKey);
      existing.sources.set(sourceKey, created);
      return previousSource
        ? this.discardedWrites
        : {
            retained: false,
            push: (...vertices) => created.vertices.push(...vertices),
          };
    }
    const previousSource = this.previousSources.get(sourceKey);
    const source = previousSource ?? { key: sourceKey, vertices: [] };
    if (previousSource) this.retainedSourceKeys.add(sourceKey);
    const created: PendingSolidBatch = {
      cacheKey: key,
      materialName,
      sources: new Map([[sourceKey, source]]),
      bounds: translated,
    };
    this.batches.set(key, created);
    return previousSource
      ? this.discardedWrites
      : {
          retained: false,
          push: (...vertices) => source.vertices.push(...vertices),
        };
  }

  public finish(device: GPUDevice): readonly SolidBatch[] {
    const previousByKey = new Map(
      this.previous.map((batch) => [batch.cacheKey, batch]),
    );
    return [...this.batches.values()].map(
      ({ cacheKey, materialName, sources, bounds }) => {
        const sourceList = [...sources.values()];
        const signature = sourceList.map(({ key }) => key).join("\0");
        const count = sourceList.reduce(
          (total, source) => total + source.vertices.length / 8,
          0,
        );
        const previous = previousByKey.get(cacheKey);
        if (previous?.signature === signature && previous.count === count)
          return previous;
        const vertices = sourceList.flatMap((source) => source.vertices);
        return {
          cacheKey,
          signature,
          materialName,
          buffer: upload(device, new Float32Array(vertices)),
          count,
          bounds,
          sources: sourceList,
        };
      },
    );
  }
}
