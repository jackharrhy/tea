import { afterEach, describe, expect, it, vi } from "vitest";

import type { EditorMaterial } from "../src/core/index.js";
import { SourceMaterialResources } from "../src/render/materials/source-material-resources.js";
import type { TgpuRoot, TgpuSampler } from "typegpu";

function material(name: string, value: number): EditorMaterial {
  return {
    name,
    sourceName: "test",
    width: 1,
    height: 1,
    rgba: new Uint8Array([value, value, value, 255]),
    alphaTest: false,
  };
}

describe("source material GPU resources", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("retains unchanged textures and replaces only changed normalized names", () => {
    const destroyed: string[] = [];
    const rawByTexture = new Map<
      object,
      { createView(): object; destroy(): void }
    >();
    const createTexture = vi.fn(() => {
      let label = "";
      const texture = {
        $usage: () => texture,
        $name: (name: string) => {
          label = name;
          return texture;
        },
        write: vi.fn(),
        destroy: () => destroyed.push(label),
      };
      rawByTexture.set(texture, {
        createView: () => ({}),
        destroy: texture.destroy,
      });
      return texture;
    });
    const root = {
      createTexture,
      createUniform: () => ({ buffer: { destroy: vi.fn() } }),
      createBindGroup: () => ({}),
      unwrap: (texture: object) => rawByTexture.get(texture),
    } as unknown as TgpuRoot;
    const stone = material("STONE", 32);
    const metal = material("METAL", 96);
    const resources = new SourceMaterialResources(
      root,
      {} as TgpuSampler,
      [stone],
      [],
    );

    expect(createTexture).toHaveBeenCalledTimes(2); // fallback + stone
    resources.setMaterials([stone, metal]);
    expect(createTexture).toHaveBeenCalledTimes(3);
    expect(destroyed).toEqual([]);

    resources.setMaterials([material("stone", 160)]);
    expect(createTexture).toHaveBeenCalledTimes(4);
    expect(destroyed).toEqual(expect.arrayContaining(["STONE", "METAL"]));
    resources.dispose();
  });
});
