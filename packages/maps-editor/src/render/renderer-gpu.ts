import {
  guideLineFragment,
  lineFragment,
  lineVertex,
  occludedLineFragment,
} from "./gpu-line-shaders.js";
import {
  perspectiveGridVertex,
  perspectiveGridFragment,
} from "./perspective-grid-shader.js";
import tgpu, { type TgpuRenderPipeline, type TgpuRoot } from "typegpu";
import {
  hullHandleVertex,
  hullHandleFragment,
  hullFaceFragment,
  gridFragment,
  gridVertex,
  selectionFragment,
  solidFragment,
  solidVertex,
} from "./gpu-shaders.js";
import { lineSegmentLayout, solidVertexLayout } from "./gpu-schemas.js";

export const EDITOR_SAMPLE_COUNT = 4;

export interface EditorPipelines {
  readonly hullHandles: TgpuRenderPipeline;
  readonly hullFace: TgpuRenderPipeline;
  readonly hullLines: TgpuRenderPipeline;
  readonly solid: TgpuRenderPipeline;
  readonly selectionSolid: TgpuRenderPipeline;
  readonly lines: TgpuRenderPipeline;
  readonly occludedLines: TgpuRenderPipeline;
  readonly grid: TgpuRenderPipeline;
  readonly perspectiveGrid: TgpuRenderPipeline;
  readonly guideLines: TgpuRenderPipeline;
}

export interface RendererGpuRuntime {
  readonly root: TgpuRoot;
  readonly device: GPUDevice;
  readonly format: GPUTextureFormat;
  readonly pipelines: EditorPipelines;
  readonly materialSampler: ReturnType<TgpuRoot["createSampler"]>;
}

