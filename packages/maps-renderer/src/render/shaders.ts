/*
 * Surface behavior is adapted from noclip.website's Common/IdTech2/Render.ts and
 * Quake.ts. The shader source is authored in TypeGPU's `use gpu` dialect.
 */

import { d, std } from "typegpu";

import { materialLayout, sceneLayout } from "./schemas.js";

const PI = Math.PI;

interface VertexInput {
  readonly position: d.v3f;
  readonly diffuseUv: d.v2f;
  readonly lightmapUv: d.v2f;
}

interface FragmentInput {
  readonly worldPosition: d.v3f;
  readonly diffuseUv: d.v2f;
  readonly lightmapUv: d.v2f;
}

function clipOverview(position: d.v3f): void {
  "use gpu";
  if (
    sceneLayout.$.scene.frameOptions.w > 0.5 &&
    (position.z < sceneLayout.$.scene.frameOptions.x ||
      position.z > sceneLayout.$.scene.frameOptions.y)
  ) {
    std.discard();
  }
  if (sceneLayout.$.scene.cutawayOptions.x > 0.5) {
    const uv = d.vec2f(
      (position.x - sceneLayout.$.scene.cutawayTransform.x) *
        sceneLayout.$.scene.cutawayTransform.z,
      (position.y - sceneLayout.$.scene.cutawayTransform.y) *
        sceneLayout.$.scene.cutawayTransform.w,
    );
    if (uv.x >= 0 && uv.x < 1 && uv.y >= 0 && uv.y < 1) {
      const x = d.i32(std.floor(uv.x * sceneLayout.$.scene.cutawayOptions.y));
      const y = d.i32(std.floor(uv.y * sceneLayout.$.scene.cutawayOptions.z));
      const texel = std.textureLoad(sceneLayout.$.cutaway, d.vec2i(x, y), 0);
      const encoded = texel.x * 65_280 + texel.y * 255;
      const cutoff =
        sceneLayout.$.scene.cutawayHeight.x +
        (encoded / 65_535) * sceneLayout.$.scene.cutawayHeight.y;
      if (texel.z > 0.5 && position.z > cutoff) std.discard();
    }
  }
}

export function worldVertex(input: VertexInput) {
  "use gpu";
  return {
    $position: sceneLayout.$.scene.projectionView.mul(
      d.vec4f(input.position, 1),
    ),
    worldPosition: input.position,
    diffuseUv: input.diffuseUv,
    lightmapUv: input.lightmapUv,
  };
}

export function skyboxVertex(input: VertexInput) {
  "use gpu";
  const worldPosition = input.position.add(sceneLayout.$.scene.eyeTime.xyz);
  return {
    $position: sceneLayout.$.scene.projectionView.mul(
      d.vec4f(worldPosition, 1),
    ),
    worldPosition,
    diffuseUv: input.diffuseUv,
    lightmapUv: input.lightmapUv,
  };
}

function diffuseCoordinates(uv: d.v2f): d.v2f {
  "use gpu";
  const scrolledUv = d.vec2f(
    uv.x - sceneLayout.$.scene.eyeTime.w * materialLayout.$.material.options.w,
    uv.y,
  );
  return scrolledUv.div(materialLayout.$.material.sizes.xy);
}

function sampleDiffuse(uv: d.v2f): d.v4f {
  "use gpu";
  return std.textureSample(
    materialLayout.$.diffuse,
    materialLayout.$.textureSampler,
    diffuseCoordinates(uv),
  );
}

function lightmapped(input: FragmentInput): d.v4f {
  "use gpu";
  clipOverview(input.worldPosition);
  const diffuse = sampleDiffuse(input.diffuseUv);
  if (sceneLayout.$.scene.frameOptions.z > 0.5) {
    return d.vec4f(diffuse.rgb, diffuse.a);
  }
  const lightmap = std.textureSample(
    materialLayout.$.lightmap,
    materialLayout.$.lightmapSampler,
    input.lightmapUv.div(materialLayout.$.material.sizes.zw),
  );
  const fullbright = std.textureSample(
    materialLayout.$.fullbright,
    materialLayout.$.textureSampler,
    diffuseCoordinates(input.diffuseUv),
  );
  // Subtract before lighting so filtered fullbright edges retain their original color.
  const base = std.max(diffuse.rgb.sub(fullbright.rgb), d.vec3f(0));
  return d.vec4f(
    base
      .mul(lightmap.rgb)
      .mul(materialLayout.$.material.lightmapScale)
      .add(fullbright.rgb),
    diffuse.a,
  );
}

export function opaqueFragment(input: FragmentInput): d.v4f {
  "use gpu";
  return lightmapped(input);
}

export function alphaFragment(input: FragmentInput): d.v4f {
  "use gpu";
  const color = lightmapped(input);
  if (color.a <= 0.25) std.discard();
  return color;
}

export function unlitFragment(input: FragmentInput): d.v4f {
  "use gpu";
  clipOverview(input.worldPosition);
  const diffuse = sampleDiffuse(input.diffuseUv);
  return d.vec4f(diffuse.rgb, diffuse.a);
}

export function unlitAlphaFragment(input: FragmentInput): d.v4f {
  "use gpu";
  const color = unlitFragment(input);
  if (color.a <= 0.25) std.discard();
  return color;
}

export function translucentTextureFragment(input: FragmentInput): d.v4f {
  "use gpu";
  clipOverview(input.worldPosition);
  const diffuse = sampleDiffuse(input.diffuseUv);
  return d.vec4f(
    diffuse.rgb,
    diffuse.a * materialLayout.$.material.renderColor.w,
  );
}

