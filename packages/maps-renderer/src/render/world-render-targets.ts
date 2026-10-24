import type { TgpuRoot, TgpuTexture } from "typegpu";

import {
  WALKABILITY_CUTAWAY_EMPTY,
  type WalkabilityCutawayGrid,
} from "../walkability/index.js";
import { RENDER_SAMPLE_COUNT } from "./constants.js";

export interface WorldRenderTarget {
  readonly destination: GPUTextureView;
  readonly msaa: GPUTextureView;
  readonly depth: GPUTextureView;
}

interface WorldCaptureResources {
  readonly destination: GPUTexture;
  readonly textures: readonly TgpuTexture[];
  readonly readback: GPUBuffer;
  readonly target: WorldRenderTarget;
  readonly cutawayView: GPUTextureView | null;
}

function createWorldCaptureResources(
  root: TgpuRoot,
  format: GPUTextureFormat,
  width: number,
  height: number,
  cutaway: WalkabilityCutawayGrid | null,
): WorldCaptureResources {
  const textures: TgpuTexture[] = [];
  let readback: GPUBuffer | null = null;
  const track = <T extends TgpuTexture>(texture: T): T => {
    textures.push(texture);
    return texture;
  };
  try {
    const destination = track(
      root
        .createTexture({ size: [width, height], format })
        .$overrideFlags(
          GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        )
        .$name("Maps overview color"),
    );
    const msaa = track(
      root
        .createTexture({
          size: [width, height],
          format,
          sampleCount: RENDER_SAMPLE_COUNT,
        })
        .$usage("render")
        .$name("Maps overview MSAA"),
    );
    const depth = track(
      root
        .createTexture({
          size: [width, height],
          format: "depth24plus",
          sampleCount: RENDER_SAMPLE_COUNT,
        })
        .$usage("render")
        .$name("Maps overview depth"),
    );
    readback = root.device.createBuffer({
      label: "Maps overview readback",
      size: ((width * 4 + 255) & ~255) * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const cutawayTexture = cutaway
      ? track(
          root
            .createTexture({
              size: [cutaway.width, cutaway.height],
              format: "rgba8unorm",
            })
            .$usage("sampled")
            .$name("Maps overview cutaway"),
        )
      : null;
    if (cutawayTexture && cutaway) cutawayTexture.write(encodeCutaway(cutaway));
    const rawDestination = root.unwrap(destination);
    return {
      destination: rawDestination,
      textures,
      readback,
      target: {
        destination: rawDestination.createView(),
        msaa: root.unwrap(msaa).createView(),
        depth: root.unwrap(depth).createView(),
      },
      cutawayView: cutawayTexture
        ? root.unwrap(cutawayTexture).createView()
        : null,
    };
  } catch (error) {
    readback?.destroy();
    for (const texture of textures) texture.destroy();
    throw error;
  }
}

export class WorldCanvasTarget {
  private msaaTexture: TgpuTexture | null = null;
  private depthTexture: TgpuTexture | null = null;
  private msaaView: GPUTextureView | null = null;
  private depthView: GPUTextureView | null = null;
  private width = 0;
  private height = 0;
  private disposed = false;

  public constructor(
    private readonly root: TgpuRoot,
    private readonly context: GPUCanvasContext,
    private readonly format: GPUTextureFormat,
  ) {}

  public resize(width: number, height: number): void {
    if (this.disposed || (width === this.width && height === this.height))
      return;
    const msaaTexture = this.root
      .createTexture({
        size: [width, height],
        format: this.format,
        sampleCount: RENDER_SAMPLE_COUNT,
      })
      .$usage("render")
      .$name("Maps canvas MSAA");
    let depthTexture: TgpuTexture | null = null;
    try {
      depthTexture = this.root
        .createTexture({
          size: [width, height],
          format: "depth24plus",
          sampleCount: RENDER_SAMPLE_COUNT,
        })
        .$usage("render")
        .$name("Maps canvas depth");
      const msaaView = this.root.unwrap(msaaTexture).createView();
      const depthView = this.root.unwrap(depthTexture).createView();
      this.msaaTexture?.destroy();
      this.depthTexture?.destroy();
      this.msaaTexture = msaaTexture;
      this.depthTexture = depthTexture;
      this.msaaView = msaaView;
      this.depthView = depthView;
      this.width = width;
      this.height = height;
    } catch (error) {
      msaaTexture.destroy();
      depthTexture?.destroy();
      throw error;
    }
  }

  public current(): WorldRenderTarget | null {
    if (
      this.disposed ||
      !this.msaaView ||
      !this.depthView ||
      this.width <= 0 ||
      this.height <= 0
    ) {
      return null;
    }
    return {
      destination: this.context.getCurrentTexture().createView(),
      msaa: this.msaaView,
      depth: this.depthView,
    };
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.msaaTexture?.destroy();
    this.depthTexture?.destroy();
    this.msaaTexture = null;
    this.depthTexture = null;
    this.msaaView = null;
    this.depthView = null;
  }
}

export class WorldCaptureTarget {
  private readonly destination: GPUTexture;
  private readonly textures: readonly TgpuTexture[];
  private readonly readback: GPUBuffer;
  private readonly target: WorldRenderTarget;
  private readonly capturedCutawayView: GPUTextureView | null;
  private readonly bytesPerRow: number;
  private disposed = false;

  public constructor(
    root: TgpuRoot,
    private readonly format: GPUTextureFormat,
    private readonly width: number,
    private readonly height: number,
    cutaway: WalkabilityCutawayGrid | null,
  ) {
    this.bytesPerRow = (width * 4 + 255) & ~255;
    const resources = createWorldCaptureResources(
      root,
      format,
      width,
      height,
      cutaway,
    );
    this.destination = resources.destination;
    this.textures = resources.textures;
    this.readback = resources.readback;
    this.target = resources.target;
    this.capturedCutawayView = resources.cutawayView;
  }

  public get renderTarget(): WorldRenderTarget {
    return this.target;
  }

  public get cutawayView(): GPUTextureView | null {
    return this.capturedCutawayView;
  }

  public encodeCopy(encoder: GPUCommandEncoder): void {
    encoder.copyTextureToBuffer(
      { texture: this.destination },
      {
        buffer: this.readback,
        bytesPerRow: this.bytesPerRow,
        rowsPerImage: this.height,
      },
      { width: this.width, height: this.height, depthOrArrayLayers: 1 },
    );
  }

  public async readRgba(): Promise<Uint8ClampedArray> {
    await this.readback.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(this.readback.getMappedRange());
    const rgba = new Uint8ClampedArray(this.width * this.height * 4);
    const bgra = this.format.startsWith("bgra");
    for (let y = 0; y < this.height; y += 1) {
      const sourceRow = y * this.bytesPerRow;
      const destinationRow = y * this.width * 4;
      for (let x = 0; x < this.width; x += 1) {
        const source = sourceRow + x * 4;
        const output = destinationRow + x * 4;
        rgba[output] = mapped[source + (bgra ? 2 : 0)] ?? 0;
        rgba[output + 1] = mapped[source + 1] ?? 0;
        rgba[output + 2] = mapped[source + (bgra ? 0 : 2)] ?? 0;
        rgba[output + 3] = mapped[source + 3] ?? 0;
      }
    }
    return rgba;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.readback.mapState === "mapped") this.readback.unmap();
    this.readback.destroy();
    for (const texture of this.textures) texture.destroy();
  }
}

function encodeCutaway(grid: WalkabilityCutawayGrid): Uint8Array {
  const pixels = new Uint8Array(grid.width * grid.height * 4);
  const minimum = grid.bounds.min[2];
  const range = Math.max(1, grid.bounds.max[2] - minimum);
  for (let index = 0; index < grid.values.length; index += 1) {
    const value = grid.values[index]!;
    if (value === WALKABILITY_CUTAWAY_EMPTY) continue;
    const encoded = Math.round(
      Math.min(1, Math.max(0, (value - minimum) / range)) * 65_535,
    );
    const offset = index * 4;
    pixels[offset] = encoded >> 8;
    pixels[offset + 1] = encoded & 0xff;
    pixels[offset + 2] = 255;
    pixels[offset + 3] = 255;
  }
  return pixels;
}