export async function createRendererGpuRuntime(): Promise<RendererGpuRuntime> {
  if (!navigator.gpu) throw new Error("This browser does not expose WebGPU");
  const root = await tgpu.init({
    adapter: { powerPreference: "high-performance" },
  });
  const device = root.device;
  const format = navigator.gpu.getPreferredCanvasFormat();
  const materialSampler = root.createSampler({
    addressModeU: "repeat",
    addressModeV: "repeat",
    magFilter: "nearest",
    minFilter: "linear",
    mipmapFilter: "linear",
  });
  const solid = root.createRenderPipeline({
    vertex: solidVertex,
    fragment: solidFragment,
    attribs: {
      position: solidVertexLayout.attrib.position,
      color: solidVertexLayout.attrib.color,
      uv: solidVertexLayout.attrib.uv,
    },
    targets: { format },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less",
    },
    multisample: { count: EDITOR_SAMPLE_COUNT },
  });
  const lines = root.createRenderPipeline({
    vertex: lineVertex,
    fragment: lineFragment,
    attribs: {
      start: lineSegmentLayout.attrib.start,
      startColor: lineSegmentLayout.attrib.startColor,
      end: lineSegmentLayout.attrib.end,
      endColor: lineSegmentLayout.attrib.endColor,
    },
    targets: {
      format,
      blend: {
        color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
      },
    },
    primitive: { topology: "triangle-list" },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: false,
      depthCompare: "less-equal",
    },
    multisample: { count: EDITOR_SAMPLE_COUNT },
  });
  const selectionSolid = root.createRenderPipeline({
    vertex: solidVertex,
    fragment: selectionFragment,
    attribs: {
      position: solidVertexLayout.attrib.position,
      color: solidVertexLayout.attrib.color,
      uv: solidVertexLayout.attrib.uv,
    },
    targets: {
      format,
      blend: {
        color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
      },
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: false,
      depthCompare: "less-equal",
    },
    multisample: { count: EDITOR_SAMPLE_COUNT },
  });
  const occludedLines = root.createRenderPipeline({
    vertex: lineVertex,
    fragment: occludedLineFragment,
    attribs: {
      start: lineSegmentLayout.attrib.start,
      startColor: lineSegmentLayout.attrib.startColor,
      end: lineSegmentLayout.attrib.end,
      endColor: lineSegmentLayout.attrib.endColor,
    },
    targets: {
      format,
      blend: {
        color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
      },
    },
    primitive: { topology: "triangle-list" },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: false,
      depthCompare: "always",
    },
    multisample: { count: EDITOR_SAMPLE_COUNT },
  });
  const guideLines = root.createRenderPipeline({
    vertex: lineVertex,
    fragment: guideLineFragment,
    attribs: {
      start: lineSegmentLayout.attrib.start,
      startColor: lineSegmentLayout.attrib.startColor,
      end: lineSegmentLayout.attrib.end,
      endColor: lineSegmentLayout.attrib.endColor,
    },
    targets: {
      format,
      blend: {
        color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
      },
    },
    primitive: { topology: "triangle-list" },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: false,
      depthCompare: "less-equal",
    },
    multisample: { count: EDITOR_SAMPLE_COUNT },
  });
  const grid = root.createRenderPipeline({
    vertex: gridVertex,
    fragment: gridFragment,
    targets: {
      format,
      blend: {
        color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
      },
    },
    primitive: { topology: "triangle-list" },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: false,
      depthCompare: "always",
    },
    multisample: { count: EDITOR_SAMPLE_COUNT },
  });
  const perspectiveGrid = root.createRenderPipeline({
    vertex: perspectiveGridVertex,
    fragment: perspectiveGridFragment,
    targets: {
      format,
      blend: {
        color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
      },
    },
    primitive: { topology: "triangle-list" },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: false,
      depthCompare: "less-equal",
    },
    multisample: { count: EDITOR_SAMPLE_COUNT },
  });
  const hullHandles = root.createRenderPipeline({
    vertex: hullHandleVertex,
    fragment: hullHandleFragment,
    attribs: {
      position: solidVertexLayout.attrib.position,
      color: solidVertexLayout.attrib.color,
      uv: solidVertexLayout.attrib.uv,
    },
    targets: { format },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: false,
      depthCompare: "always",
    },
    multisample: { count: EDITOR_SAMPLE_COUNT },
  });
  const hullFace = root.createRenderPipeline({
    vertex: solidVertex,
    fragment: hullFaceFragment,
    attribs: {
      position: solidVertexLayout.attrib.position,
      color: solidVertexLayout.attrib.color,
      uv: solidVertexLayout.attrib.uv,
    },
    targets: {
      format,
      blend: {
        color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
      },
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: false,
      depthCompare: "always",
    },
    multisample: { count: EDITOR_SAMPLE_COUNT },
  });
  const hullLines = root.createRenderPipeline({
    vertex: lineVertex,
    fragment: lineFragment,
    attribs: {
      start: lineSegmentLayout.attrib.start,
      startColor: lineSegmentLayout.attrib.startColor,
      end: lineSegmentLayout.attrib.end,
      endColor: lineSegmentLayout.attrib.endColor,
    },
    targets: {
      format,
      blend: {
        color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
      },
    },
    primitive: { topology: "triangle-list" },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: false,
      depthCompare: "always",
    },
    multisample: { count: EDITOR_SAMPLE_COUNT },
  });
  await Promise.all([
    hullHandles.initAsync(),
    hullFace.initAsync(),
    hullLines.initAsync(),
    solid.initAsync(),
    selectionSolid.initAsync(),
    lines.initAsync(),
    occludedLines.initAsync(),
    grid.initAsync(),
    perspectiveGrid.initAsync(),
    guideLines.initAsync(),
  ]);
  return {
    root,
    device,
    format,
    pipelines: {
      hullHandles,
      hullFace,
      hullLines,
      solid,
      selectionSolid,
      lines,
      occludedLines,
      grid,
      perspectiveGrid,
      guideLines,
    },
    materialSampler,
  };
}
