import type { TgpuBindGroup, TgpuRoot } from "typegpu";

import type {
  WalkabilityMap,
  WalkabilityTraversal,
} from "../walkability/types.js";
import { RENDER_SAMPLE_COUNT } from "./constants.js";
import { createGpuBuffer } from "./gpu-buffer.js";
import { walkabilityVertexLayout } from "./walkability-schemas.js";
import {
  walkabilityFragment,
  walkabilityVertex,
} from "./walkability-shaders.js";

const FLOATS_PER_VERTEX = 7;

type Color = readonly [number, number, number, number];

const BIDIRECTIONAL_COLOR: Color = [0.42, 0.9, 0.5, 0.72];
const ONE_WAY_COLOR: Color = [0.96, 0.3, 0.72, 0.9];
const JUMP_COLOR: Color = [1, 0.68, 0.18, 0.92];
const DROP_COLOR: Color = [0.2, 0.72, 1, 0.9];
const BOUNDARY_COLOR: Color = [1, 0.2, 0.16, 0.42];

function edgeColor(traversal: WalkabilityTraversal, reverse: boolean): Color {
  if (traversal === "jump") return JUMP_COLOR;
  if (traversal === "drop") return DROP_COLOR;
  return reverse ? BIDIRECTIONAL_COLOR : ONE_WAY_COLOR;
}

function debugVertices(map: WalkabilityMap): Float32Array {
  const values: number[] = [];
  const directed = new Set(map.edges.map((edge) => `${edge.from}:${edge.to}`));
  const push = (
    position: readonly [number, number, number],
    color: Color,
  ): void => {
    values.push(position[0], position[1], position[2] + 3, ...color);
  };
  for (const edge of map.edges) {
    const reverse = directed.has(`${edge.to}:${edge.from}`);
    if (edge.traversal === "walk" && reverse && edge.from > edge.to) continue;
    const from = map.nodes[edge.from]?.position;
    const to = map.nodes[edge.to]?.position;
    if (!from || !to) continue;
    const color = edgeColor(edge.traversal, reverse);
    push(from, color);
    push(to, color);
  }
  for (const boundary of map.boundaries) {
    const from = map.nodes[boundary.from]?.position;
    if (!from) continue;
    const end = boundary.end;
    const distance = Math.hypot(end[0] - from[0], end[1] - from[1]);
    const target = distance > 0.5 ? end : boundary.target;
    push(from, BOUNDARY_COLOR);
    push(target, BOUNDARY_COLOR);
  }
  return new Float32Array(values);
}

export class TypeGpuWalkabilityRenderer {
  private readonly pipeline;
  private vertexBuffer: GPUBuffer | null = null;
  private vertexCount = 0;

  public constructor(
    private readonly root: TgpuRoot,
    format: GPUTextureFormat,
  ) {
    this.pipeline = root.createRenderPipeline({
      vertex: walkabilityVertex,
      fragment: walkabilityFragment,
      attribs: {
        position: walkabilityVertexLayout.attrib.position,
        color: walkabilityVertexLayout.attrib.color,
      },
      targets: {
        format,
        blend: {
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
        },
      },
      primitive: { topology: "line-list" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: false,
        depthCompare: "less-equal",
      },
      multisample: { count: RENDER_SAMPLE_COUNT },
    });
  }

  public async initialize(): Promise<void> {
    await this.pipeline.initAsync();
  }

  public get hasContent(): boolean {
    return this.vertexCount > 0;
  }

  public setMap(map: WalkabilityMap | null): void {
    this.vertexBuffer?.destroy();
    this.vertexBuffer = null;
    this.vertexCount = 0;
    if (!map) return;
    const vertices = debugVertices(map);
    if (vertices.length === 0) return;
    this.vertexBuffer = createGpuBuffer(
      this.root.device,
      vertices,
      GPUBufferUsage.VERTEX,
      "Worldview walkability vertices",
    );
    this.vertexCount = vertices.length / FLOATS_PER_VERTEX;
  }

  public draw(pass: GPURenderPassEncoder, sceneGroup: TgpuBindGroup): void {
    if (!this.vertexBuffer || this.vertexCount === 0) return;
    this.pipeline
      .with(walkabilityVertexLayout, this.vertexBuffer)
      .with(sceneGroup)
      .with(pass)
      .draw(this.vertexCount);
  }

  public dispose(): void {
    this.vertexBuffer?.destroy();
    this.vertexBuffer = null;
    this.vertexCount = 0;
  }
}
