import { describe, expect, it } from "vitest";
import {
  createQuakePalette,
  decodeMipTexture,
  parseWad,
} from "@tea/maps-renderer/core";

import {
  EditorSession,
  EditorMaterialCatalog,
  MapCompileCoordinator,
  RemoteMapCompiler,
  brushesInDocument,
  createBoxBrush,
  createSequentialIdFactory,
  createStarterDocument,
  compiledBspVersion,
  deriveBrush,
  createDevelopmentMaterials,
  createDiagnosticQuakePalette,
  developmentTexturePack,
  encodeGoldSrcWad3,
  encodeQuakeWad2,
  parseMap,
  serializeMap,
  selectMapBuildProfile,
  selectMapLaunchProfile,
  supportsCompiledBspPreview,
  textureCoordinates,
  translateBrush,
  type MapCompileResult,
  type MapCompiler,
} from "../src/core/index.js";
import { makeTestWad } from "./support/core-fixtures.js";

describe("Valve 220 source documents", () => {
  it("round trips normalized source without changing derived geometry or projections", () => {
    const original = createStarterDocument();
    const source = serializeMap(original);
    const parsed = parseMap(source, createSequentialIdFactory("roundtrip"));
    const originalBrushes = brushesInDocument(original);
    const parsedBrushes = brushesInDocument(parsed);

    expect(parsed.format).toBe("quake-map");
    expect(parsed.faceSyntax).toBe("valve-220");
    expect(parsed.entities[0]?.properties).toEqual(
      original.entities[0]?.properties,
    );
    expect(parsedBrushes).toHaveLength(originalBrushes.length);
    for (let index = 0; index < originalBrushes.length; index += 1) {
      expect(deriveBrush(parsedBrushes[index]!).bounds).toEqual(
        deriveBrush(originalBrushes[index]!).bounds,
      );
      expect(parsedBrushes[index]?.faces.map((face) => face.material)).toEqual(
        originalBrushes[index]?.faces.map((face) => face.material),
      );
      expect(
        parsedBrushes[index]?.faces.map((face) => face.projection),
      ).toEqual(originalBrushes[index]?.faces.map((face) => face.projection));
    }
  });

  it("imports classic Quake projection fields into explicit face axes", () => {
    const valve = createStarterDocument();
    const quake = { ...valve, faceSyntax: "quake" as const };
    const parsed = parseMap(serializeMap(quake));

    expect(parsed.format).toBe("quake-map");
    expect(parsed.faceSyntax).toBe("quake");
    expect(deriveBrush(brushesInDocument(parsed)[0]!).valid).toBe(true);
  });

  it("preserves texel coordinates when a brush is translated with texture lock", () => {
    const brush = createBoxBrush([-16, -16, -16], [16, 16, 16]);
    const originalFace = brush.faces[0]!;
    const originalPoint = originalFace.planePoints[0];
    const moved = translateBrush(brush, [32, -16, 8], true);
    const movedFace = moved.faces[0]!;
    const movedPoint = movedFace.planePoints[0];

    expect(textureCoordinates(movedFace, movedPoint)[0]).toBeCloseTo(
      textureCoordinates(originalFace, originalPoint)[0],
    );
    expect(textureCoordinates(movedFace, movedPoint)[1]).toBeCloseTo(
      textureCoordinates(originalFace, originalPoint)[1],
    );
  });
});

