import type { EditorMaterial } from "../../core/index.js";
import {
  createMaterialResource,
  destroyMaterialResource,
  type MaterialResource,
} from "../material-resources.js";
import type { EditorSpriteMaterial } from "../types.js";
import type { TgpuBindGroup, TgpuRoot, TgpuSampler } from "typegpu";

export class SourceMaterialResources {
  private readonly resources = new Map<string, MaterialResource>();
  private readonly materialByKey = new Map<string, EditorMaterial>();
  private readonly fallback: MaterialResource;
  private materials: readonly EditorMaterial[];
  private sprites: readonly EditorSpriteMaterial[];

  public constructor(
    private readonly root: TgpuRoot,
    private readonly sampler: TgpuSampler,
    materials: readonly EditorMaterial[],
    sprites: readonly EditorSpriteMaterial[],
  ) {
    this.materials = materials;
    this.sprites = sprites;
    this.fallback = createMaterialResource(root, sampler);
    this.rebuild();
  }

  public setMaterials(materials: readonly EditorMaterial[]): void {
    this.materials = materials;
    this.rebuild();
  }

  public setSprites(sprites: readonly EditorSpriteMaterial[]): void {
    this.sprites = sprites;
    this.rebuild();
  }

  public bindGroup(materialName: string): TgpuBindGroup {
    return (
      this.resources.get(materialName.trim().toLowerCase())?.bindGroup ??
      this.fallback.bindGroup
    );
  }

  public dispose(): void {
    this.clear();
    destroyMaterialResource(this.fallback);
  }

  private rebuild(): void {
    const desired = new Map<string, EditorMaterial>();
    for (const material of [
      ...this.materials,
      ...this.sprites.map((sprite) => sprite.material),
    ]) {
      const key = material.name.trim().toLowerCase();
      desired.set(key, material);
    }
    for (const [key, resource] of this.resources) {
      if (desired.get(key) === this.materialByKey.get(key)) continue;
      destroyMaterialResource(resource);
      this.resources.delete(key);
      this.materialByKey.delete(key);
    }
    for (const [key, material] of desired) {
      if (this.materialByKey.get(key) === material) continue;
      this.resources.set(
        key,
        createMaterialResource(this.root, this.sampler, material),
      );
      this.materialByKey.set(key, material);
    }
  }

  private clear(): void {
    for (const resource of this.resources.values())
      destroyMaterialResource(resource);
    this.resources.clear();
    this.materialByKey.clear();
  }
}
