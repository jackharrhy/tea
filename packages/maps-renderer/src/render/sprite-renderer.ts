import type { TgpuBindGroup, TgpuRoot, TgpuTexture } from "typegpu";

import type {
  DecodedSpriteFrame,
  SpriteFrameSequence,
  Vec3Tuple,
} from "../core/index.js";
import type { LoadedSpriteEntity } from "./assets.js";
import { RENDER_SAMPLE_COUNT } from "./constants.js";
import { createGpuBuffer } from "./gpu-buffer.js";
import type { CameraState, TextureFiltering } from "./types.js";
import {
  spriteAdditiveFragment,
  spriteAlphaTestFragment,
  spriteFragment,
  worldVertex,
} from "./shaders.js";
import {
  MaterialUniform,
  materialLayout,
  worldVertexLayout,
} from "./schemas.js";

const FLOATS_PER_VERTEX = 7;
const VERTICES_PER_SPRITE = 4;
const INDICES_PER_SPRITE = 6;

type SpritePipelineKind =
  | "opaque"
  | "alphaTest"
  | "translucent"
  | "translucentAlphaTest"
  | "translucentNoDepth"
  | "translucentAlphaTestNoDepth"
  | "additive";

interface FrameResource {
  readonly frame: DecodedSpriteFrame;
  readonly group: TgpuBindGroup;
}

interface SequenceResource {
  readonly sequence: SpriteFrameSequence;
  readonly frames: readonly FrameResource[];
}

interface SpriteResource {
  readonly entity: LoadedSpriteEntity;
  readonly sequences: readonly SequenceResource[];
  readonly pipeline: SpritePipelineKind;
  activeFrame: FrameResource;
}

function createPipelines(root: TgpuRoot, format: GPUTextureFormat) {
  const attribs = {
    position: worldVertexLayout.attrib.position,
    diffuseUv: worldVertexLayout.attrib.diffuseUv,
    lightmapUv: worldVertexLayout.attrib.lightmapUv,
  };
  const alphaBlend: GPUBlendState = {
    color: {
      srcFactor: "src-alpha",
      dstFactor: "one-minus-src-alpha",
      operation: "add",
    },
    alpha: {
      srcFactor: "one",
      dstFactor: "one-minus-src-alpha",
      operation: "add",
    },
  };
  const additiveBlend: GPUBlendState = {
    color: { srcFactor: "one", dstFactor: "one", operation: "add" },
    alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
  };
  const pipeline = (
    fragment: typeof spriteFragment,
    depthWriteEnabled: boolean,
    blend?: GPUBlendState,
  ) =>
    root.createRenderPipeline({
      vertex: worldVertex,
      fragment,
      attribs,
      targets: { format, ...(blend ? { blend } : {}) },
      primitive: {
        topology: "triangle-list",
        frontFace: "cw",
        cullMode: "none",
      },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled,
        depthCompare: "less",
      },
      multisample: { count: RENDER_SAMPLE_COUNT },
    });
  return {
    opaque: pipeline(spriteFragment, true),
    alphaTest: pipeline(spriteAlphaTestFragment, true),
    translucent: pipeline(spriteFragment, true, alphaBlend),
    translucentAlphaTest: pipeline(spriteAlphaTestFragment, true, alphaBlend),
    translucentNoDepth: pipeline(spriteFragment, false, alphaBlend),
    translucentAlphaTestNoDepth: pipeline(
      spriteAlphaTestFragment,
      false,
      alphaBlend,
    ),
    additive: pipeline(spriteAdditiveFragment, false, additiveBlend),
  };
}

function pipelineKind(entity: LoadedSpriteEntity): SpritePipelineKind {
  if (entity.renderMode === 3 || entity.renderMode === 5) return "additive";
  if (entity.renderMode === 4) {
    return entity.sprite.textureFormat === 3
      ? "translucentAlphaTestNoDepth"
      : "translucentNoDepth";
  }
  if (entity.renderMode === 1 || entity.renderMode === 2) {
    return entity.sprite.textureFormat === 3
      ? "translucentAlphaTest"
      : "translucent";
  }
  if (entity.sprite.textureFormat === 2 || entity.sprite.textureFormat === 3)
    return "alphaTest";
  return "opaque";
}

function isTranslucentPipeline(kind: SpritePipelineKind): boolean {
  return kind !== "opaque" && kind !== "alphaTest";
}