describe("editor material catalog", () => {
  it("imports WAD3 previews and resolves material names case-insensitively", () => {
    const catalog = new EditorMaterialCatalog();
    const bytes = makeTestWad(3, "BRICK");
    const result = catalog.importWad("fixture.wad", bytes, new Uint8Array(768));

    expect(result).toMatchObject({
      wadVersion: 3,
      added: 1,
      replaced: 0,
      skipped: 0,
    });
    expect(catalog.find("brick")).toMatchObject({
      name: "BRICK",
      sourceName: "fixture.wad",
      width: 16,
      height: 16,
    });
    expect(catalog.find("brick")?.rgba).toHaveLength(16 * 16 * 4);
    expect(catalog.find("brick")?.rgba).toEqual(
      decodeMipTexture(parseWad(bytes).lumps[0]!.data).levels[0]!.rgba,
    );
  });

  it("quantizes Quake development colors and preserves GoldSrc orange in previews and WADs", () => {
    for (const [game, palette, color] of [
      ["quake", undefined, [175, 103, 35, 255]],
      ["quake", new Uint8Array(768).fill(120), [120, 120, 120, 255]],
      ["goldsrc", undefined, [205, 82, 13, 255]],
    ] as const) {
      const pack = developmentTexturePack(game, palette)!;
      const wad = parseWad(pack.wad);
      expect(wad.version).toBe(game === "quake" ? 2 : 3);
      const floor = pack.materials.find(({ name }) => name === "DEV_FLOOR")!;
      const lump = wad.lumps.find(({ name }) => name === floor.name)!;
      const decoded = decodeMipTexture(
        lump.data,
        game === "quake" ? (palette ?? createQuakePalette()) : undefined,
      );
      const center = (32 * floor.width + 32) * 4;
      expect(floor.rgba.slice(center, center + 4)).toEqual(
        new Uint8Array(color),
      );
      expect(decoded.levels[0]!.rgba.slice(center, center + 4)).toEqual(
        new Uint8Array(color),
      );
    }
  });

  it("rejects invalid image dimensions before writing a WAD", () => {
    const material = createDevelopmentMaterials()[0]!;
    for (const encode of [
      encodeGoldSrcWad3,
      (materials: (typeof material)[]) =>
        encodeQuakeWad2(materials, createQuakePalette()),
    ]) {
      for (const width of [0, 7, 4097, Number.NaN])
        expect(() => encode([{ ...material, width }])).toThrow(/dimensions/);
      expect(() =>
        encode([{ ...material, rgba: material.rgba.slice(4) }]),
      ).toThrow(/RGBA dimensions/);
    }
  });

  it("keeps GoldSrc transparency separate from opaque per-texture colors", () => {
    const original = createDevelopmentMaterials()[0]!;
    const rgba = original.rgba.slice();
    rgba[3] = 0;
    const wad = parseWad(
      encodeGoldSrcWad3([
        { ...original, name: "{MASK", alphaTest: true, rgba },
      ]),
    );
    const decoded = decodeMipTexture(wad.lumps[0]!.data);
    expect(decoded.levels[0]!.rgba.slice(0, 4)).toEqual(new Uint8Array(4));
    expect(decoded.levels[0]!.rgba.slice(4)).toEqual(original.rgba.slice(4));
    expect(decoded.levels).toHaveLength(4);
  });

  it("imports WAD2 with the included standard Quake palette", () => {
    const catalog = new EditorMaterialCatalog();
    const result = catalog.importWad("quake.wad", makeTestWad(2));

    expect(result).toMatchObject({
      wadVersion: 2,
      added: 1,
      skipped: 0,
      diagnostics: [],
    });
    expect(catalog.materials()[0]?.rgba).toEqual(
      decodeMipTexture(
        parseWad(makeTestWad(2)).lumps[0]!.data,
        createQuakePalette(),
      ).levels[0]!.rgba,
    );
  });

  it("keeps generated Quake mip colors out of the fullbright range, preserving transparency", () => {
    const palette = createDiagnosticQuakePalette();
    const materials = createDevelopmentMaterials();
    const masked = {
      ...materials[0]!,
      name: "{DEV_MASKED",
      alphaTest: true,
      rgba: materials[0]!.rgba.slice(),
    };
    masked.rgba[3] = 0;
    const wad = parseWad(encodeQuakeWad2([...materials, masked], palette));

    expect(wad.version).toBe(2);
    for (const lump of wad.lumps) {
      const data = lump.data;
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      for (let level = 0; level < 4; level += 1) {
        const offset = view.getUint32(24 + level * 4, true);
        const size = (64 >> level) ** 2;
        const opaque = data
          .slice(offset, offset + size)
          .filter((index) => index !== 255);
        expect(Math.max(...opaque)).toBeLessThan(224);
        if (lump.name !== masked.name)
          expect(data.slice(offset, offset + size)).not.toContain(255);
      }
    }
    const decoded = decodeMipTexture(wad.lumps.at(-1)!.data, palette);
    expect(decoded.levels[0]!.rgba.slice(0, 4)).toEqual(
      new Uint8Array([0, 0, 0, 0]),
    );
    expect(decoded.levels[0]!.rgba[7]).toBe(255);
  });
});