export function translucentColorFragment(input: FragmentInput): d.v4f {
  "use gpu";
  clipOverview(input.worldPosition);
  return materialLayout.$.material.renderColor;
}

export function additiveFragment(input: FragmentInput): d.v4f {
  "use gpu";
  clipOverview(input.worldPosition);
  const diffuse = sampleDiffuse(input.diffuseUv);
  return d.vec4f(diffuse.rgb.mul(materialLayout.$.material.renderColor.w), 1);
}

export function spriteFragment(input: FragmentInput): d.v4f {
  "use gpu";
  clipOverview(input.worldPosition);
  const diffuse = sampleDiffuse(input.diffuseUv);
  return d.vec4f(
    diffuse.rgb.mul(materialLayout.$.material.renderColor.rgb),
    diffuse.a * materialLayout.$.material.renderColor.w,
  );
}

export function spriteAlphaTestFragment(input: FragmentInput): d.v4f {
  "use gpu";
  const color = spriteFragment(input);
  if (color.a <= materialLayout.$.material.options.z) std.discard();
  return color;
}

export function spriteAdditiveFragment(input: FragmentInput): d.v4f {
  "use gpu";
  const color = spriteFragment(input);
  return d.vec4f(color.rgb.mul(color.a), 1);
}

export function waterFragment(input: FragmentInput): d.v4f {
  "use gpu";
  clipOverview(input.worldPosition);
  const time = sceneLayout.$.scene.eyeTime.w;
  let uv = d.vec2f(input.diffuseUv);
  if (materialLayout.$.material.options.x > 0.5) {
    const timeScale = 128 / PI;
    const angleS = std.mod(uv.y * 2 + time * timeScale, 256);
    const angleT = std.mod(uv.x * 2 + time * timeScale, 256);
    uv = d.vec2f(
      uv.x + 8 * std.sin(angleS * (PI / 128)),
      uv.y + 8 * std.sin(angleT * (PI / 128)),
    );
  } else if (materialLayout.$.material.options.z > 0.5) {
    // Quake II turbulent surfaces use a fixed 64-unit texture domain. This behavior was checked
    // against the pinned GPL engine oracle described in docs/quake2-compatibility.md; no code was
    // copied from it.
    uv = d.vec2f(
      uv.x -
        time * materialLayout.$.material.options.w +
        4 * std.sin(uv.y * 0.125 + time),
      uv.y + 4 * std.sin(uv.x * 0.125 + time),
    );
    const diffuse = std.textureSample(
      materialLayout.$.diffuse,
      materialLayout.$.textureSampler,
      uv.div(64),
    );
    return d.vec4f(
      diffuse.rgb,
      diffuse.a * materialLayout.$.material.renderColor.w,
    );
  } else {
    uv = uv.mul(2.75);
    uv = d.vec2f(
      uv.x + 10 * std.sin(uv.y * 0.03 + time * 0.5),
      uv.y + 10 * std.sin(uv.x * 0.03 + time * 0.5),
    );
  }
  const diffuse = sampleDiffuse(uv);
  return d.vec4f(
    diffuse.rgb,
    diffuse.a * materialLayout.$.material.renderColor.w,
  );
}

export function unlitSkyFragment(input: FragmentInput): d.v4f {
  "use gpu";
  if (materialLayout.$.material.options.y < 0.5)
    return sampleDiffuse(input.diffuseUv);

  const direction = input.worldPosition.sub(sceneLayout.$.scene.eyeTime.xyz);
  const x = direction.x;
  const y = direction.y;
  const z = direction.z;
  const absX = std.abs(x);
  const absY = std.abs(y);
  const absZ = std.abs(z);
  let layer = 0;
  let s = x;
  let t = y;

  // BSP30 skybox face order: +X rt, -X lf, +Y bk, -Y ft, +Z up, -Z dn.
  if (absX > absY && absX > absZ) {
    if (x > 0) {
      layer = 0;
      s = -y / x;
      t = z / x;
    } else {
      layer = 1;
      s = y / -x;
      t = z / -x;
    }
  } else if (absY > absZ) {
    if (y > 0) {
      layer = 2;
      s = x / y;
      t = z / y;
    } else {
      layer = 3;
      s = -x / -y;
      t = z / -y;
    }
  } else if (z > 0) {
    layer = 4;
    s = -y / z;
    t = -x / z;
  } else {
    layer = 5;
    s = -y / -z;
    t = x / -z;
  }

  const uv = d.vec2f((s + 1) * 0.5, 1 - (t + 1) * 0.5);
  return std.textureSample(
    materialLayout.$.skybox,
    materialLayout.$.skyboxSampler,
    uv,
    layer,
  );
}

export function quakeSkyFragment(input: FragmentInput): d.v4f {
  "use gpu";
  const rawDirection = input.worldPosition.sub(sceneLayout.$.scene.eyeTime.xyz);
  const direction = std.normalize(d.vec3f(rawDirection.xy, rawDirection.z * 3));
  const uv = direction.xy.mul(189 / 64);
  const time = sceneLayout.$.scene.eyeTime.w;
  const solid = std.textureSample(
    materialLayout.$.diffuse,
    materialLayout.$.textureSampler,
    uv.add(d.vec2f(time / 16)),
  );
  const alpha = std.textureSample(
    materialLayout.$.skyAlpha,
    materialLayout.$.textureSampler,
    uv.add(d.vec2f(time / 8)),
  );
  const color = solid.rgb.mul(1 - alpha.a).add(alpha.rgb.mul(alpha.a));
  return d.vec4f(std.pow(color.mul(1.4), d.vec3f(0.9)), 1);
}