function spriteMipLevels(frame: DecodedSpriteFrame): readonly Uint8Array[] {
  const levels = [frame.rgba];
  let width = frame.width;
  let height = frame.height;
  while (width > 1 || height > 1) {
    const source = levels.at(-1)!;
    const nextWidth = Math.max(1, width >> 1);
    const nextHeight = Math.max(1, height >> 1);
    const next = new Uint8Array(nextWidth * nextHeight * 4);
    for (let y = 0; y < nextHeight; y += 1) {
      for (let x = 0; x < nextWidth; x += 1) {
        const destination = (y * nextWidth + x) * 4;
        const firstX = Math.min(width - 1, x * 2);
        const secondX = Math.min(width - 1, firstX + 1);
        const firstY = Math.min(height - 1, y * 2);
        const secondY = Math.min(height - 1, firstY + 1);
        for (let channel = 0; channel < 4; channel += 1) {
          next[destination + channel] =
            ((source[(firstY * width + firstX) * 4 + channel] ?? 0) +
              (source[(firstY * width + secondX) * 4 + channel] ?? 0) +
              (source[(secondY * width + firstX) * 4 + channel] ?? 0) +
              (source[(secondY * width + secondX) * 4 + channel] ?? 0)) >>
            2;
        }
      }
    }
    levels.push(next);
    width = nextWidth;
    height = nextHeight;
  }
  return levels;
}

function normalize(vector: Vec3Tuple, fallback: Vec3Tuple): Vec3Tuple {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length < 0.000_001) return fallback;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cameraAxes(camera: CameraState): {
  right: Vec3Tuple;
  up: Vec3Tuple;
  forward: Vec3Tuple;
} {
  const cosYaw = Math.cos(camera.yaw);
  const sinYaw = Math.sin(camera.yaw);
  const cosPitch = Math.cos(camera.pitch);
  const sinPitch = Math.sin(camera.pitch);
  return {
    forward: [cosYaw * cosPitch, sinYaw * cosPitch, sinPitch],
    right: [sinYaw, -cosYaw, 0],
    up: [-cosYaw * sinPitch, -sinYaw * sinPitch, cosPitch],
  };
}

function orientedAxes(angles: Vec3Tuple): { right: Vec3Tuple; up: Vec3Tuple } {
  const pitch = (angles[0] * Math.PI) / 180;
  const yaw = (angles[1] * Math.PI) / 180;
  const roll = (angles[2] * Math.PI) / 180;
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const sr = Math.sin(roll);
  const cr = Math.cos(roll);
  return {
    right: [-(sr * sp * cy) + cr * sy, -(sr * sp * sy) - cr * cy, -sr * cp],
    up: [cr * sp * cy + sr * sy, cr * sp * sy - sr * cy, cr * cp],
  };
}

function spriteAxes(entity: LoadedSpriteEntity, camera: CameraState) {
  const cameraBasis = cameraAxes(camera);
  if (entity.sprite.orientation === 0) {
    return {
      right: normalize(
        [cameraBasis.forward[1], -cameraBasis.forward[0], 0],
        [0, -1, 0],
      ),
      up: [0, 0, 1] as Vec3Tuple,
    };
  }
  if (entity.sprite.orientation === 1) {
    return {
      right: normalize(
        [
          entity.origin[1] - camera.position[1],
          -(entity.origin[0] - camera.position[0]),
          0,
        ],
        cameraBasis.right,
      ),
      up: [0, 0, 1] as Vec3Tuple,
    };
  }
  if (entity.sprite.orientation === 3) return orientedAxes(entity.angles);
  if (entity.sprite.orientation === 4) {
    const rollDegrees = entity.angles[2] || entity.angles[1];
    const roll = (rollDegrees * Math.PI) / 180;
    const cosine = Math.cos(roll);
    const sine = Math.sin(roll);
    return {
      right: [
        cameraBasis.right[0] * cosine + cameraBasis.up[0] * sine,
        cameraBasis.right[1] * cosine + cameraBasis.up[1] * sine,
        cameraBasis.right[2] * cosine + cameraBasis.up[2] * sine,
      ] as Vec3Tuple,
      up: [
        cameraBasis.up[0] * cosine - cameraBasis.right[0] * sine,
        cameraBasis.up[1] * cosine - cameraBasis.right[1] * sine,
        cameraBasis.up[2] * cosine - cameraBasis.right[2] * sine,
      ] as Vec3Tuple,
    };
  }
  return cameraBasis;
}

function sequenceFrame(
  resource: SpriteResource,
  timeSeconds: number,
): FrameResource {
  const topLevelFrame = Math.floor(
    resource.entity.frame + timeSeconds * resource.entity.frameRate,
  );
  const sequenceIndex =
    ((topLevelFrame % resource.sequences.length) + resource.sequences.length) %
    resource.sequences.length;
  const sequence = resource.sequences[sequenceIndex]!;
  if (sequence.frames.length === 1) return sequence.frames[0]!;
  const duration = sequence.sequence.intervals.at(-1) ?? 0;
  if (duration <= 0) return sequence.frames[0]!;
  const target = ((timeSeconds % duration) + duration) % duration;
  const index = sequence.sequence.intervals.findIndex(
    (interval) => target < interval,
  );
  return sequence.frames[index < 0 ? sequence.frames.length - 1 : index]!;
}