describe("compiler coordination", () => {
  it("refuses to install a compile result after the source revision changes", async () => {
    let finish!: (result: MapCompileResult) => void;
    const compiler: MapCompiler = {
      backend: "wasm",
      compile: () => new Promise((resolve) => (finish = resolve)),
    };
    const session = new EditorSession(createStarterDocument());
    const coordinator = new MapCompileCoordinator(compiler);
    const running = coordinator.compile(
      {
        mapName: "preview",
        mapText: serializeMap(session.document),
        quality: "preview",
        expectedDocumentRevision: session.document.revision,
      },
      () => session.document.revision,
    );
    const brush = brushesInDocument(session.document)[1]!;
    session.translate(brush.id, [16, 0, 0]);
    finish({
      backend: "wasm",
      status: "succeeded",
      buildId: "test-build",
      sourceDocumentRevision: 0,
      diagnostics: [],
      artifacts: [],
      logs: [],
      elapsedMilliseconds: 10,
    });

    await expect(running).resolves.toMatchObject({ status: "stale" });
  });

  it("posts the remote protocol and decodes bounded binary artifacts", async () => {
    let requestBody: unknown;
    const compiler = new RemoteMapCompiler({
      endpoint: "https://compiler.invalid/compile",
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            status: "succeeded",
            buildId: "remote-build",
            sourceDocumentRevision: 7,
            diagnostics: [],
            artifacts: [
              {
                name: "preview.bsp",
                mediaType: "application/x-quake-bsp",
                base64: "AQID",
                kind: "bsp",
              },
            ],
            logs: [],
            elapsedMilliseconds: 25,
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    });
    const result = await compiler.compile({
      mapName: "preview",
      mapText: "{ }",
      quality: "preview",
      expectedDocumentRevision: 7,
      assets: [
        {
          name: "textures.wad",
          mediaType: "application/x-wad",
          data: new Uint8Array([4, 5, 6]).buffer,
        },
      ],
    });

    expect(requestBody).toMatchObject({
      mapName: "preview",
      expectedDocumentRevision: 7,
      assets: [{ name: "textures.wad", base64: "BAUG" }],
    });
    expect(result.backend).toBe("remote");
    expect([...new Uint8Array(result.artifacts[0]!.data)]).toEqual([1, 2, 3]);
  });

  it("cancels the active compiler request without installing a result", async () => {
    const compiler: MapCompiler = {
      backend: "remote",
      compile: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () =>
              reject(
                Object.assign(new Error("cancelled"), { name: "AbortError" }),
              ),
            { once: true },
          );
        }),
    };
    const coordinator = new MapCompileCoordinator(compiler);
    const running = coordinator.compile(
      {
        mapName: "cancelled",
        mapText: "{}",
        quality: "preview",
        expectedDocumentRevision: 0,
      },
      () => 0,
    );

    coordinator.cancel();

    await expect(running).resolves.toEqual({ status: "cancelled" });
  });

  it("discovers helper capabilities and launches only a build/profile/revision tuple", async () => {
    const requests: {
      url: string;
      body?: unknown;
      signal?: AbortSignal | null;
    }[] = [];
    const compiler = new RemoteMapCompiler({
      endpoint: "http://127.0.0.1:8788/compile",
      fetch: async (input, init) => {
        const url = String(input);
        requests.push({
          url,
          ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
          ...(init?.signal === undefined ? {} : { signal: init.signal }),
        });
        if (url.endsWith("/capabilities")) {
          return Response.json({
            protocolVersion: 1,
            compileProfiles: [
              {
                id: "default",
                label: "Local tools",
                game: "quake",
                qualities: ["preview", "final"],
              },
            ],
            launchProfiles: [{ id: "quake", label: "Quake", game: "quake" }],
          });
        }
        return Response.json({
          buildId: "build-7",
          profileId: "quake",
          sourceDocumentRevision: 7,
          launchedAt: 123,
        });
      },
    });
    const controller = new AbortController();

    await expect(
      compiler.capabilities(controller.signal),
    ).resolves.toMatchObject({
      protocolVersion: 1,
      compileProfiles: [{ id: "default", game: "quake" }],
    });
    await expect(
      compiler.launch({
        buildId: "build-7",
        profileId: "quake",
        expectedDocumentRevision: 7,
      }),
    ).resolves.toMatchObject({ buildId: "build-7", sourceDocumentRevision: 7 });
    expect(requests).toEqual([
      expect.objectContaining({
        url: "http://127.0.0.1:8788/capabilities",
        signal: controller.signal,
      }),
      expect.objectContaining({
        url: "http://127.0.0.1:8788/launch",
        body: {
          buildId: "build-7",
          profileId: "quake",
          expectedDocumentRevision: 7,
        },
      }),
    ]);
  });

  it("selects compile and launch capabilities only within the active game boundary", () => {
    const capabilities = {
      protocolVersion: 1 as const,
      compileProfiles: [
        {
          id: "default",
          label: "Quake",
          game: "quake" as const,
          qualities: ["preview"] as const,
        },
        {
          id: "q2-final",
          label: "Quake II final",
          game: "quake2" as const,
          qualities: ["final"] as const,
        },
      ],
      launchProfiles: [
        { id: "quake", label: "Quake", game: "quake" as const },
        { id: "quake2", label: "Quake II", game: "quake2" as const },
      ],
    };

    expect(
      selectMapBuildProfile(capabilities, {
        game: "quake2",
        quality: "preview",
      }),
    ).toBeUndefined();
    expect(
      selectMapBuildProfile(capabilities, { game: "quake2", quality: "final" })
        ?.id,
    ).toBe("q2-final");
    expect(selectMapLaunchProfile(capabilities, "quake2")?.id).toBe("quake2");
  });

  it("reads classic, BSP2, IBSP, and QBSP compiled-map versions without conflating magic words", () => {
    const classic = new ArrayBuffer(4);
    new DataView(classic).setInt32(0, 29, true);
    const ibsp = new ArrayBuffer(8);
    new DataView(ibsp).setInt32(0, 0x50534249, true);
    new DataView(ibsp).setInt32(4, 38, true);
    const qbsp = ibsp.slice(0);
    new DataView(qbsp).setInt32(0, 0x50534251, true);
    const bsp2 = new TextEncoder().encode("BSP2").buffer;

    expect(compiledBspVersion(classic)).toBe(29);
    expect(compiledBspVersion(bsp2)).toBe("BSP2");
    expect(compiledBspVersion(ibsp)).toBe(38);
    expect(compiledBspVersion(qbsp)).toBe(38);
    expect(compiledBspVersion(new ArrayBuffer(3))).toBeNull();
    expect(supportsCompiledBspPreview(classic)).toBe(true);
    expect(supportsCompiledBspPreview(bsp2)).toBe(true);
    expect(supportsCompiledBspPreview(ibsp)).toBe(true);
    expect(supportsCompiledBspPreview(qbsp)).toBe(true);
    new DataView(ibsp).setInt32(4, 46, true);
    expect(supportsCompiledBspPreview(ibsp)).toBe(false);
  });

  it("keeps structured failed-build diagnostics and artifacts available to the editor", async () => {
    const compiler = new RemoteMapCompiler({
      endpoint: "https://compiler.invalid/compile",
      fetch: async () =>
        Response.json({
          status: "failed",
          buildId: "failed-build",
          sourceDocumentRevision: 4,
          diagnostics: [
            { severity: "error", stage: "qbsp", message: "MAP LEAKED" },
          ],
          artifacts: [
            {
              name: "failed.pts",
              mediaType: "text/plain",
              base64: "MCAwIDAKMTYgMCAwCg==",
              kind: "leak-path",
              stage: "qbsp",
            },
          ],
          logs: [{ stage: "qbsp", text: "MAP LEAKED", truncated: false }],
          elapsedMilliseconds: 5,
        }),
    });

    await expect(
      compiler.compile({
        mapName: "failed",
        mapText: "{}",
        quality: "preview",
        expectedDocumentRevision: 4,
      }),
    ).resolves.toMatchObject({
      status: "failed",
      diagnostics: [{ severity: "error", stage: "qbsp" }],
      artifacts: [{ kind: "leak-path", stage: "qbsp" }],
    });
  });
});
