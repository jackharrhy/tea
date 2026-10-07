import { d } from "typegpu";

import { sceneLayout } from "./schemas.js";

interface WalkabilityVertexInput {
  readonly position: d.v3f;
  readonly color: d.v4f;
}

interface WalkabilityFragmentInput {
  readonly color: d.v4f;
}

export function walkabilityVertex(input: WalkabilityVertexInput) {
  "use gpu";
  return {
    $position: sceneLayout.$.scene.projectionView.mul(
      d.vec4f(input.position, 1),
    ),
    color: input.color,
  };
}

export function walkabilityFragment(input: WalkabilityFragmentInput): d.v4f {
  "use gpu";
  return input.color;
}