function distanceSquared(
  entity: LoadedSpriteEntity,
  camera: CameraState,
): number {
  const x = entity.origin[0] - camera.position[0];
  const y = entity.origin[1] - camera.position[1];
  const z = entity.origin[2] - camera.position[2];
  return x * x + y * y + z * z;
}

export class TypeGpuSpriteRenderer {
  private readonly device: GPUDevice;
  private readonly pipelines;
  private readonly vertexData: Float32Array;
  private readonly vertexBuffer: GPUBuffer;
  private readonly indexBuffer: GPUBuffer;
  private readonly textures: TgpuTexture[] = [];
  private readonly buffers: Array<{ destroy(): void }> = [];
  private readonly resources: SpriteResource[] = [];
  private readonly sampler;
  private disposed = false;

  public constructor(
    private readonly root: TgpuRoot,
    format: GPUTextureFormat,
    entities: readonly LoadedSpriteEntity[],
    filtering: TextureFiltering,
  ) {
    this.device = root.device;
    this.pipelines = createPipelines(root, format);
    this.vertexData = new Float32Array(
      entities.length * VERTICES_PER_SPRITE * FLOATS_PER_VERTEX,
    );
    this.vertexBuffer = createGpuBuffer(
      this.device,
      this.vertexData,
      GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    );
    const indices = new Uint32Array(entities.length * INDICES_PER_SPRITE);
    for (let index = 0; index < entities.length; index += 1) {
      const vertex = index * VERTICES_PER_SPRITE;
      indices.set(
        [vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3],
        index * 6,
      );
    }
    this.indexBuffer = createGpuBuffer(
      this.device,
      indices,
      GPUBufferUsage.INDEX,
    );
    this.sampler = root.createSampler({
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      magFilter: filtering,
      minFilter: filtering,
      mipmapFilter: filtering,
    });
    if (entities.length > 0) this.upload(entities);
  }

  public get hasSprites(): boolean {
    return this.resources.length > 0;
  }

  public get continuouslyAnimated(): boolean {
    return this.resources.some(
      ({ entity, sequences }) =>
        entity.frameRate > 0 ||
        sequences.some(({ frames }) => frames.length > 1),
    );
  }

  public async initialize(): Promise<void> {
    if (!this.hasSprites) return;
    await Promise.all(
      Object.values(this.pipelines).map((pipeline) => pipeline.initAsync()),
    );
  }

  public prepare(camera: CameraState, timeSeconds: number): void {
    if (!this.hasSprites || this.disposed) return;
    for (const [spriteIndex, resource] of this.resources.entries()) {
      const active = sequenceFrame(resource, timeSeconds);
      resource.activeFrame = active;
      this.writeQuad(spriteIndex, resource.entity, active.frame, camera);
    }
    this.device.queue.writeBuffer(this.vertexBuffer, 0, this.vertexData);
  }

  public drawOpaque(
    pass: GPURenderPassEncoder,
    sceneGroup: TgpuBindGroup,
  ): void {
    for (const [index, resource] of this.resources.entries()) {
      if (isTranslucentPipeline(resource.pipeline)) continue;
      this.draw(pass, sceneGroup, index, resource);
    }
  }

  public drawTranslucent(
    pass: GPURenderPassEncoder,
    sceneGroup: TgpuBindGroup,
    camera: CameraState,
  ): void {
    const sorted = this.resources
      .map((resource, index) => ({ resource, index }))
      .filter(({ resource }) => isTranslucentPipeline(resource.pipeline))
      .toSorted(
        (left, right) =>
          distanceSquared(right.resource.entity, camera) -
          distanceSquared(left.resource.entity, camera),
      );
    for (const { resource, index } of sorted)
      this.draw(pass, sceneGroup, index, resource);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.vertexBuffer.destroy();
    this.indexBuffer.destroy();
    for (const buffer of this.buffers) buffer.destroy();
    for (const texture of this.textures) texture.destroy();
    this.buffers.length = 0;
    this.textures.length = 0;
    this.resources.length = 0;
  }

