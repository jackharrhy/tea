/*
 * Draw pass organization is adapted from noclip.website's Common/IdTech2 renderer.
 * See docs/plan.md and THIRD_PARTY_NOTICES.md.
 */

import type { TgpuBindGroup } from "typegpu";

import { TypeGpuWalkabilityRenderer } from "./walkability-renderer.js";
import { TypeGpuSpriteRenderer } from "./sprite-renderer.js";
import type { CameraState } from "./types.js";
import type { WorldFramePlan } from "./world-frame-plan.js";
import type { WorldRenderResources } from "./world-render-resources.js";
import type { WorldRenderTarget } from "./world-render-targets.js";

export interface WorldPassEncoding {
  readonly encoder: GPUCommandEncoder;
  readonly target: WorldRenderTarget;
  readonly plan: WorldFramePlan;
  readonly resources: WorldRenderResources;
  readonly sprites: TypeGpuSpriteRenderer;
  readonly walkability: TypeGpuWalkabilityRenderer;
  readonly sceneGroup: TgpuBindGroup;
  readonly clearColor: readonly [number, number, number, number];
  readonly camera: CameraState;
  readonly timeSeconds: number;
}

export function encodeWorldPasses(input: WorldPassEncoding): void {
  const { encoder, target, plan, resources, sprites, walkability } = input;
  if (plan.needsSkyPass) {
    const pass = encoder.beginRenderPass({
      label: "Worldview sky pass",
      colorAttachments: [
        {
          view: target.msaa,
          clearValue: [...input.clearColor],
          loadOp: "clear",
          storeOp: "store",
          ...(plan.needsWorldPass ? {} : { resolveTarget: target.destination }),
        },
      ],
      depthStencilAttachment: {
        view: target.depth,
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    resources.drawSkyboxBackground(pass, plan.sky[0]!, input.sceneGroup);
    for (const batch of plan.sky) {
      resources.drawBatch(
        pass,
        batch,
        plan.worldFaceVisibility,
        input.sceneGroup,
        input.timeSeconds,
      );
    }
    pass.end();
  }

  if (plan.needsWorldPass) {
    const pass = encoder.beginRenderPass({
      label: "Worldview world pass",
      colorAttachments: [
        {
          view: target.msaa,
          clearValue: [...input.clearColor],
          loadOp: plan.needsSkyPass ? "load" : "clear",
          storeOp: "store",
          resolveTarget: target.destination,
        },
      ],
      depthStencilAttachment: {
        view: target.depth,
        depthClearValue: 1,
        depthLoadOp: plan.needsSkyPass ? "load" : "clear",
        depthStoreOp: "discard",
      },
    });
    for (const batch of plan.opaque) {
      resources.drawBatch(
        pass,
        batch,
        plan.worldFaceVisibility,
        input.sceneGroup,
        input.timeSeconds,
      );
    }
    if (plan.hasSprites) sprites.drawOpaque(pass, input.sceneGroup);
    for (const batch of plan.translucent) {
      resources.drawBatch(
        pass,
        batch,
        plan.worldFaceVisibility,
        input.sceneGroup,
        input.timeSeconds,
      );
    }
    if (plan.hasSprites)
      sprites.drawTranslucent(pass, input.sceneGroup, input.camera);
    if (plan.hasWalkability) walkability.draw(pass, input.sceneGroup);
    pass.end();
  }

  if (!plan.needsSkyPass && !plan.needsWorldPass) {
    const pass = encoder.beginRenderPass({
      label: "Worldview clear pass",
      colorAttachments: [
        {
          view: target.msaa,
          resolveTarget: target.destination,
          clearValue: [...input.clearColor],
          loadOp: "clear",
          storeOp: "discard",
        },
      ],
    });
    pass.end();
  }
}
