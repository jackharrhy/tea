import { translatedBounds, unionBounds } from "../core/math.js";
import type { Bounds, Vec3 } from "../core/index.js";
import { uploadFloatBuffer } from "./gpu-buffer.js";

export interface LineBatchSource {
  readonly key: string;
  readonly signature: string;
  readonly vertices: readonly number[];
}

export interface LineBatch {
  readonly cacheKey: string;
  readonly signature: string;
  readonly buffer: GPUBuffer;
  readonly count: number;
  readonly bounds: Bounds;
  readonly sources: readonly LineBatchSource[];
}

interface PendingLineBatch {
  readonly cacheKey: string;
  readonly sources: LineBatchSource[];
  bounds: Bounds;
}

const SPATIAL_BATCH_SIZE = 512;

/** Retains immutable brush edge data and only uploads spatial batches whose sources changed. */
export class LineBatchBuilder {
  private readonly batches = new Map<string, PendingLineBatch>();
  private readonly previousSources: ReadonlyMap<string, LineBatchSource>;

  public constructor(
    private readonly device: GPUDevice,
    private readonly previous: readonly LineBatch[] = [],
  ) {
    this.previousSources = new Map(
      previous.flatMap((batch) =>
        batch.sources.map((source) => [source.key, source] as const),
      ),
    );
  }

  public add(
    key: string,
    signature: string,
    bounds: Bounds,
    offset: Vec3,
    buildVertices: () => readonly number[],
  ): void {
    const translated = translatedBounds(bounds, offset);
    const center = translated.min.map(
      (minimum, axis) => (minimum + translated.max[axis]!) / 2,
    );
    const cacheKey = center
      .map((value) => Math.floor(value / SPATIAL_BATCH_SIZE))
      .join(",");
    const previousSource = this.previousSources.get(key);
    const source =
      previousSource?.signature === signature
        ? previousSource
        : { key, signature, vertices: buildVertices() };
    const batch = this.batches.get(cacheKey);
    if (batch) {
      batch.sources.push(source);
      batch.bounds = unionBounds(batch.bounds, translated);
    } else {
      this.batches.set(cacheKey, {
        cacheKey,
        sources: [source],
        bounds: translated,
      });
    }
  }

  public finish(): readonly LineBatch[] {
    const previousByKey = new Map(
      this.previous.map((batch) => [batch.cacheKey, batch]),
    );
    return [...this.batches.values()].map(({ cacheKey, sources, bounds }) => {
      const signature = sources
        .map((source) => `${source.key}:${source.signature}`)
        .join("\0");
      const previous = previousByKey.get(cacheKey);
      if (previous?.signature === signature) return previous;
      const vertices = new Float32Array(
        sources.flatMap((source) => source.vertices),
      );
      return {
        cacheKey,
        signature,
        buffer: uploadFloatBuffer(
          this.device,
          vertices,
          GPUBufferUsage.VERTEX,
          `World edges ${cacheKey}`,
        ),
        count: vertices.length / 6,
        bounds,
        sources,
      };
    });
  }
}