  private upload(entities: readonly LoadedSpriteEntity[]): void {
    const white = this.texture2d("__sprite_white__", 1, 1, [
      new Uint8Array([255, 255, 255, 255]),
    ]);
    const skybox = this.root
      .createTexture({ size: [1, 1, 6], format: "rgba8unorm" })
      .$usage("sampled")
      .$name("__sprite_skybox__");
    this.textures.push(skybox);
    const rawSkybox = this.root.unwrap(skybox);
    for (let layer = 0; layer < 6; layer += 1) {
      this.device.queue.writeTexture(
        { texture: rawSkybox, origin: { x: 0, y: 0, z: layer } },
        new Uint8Array([255, 255, 255, 255]),
        { bytesPerRow: 4, rowsPerImage: 1 },
        { width: 1, height: 1, depthOrArrayLayers: 1 },
      );
    }
    const skyboxView = rawSkybox.createView({
      dimension: "2d-array",
      arrayLayerCount: 6,
    });

    for (const entity of entities) {
      const sequences = entity.sprite.frames.map((sequence, sequenceIndex) => ({
        sequence,
        frames: sequence.frames.map((frame, frameIndex) => {
          const diffuse = this.texture2d(
            `${entity.reference.basename}-${sequenceIndex}-${frameIndex}`,
            frame.width,
            frame.height,
            spriteMipLevels(frame),
          );
          const uniform = this.root.createUniform(MaterialUniform, {
            lightmapScale: 1,
            sizes: [frame.width, frame.height, 1, 1],
            options: [0, 0, entity.sprite.textureFormat === 3 ? 0.5 : 0, 0],
            renderColor: [
              (entity.renderColor[0] * entity.lightColor[0]) / (255 * 255),
              (entity.renderColor[1] * entity.lightColor[1]) / (255 * 255),
              (entity.renderColor[2] * entity.lightColor[2]) / (255 * 255),
              entity.renderAmount / 255,
            ],
          });
          this.buffers.push(uniform.buffer);
          return {
            frame,
            group: this.root.createBindGroup(materialLayout, {
              material: uniform,
              diffuse,
              lightmap: white,
              fullbright: white,
              skyAlpha: diffuse,
              skybox: skyboxView,
              textureSampler: this.sampler,
              lightmapSampler: this.sampler,
              skyboxSampler: this.sampler,
            }),
          };
        }),
      }));
      this.resources.push({
        entity,
        sequences,
        pipeline: pipelineKind(entity),
        activeFrame: sequences[0]!.frames[0]!,
      });
    }
  }

  private texture2d(
    label: string,
    width: number,
    height: number,
    levels: readonly Uint8Array[],
  ) {
    const texture = this.root
      .createTexture({
        size: [width, height],
        format: "rgba8unorm",
        mipLevelCount: levels.length,
      })
      .$usage("sampled")
      .$name(label);
    levels.forEach((rgba, level) => texture.write(rgba, level));
    this.textures.push(texture);
    return this.root.unwrap(texture).createView();
  }

  private writeQuad(
    spriteIndex: number,
    entity: LoadedSpriteEntity,
    frame: DecodedSpriteFrame,
    camera: CameraState,
  ): void {
    const { right, up } = spriteAxes(entity, camera);
    const left = frame.origin[0] * entity.scale;
    const rightOffset = (frame.origin[0] + frame.width) * entity.scale;
    const top = frame.origin[1] * entity.scale;
    const bottom = (frame.origin[1] - frame.height) * entity.scale;
    const corners = [
      [left, bottom, 0, frame.height],
      [left, top, 0, 0],
      [rightOffset, top, frame.width, 0],
      [rightOffset, bottom, frame.width, frame.height],
    ] as const;
    for (const [
      cornerIndex,
      [horizontal, vertical, u, v],
    ] of corners.entries()) {
      const offset =
        (spriteIndex * VERTICES_PER_SPRITE + cornerIndex) * FLOATS_PER_VERTEX;
      this.vertexData[offset] =
        entity.origin[0] + right[0] * horizontal + up[0] * vertical;
      this.vertexData[offset + 1] =
        entity.origin[1] + right[1] * horizontal + up[1] * vertical;
      this.vertexData[offset + 2] =
        entity.origin[2] + right[2] * horizontal + up[2] * vertical;
      this.vertexData[offset + 3] = u;
      this.vertexData[offset + 4] = v;
      this.vertexData[offset + 5] = 0;
      this.vertexData[offset + 6] = 0;
    }
  }

  private draw(
    pass: GPURenderPassEncoder,
    sceneGroup: TgpuBindGroup,
    spriteIndex: number,
    resource: SpriteResource,
  ): void {
    this.pipelines[resource.pipeline]
      .with(worldVertexLayout, this.vertexBuffer)
      .withIndexBuffer(this.indexBuffer, "uint32")
      .with(sceneGroup)
      .with(resource.activeFrame.group)
      .with(pass)
      .drawIndexed(INDICES_PER_SPRITE, 1, spriteIndex * INDICES_PER_SPRITE);
  }
}
