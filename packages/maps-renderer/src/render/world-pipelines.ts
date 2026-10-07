/*
 * Surface pipeline selection is adapted from noclip.website's Common/IdTech2 renderer.
 * See docs/plan.md and THIRD_PARTY_NOTICES.md.
 */

import type { TgpuRoot } from "typegpu";

import {
  isQuakePaletteFormat,
  type DrawBatch,
  type ParsedWorld,
} from "../core/index.js";
import { RENDER_SAMPLE_COUNT } from "./constants.js";
import {
  additiveFragment,
  alphaFragment,
  opaqueFragment,
  quakeSkyFragment,
  skyboxVertex,
  translucentColorFragment,
  translucentTextureFragment,
  unlitAlphaFragment,
  unlitFragment,
  unlitSkyFragment,
  waterFragment,
  worldVertex,
} from "./shaders.js";
import { worldVertexLayout } from "./schemas.js";
import { worldLighting } from "./world-lighting.js";

function surfacePrimitive(cullMode: GPUCullMode): GPUPrimitiveState {
  return { topology: "triangle-list", frontFace: "cw", cullMode };
}

function surfaceDepthStencil(
  depthWriteEnabled: boolean,
  biased: boolean,
  depthCompare: GPUCompareFunction = "less",
): GPUDepthStencilState {
  return {
    format: "depth24plus",
    depthWriteEnabled,
    depthCompare,
    ...(biased ? { depthBias: -2, depthBiasSlopeScale: -0.5 } : {}),
  };
}

export function createWorldPipelines(root: TgpuRoot, format: GPUTextureFormat) {
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
  const common = {
    attribs,
    vertex: worldVertex,
    multisample: { count: RENDER_SAMPLE_COUNT },
  };
  const skyboxCommon = { ...common, vertex: skyboxVertex };
  const surface = (
    fragment: typeof opaqueFragment,
    options: {
      readonly brush?: boolean;
      readonly cullMode?: GPUCullMode;
      readonly blend?: GPUBlendState;
      readonly depthWrite?: boolean;
      readonly depthCompare?: GPUCompareFunction;
    } = {},
  ) =>
    root.createRenderPipeline({
      ...common,
      fragment,
      targets: { format, ...(options.blend ? { blend: options.blend } : {}) },
      primitive: surfacePrimitive(options.cullMode ?? "back"),
      depthStencil: surfaceDepthStencil(
        options.depthWrite ?? true,
        options.brush ?? false,
        options.depthCompare,
      ),
    });
  return {
    opaque: surface(opaqueFragment),
    opaqueBrush: surface(opaqueFragment, { brush: true }),
    unlit: surface(unlitFragment),
    unlitBrush: surface(unlitFragment, { brush: true }),
    alpha: surface(alphaFragment),
    alphaBrush: surface(alphaFragment, { brush: true }),
    unlitAlpha: surface(unlitAlphaFragment),
    unlitAlphaBrush: surface(unlitAlphaFragment, { brush: true }),
    water: surface(waterFragment, { cullMode: "none" }),
    waterBrush: surface(waterFragment, { brush: true, cullMode: "none" }),
    translucentTexture: surface(translucentTextureFragment, {
      blend: alphaBlend,
      depthWrite: false,
    }),
    translucentTextureBrush: surface(translucentTextureFragment, {
      brush: true,
      blend: alphaBlend,
      depthWrite: false,
    }),
    translucentWater: surface(waterFragment, {
      cullMode: "none",
      blend: alphaBlend,
      depthWrite: false,
    }),
    translucentWaterBrush: surface(waterFragment, {
      brush: true,
      cullMode: "none",
      blend: alphaBlend,
      depthWrite: false,
    }),
    translucentColor: surface(translucentColorFragment, {
      brush: true,
      blend: alphaBlend,
      depthWrite: false,
    }),
    additive: surface(additiveFragment, {
      brush: true,
      blend: additiveBlend,
      depthWrite: false,
    }),
    unlitSky: root.createRenderPipeline({
      ...common,
      fragment: unlitSkyFragment,
      targets: { format },
      primitive: surfacePrimitive("none"),
      depthStencil: surfaceDepthStencil(true, false),
    }),
    unlitSkyBackground: root.createRenderPipeline({
      ...skyboxCommon,
      fragment: unlitSkyFragment,
      targets: { format },
      primitive: surfacePrimitive("none"),
      depthStencil: surfaceDepthStencil(true, false, "always"),
    }),
    quakeSky: root.createRenderPipeline({
      ...common,
      fragment: quakeSkyFragment,
      targets: { format },
      primitive: surfacePrimitive("none"),
      depthStencil: surfaceDepthStencil(true, false),
    }),
    quakeSkyBackground: root.createRenderPipeline({
      ...skyboxCommon,
      fragment: quakeSkyFragment,
      targets: { format },
      primitive: surfacePrimitive("none"),
      depthStencil: surfaceDepthStencil(true, false, "always"),
    }),
  };
}

export type WorldPipelines = ReturnType<typeof createWorldPipelines>;

export function goldSrcBrushPipeline(
  renderMode: number,
  surfaceKind: DrawBatch["kind"],
):
  | "translucentColor"
  | "translucentTextureBrush"
  | "translucentWaterBrush"
  | "additive"
  | null {
  if (renderMode === 1) return "translucentColor";
  if (renderMode === 2)
    return surfaceKind === "water"
      ? "translucentWaterBrush"
      : "translucentTextureBrush";
  // Glow sprites have their own depth behavior; brush models use the translucent surface path.
  if (renderMode === 3) return "translucentTextureBrush";
  if (renderMode === 5) return "additive";
  return null;
}

export function selectedWorldPipeline(
  pipelines: WorldPipelines,
  world: ParsedWorld,
  batch: DrawBatch,
): WorldPipelines[keyof WorldPipelines] {
  if (batch.kind === "sky") {
    return isQuakePaletteFormat(world.format)
      ? pipelines.quakeSky
      : pipelines.unlitSky;
  }
  const model = world.models[batch.modelIndex];
  const brush = batch.modelIndex > 0;
  const material = world.materials[batch.materialIndex];
  if (world.format === "quake2-bsp38" && (material?.opacity ?? 1) < 1) {
    if (batch.kind === "water") {
      return brush
        ? pipelines.translucentWaterBrush
        : pipelines.translucentWater;
    }
    return brush
      ? pipelines.translucentTextureBrush
      : pipelines.translucentTexture;
  }
  if (world.version === 30 && brush) {
    const renderPipeline = goldSrcBrushPipeline(
      model?.renderMode ?? 0,
      batch.kind,
    );
    if (renderPipeline) return pipelines[renderPipeline];
  }
  if (batch.kind === "water")
    return brush ? pipelines.waterBrush : pipelines.water;
  const alpha =
    batch.kind === "alpha-test" ||
    (world.version === 30 && model?.renderMode === 4);
  const lightmapped =
    batch.lightmapPage >= 0 ||
    (world.hasLighting &&
      worldLighting(world.format).samplelessFaces === "dark");
  if (alpha) {
    if (lightmapped) return brush ? pipelines.alphaBrush : pipelines.alpha;
    return brush ? pipelines.unlitAlphaBrush : pipelines.unlitAlpha;
  }
  if (lightmapped) return brush ? pipelines.opaqueBrush : pipelines.opaque;
  return brush ? pipelines.unlitBrush : pipelines.unlit;
}
