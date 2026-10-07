import { materialMipmaps } from "./material-mipmaps.js";
import type { EditorMaterial } from "../core/index.js";
import type {
  TgpuBindGroup,
  TgpuRoot,
  TgpuSampler,
  TgpuTexture,
  TgpuUniform,
} from "typegpu";
import { editorMaterialLayout, MaterialUniform } from "./gpu-schemas.js";

export interface MaterialResource {
  readonly texture: TgpuTexture;
  readonly settings: TgpuUniform<typeof MaterialUniform>;
  readonly bindGroup: TgpuBindGroup;
}

export function createMaterialResource(
  root: TgpuRoot,
  sampler: TgpuSampler,
  material?: EditorMaterial,
): MaterialResource {
  const width = material?.width ?? 1;
  const height = material?.height ?? 1;
  const rgba = material?.rgba ?? new Uint8Array([255, 255, 255, 255]);
  if (rgba.byteLength !== width * height * 4) {
    throw new Error(
      `Material ${material?.name ?? "fallback"} has inconsistent RGBA dimensions`,
    );
  }
  // Masked materials retain their original alpha-test coverage, as in TrenchBroom.
  const levels = material?.alphaTest
    ? [rgba]
    : materialMipmaps(width, height, rgba);
  const texture = root
    .createTexture({
      size: [width, height],
      format: "rgba8unorm",
      mipLevelCount: levels.length,
    })
    .$usage("sampled")
    .$name(material?.name ?? "Missing editor material");
  levels.forEach((level, index) => texture.write(level, index));
  const settings = root.createUniform(MaterialUniform, {
    settings: [
      material ? 1 : 0,
      material?.alphaTest ? 1 : 0,
      material?.logicalWidth ?? width,
      material?.logicalHeight ?? height,
    ],
  });
  return {
    texture,
    settings,
    bindGroup: root.createBindGroup(editorMaterialLayout, {
      materialSampler: sampler,
      materialTexture: root.unwrap(texture).createView(),
      material: settings,
    }),
  };
}

export function destroyMaterialResource(resource: MaterialResource): void {
  resource.texture.destroy();
  resource.settings.buffer.destroy();
}
