import { describe, expect, it } from "vitest";
import {
  createStarterDocument,
  type MapBuildService,
  type MapCompileRequest,
  type MapLaunchRequest,
} from "@tea/maps-editor/core";
import { buildMap, launchLocalBuild } from "../editor-build.ts";
import type { MapProject } from "../editor-project.ts";
import { syntheticQuakeBsp } from "../synthetic.ts";

describe("local map build", () => {
  it("sends a compile-ready map and exposes a successful BSP to the viewer", async () => {
    let request: MapCompileRequest | undefined;
    let launchRequest: MapLaunchRequest | undefined;
    const bsp = syntheticQuakeBsp();
    const service: MapBuildService = {
      backend: "remote",
      async capabilities() {
        return {
          protocolVersion: 1,
          compileProfiles: [
            {
              id: "default",
              label: "Local Quake",
              game: "quake",
              qualities: ["preview", "final"],
            },
          ],
          launchProfiles: [
            { id: "quake-launch", label: "Quake", game: "quake" },
            { id: "quake2-launch", label: "Quake II", game: "quake2" },
          ],
        };
      },
      async compile(input) {
        request = input;
        return {
          backend: "remote",
          status: "succeeded",
          buildId: "test-build",
          sourceDocumentRevision: input.expectedDocumentRevision,
          diagnostics: [],
          logs: [],
          elapsedMilliseconds: 1,
          artifacts: [
            {
              name: "tea_map.bsp",
              mediaType: "application/x-quake-bsp",
              kind: "bsp",
              data: bsp,
            },
          ],
        };
      },
      async launch(input) {
        launchRequest = input;
        return {
          buildId: input.buildId,
          profileId: input.profileId,
          sourceDocumentRevision: input.expectedDocumentRevision,
          launchedAt: 1,
        };
      },
    };

    const built = await buildMap(
      {
        document: createStarterDocument(),
        mapName: "Tea map.map",
        project: null,
        quality: "preview",
      },
      service,
    );

    expect(request).toMatchObject({
      mapName: "Tea_map",
      quality: "preview",
      profileId: "default",
    });
    expect(request?.mapText).toContain("worldview_dev.wad");
    expect(request?.assets?.map(({ name }) => name)).toEqual([
      "worldview_dev.wad",
    ]);
    expect(built.previewSource?.bsp).toBeInstanceOf(File);
    expect(built.previewSource?.wads).toHaveLength(1);
    expect(built.launchProfileId).toBe("quake-launch");
    await launchLocalBuild(built.result, built.launchProfileId!, service);
    expect(launchRequest).toMatchObject({
      buildId: "test-build",
      profileId: "quake-launch",
      expectedDocumentRevision: built.result.sourceDocumentRevision,
    });
  });

  it("uses later game roots for Quake II textures and includes the palette", async () => {
    const files = new Map<string, Uint8Array>([
      ["baseq2/pics/colormap.pcx", Uint8Array.of(1)],
      ["baseq2/textures/e1u1/test.wal", Uint8Array.of(2)],
      ["mod/textures/e1u1/test.wal", Uint8Array.of(3)],
      ["mod/textures/e1u1/test.png", Uint8Array.of(4)],
    ]);
    const directory = (prefix = "") => ({
      kind: "directory" as const,
      name: prefix,
      async getDirectoryHandle(name: string) {
        return directory(prefix ? `${prefix}/${name}` : name);
      },
      async getFileHandle(name: string) {
        const path = prefix ? `${prefix}/${name}` : name;
        const bytes = files.get(path);
        if (!bytes) throw new DOMException("File not found", "NotFoundError");
        return {
          kind: "file" as const,
          name,
          async getFile() {
            return new File([new Uint8Array(bytes!)], name);
          },
        };
      },
    });
    const base = createStarterDocument();
    const document = {
      ...base,
      entities: base.entities.map((entity) => ({
        ...entity,
        primitives: entity.primitives.map((primitive) =>
          primitive.kind === "brush"
            ? {
                ...primitive,
                faces: primitive.faces.map((face) => ({
                  ...face,
                  material: "e1u1/test",
                })),
              }
            : primitive,
        ),
      })),
    };
    let request: MapCompileRequest | undefined;
    const service: MapBuildService = {
      backend: "remote",
      async capabilities() {
        return {
          protocolVersion: 1,
          compileProfiles: [
            {
              id: "default",
              label: "Local Quake II",
              game: "quake2",
              qualities: ["preview"],
            },
          ],
          launchProfiles: [],
        };
      },
      async compile(input) {
        request = input;
        return {
          backend: "remote",
          status: "failed",
          buildId: "test-build",
          sourceDocumentRevision: input.expectedDocumentRevision,
          diagnostics: [],
          logs: [],
          elapsedMilliseconds: 1,
          artifacts: [],
        };
      },
      async launch() {
        throw new Error("Not used");
      },
    };
    const project = {
      handle: directory(),
      manifest: {
        game: "quake2",
        resources: { wads: [], gameRoots: ["baseq2", "mod"] },
      },
    } as unknown as MapProject;

    await buildMap(
      { document, mapName: "q2.map", project, quality: "preview" },
      service,
    );

    expect(request?.assets?.map(({ name }) => name)).toEqual([
      "pics/colormap.pcx",
      "textures/e1u1/test.wal",
      "textures/e1u1/test.png",
    ]);
    expect(new Uint8Array(request!.assets![1]!.data)).toEqual(Uint8Array.of(3));
  });

  it("uses a hosted map's game when no local project is open", async () => {
    let request: MapCompileRequest | undefined;
    const service: MapBuildService = {
      backend: "remote",
      async capabilities() {
        return {
          protocolVersion: 1,
          compileProfiles: [
            {
              id: "default",
              label: "Local GoldSrc",
              game: "goldsrc",
              qualities: ["preview"],
            },
          ],
          launchProfiles: [],
        };
      },
      async compile(input) {
        request = input;
        return {
          backend: "remote",
          status: "failed",
          buildId: "test-build",
          sourceDocumentRevision: input.expectedDocumentRevision,
          diagnostics: [],
          logs: [],
          elapsedMilliseconds: 1,
          artifacts: [],
        };
      },
      async launch() {
        throw new Error("Not used");
      },
    };

    await buildMap(
      {
        document: createStarterDocument(),
        mapName: "hosted.map",
        game: "goldsrc",
        project: null,
        quality: "preview",
      },
      service,
    );

    expect(
      new TextDecoder().decode(request!.assets![0]!.data.slice(0, 4)),
    ).toBe("WAD3");
  });

  it("uses a compatible project binding and falls back when it disappears", async () => {
    const selected: string[] = [];
    const service: MapBuildService = {
      backend: "remote",
      async capabilities() {
        return {
          protocolVersion: 1,
          compileProfiles: [
            {
              id: "default",
              label: "Default",
              game: "quake",
              qualities: ["preview"],
            },
            {
              id: "fast",
              label: "Fast",
              game: "quake",
              qualities: ["preview"],
            },
          ],
          launchProfiles: [],
        };
      },
      async compile(input) {
        selected.push(input.profileId ?? "");
        return {
          backend: "remote",
          status: "failed",
          buildId: "test-build",
          sourceDocumentRevision: input.expectedDocumentRevision,
          diagnostics: [],
          logs: [],
          elapsedMilliseconds: 1,
          artifacts: [],
        };
      },
      async launch() {
        throw new Error("Not used");
      },
    };
    const input = {
      document: createStarterDocument(),
      mapName: "bound.map",
      project: null,
      quality: "preview" as const,
    };

    const bound = await buildMap(
      { ...input, preferredProfileId: "fast" },
      service,
    );
    const fallback = await buildMap(
      { ...input, preferredProfileId: "removed" },
      service,
    );

    expect(selected).toEqual(["fast", "default"]);
    expect([bound.profileId, fallback.profileId]).toEqual(["fast", "default"]);
  });
});
