import { encodeQuakeWad2 } from "@tea/maps-editor/core";
import { createQuakePalette } from "@tea/maps-renderer/core";
import { expect, it, vi } from "vitest";
import { loadHostedEditorResources } from "../editor-hosted-resource-loader.ts";

it("loads hosted WAD materials and entity definitions from authenticated mounts", async () => {
  const material = {
    name: "TEST_STONE",
    sourceName: "generated",
    width: 16,
    height: 16,
    rgba: new Uint8Array(16 * 16 * 4).fill(255),
    alphaTest: false,
  };
  const files = new Map([
    [
      "wad-1",
      new Uint8Array(encodeQuakeWad2([material], createQuakePalette())),
    ],
    [
      "fgd-1",
      new TextEncoder().encode(
        '@PointClass size(-8 -8 -8, 8 8 8) = light_test : "Test light" []',
      ),
    ],
  ]);
  const mounts = [
    { id: "wad-1", kind: "wad", displayName: "test.wad" },
    { id: "fgd-1", kind: "fgd", displayName: "entities/test.fgd" },
  ].map((entry, ordinal) => ({
    ...entry,
    ordinal,
    provider: "upload",
    providerAssetId: entry.id,
    expectedSha256: "a".repeat(64),
    size: files.get(entry.id)!.byteLength,
    createdAt: 1,
  }));
  const fetcher = vi.fn<typeof fetch>(async (path, init) => {
    expect(init?.credentials).toBe("same-origin");
    if (String(path).endsWith("/resources")) return Response.json({ mounts });
    const id = String(path).split("/").at(-2)!;
    return new Response(files.get(id));
  });

  const resources = await loadHostedEditorResources(
    "project-1",
    "quake",
    fetcher,
  );
  expect(resources.materials.some(({ name }) => name === "TEST_STONE")).toBe(
    true,
  );
  expect(resources.definitions.find("light_test")?.kind).toBe("point");
  expect(resources.materialDiagnostics).toEqual([]);
  expect(resources.definitionDiagnostics).toEqual([]);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
