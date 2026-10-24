import {
  developmentTexturePack,
  documentWithoutOmittedLayers,
  materialUsageInDocument,
  RemoteMapCompiler,
  selectMapBuildProfile,
  selectMapLaunchProfile,
  serializeMap,
  serializeMapForCompile,
  supportsCompiledBspPreview,
  type MapCompileInputAsset,
  type MapCompileQuality,
  type MapCompileResult,
  type MapDocument,
  type MapBuildService,
  type MapsGameProfile,
} from "@tea/maps-editor/core";
import type { WorldSource } from "@jackharrhy/tea-maps-renderer";
import { classifyMaterial } from "@jackharrhy/tea-maps-renderer/core";
import { isGameTreeAssetPath } from "@tea/maps-protocol";
import { projectFile, type MapProject } from "./editor-project.ts";
import type { StandaloneResources } from "./editor-standalone-resources.ts";
import {
  downloadBuildFile,
  type BuildExportInput,
} from "./editor-build-export.ts";

const compiler = new RemoteMapCompiler({
  endpoint: "http://127.0.0.1:8788/compile",
});

function wadName(path: string, index: number): string {
  const basename = path.split("/").at(-1) ?? "";
  const stem = basename
    .replace(/\.wad$/i, "")
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .slice(0, 112);
  return `${stem || `textures_${index}`}.wad`;
}

async function compileAssets(
  project: MapProject | null,
  document: MapDocument,
  game: MapsGameProfile,
  standalone: StandaloneResources | null,
): Promise<MapCompileInputAsset[]> {
  const assets: MapCompileInputAsset[] = [];
  const pack = developmentTexturePack(game, standalone?.palette ?? undefined);
  if (pack) {
    assets.push({
      name: "tea_maps_dev.wad",
      mediaType: "application/x-wad",
      data: pack.wad,
    });
  }
  for (const [index, wad] of (project
    ? []
    : (standalone?.wads ?? [])
  ).entries()) {
    let name = wadName(wad.name, index);
    while (
      assets.some((asset) => asset.name.toLowerCase() === name.toLowerCase())
    )
      name = wadName(`${index}_${name}`, index);
    assets.push({ name, mediaType: "application/x-wad", data: wad.data });
  }
  for (const [index, path] of (
    project?.manifest.resources.wads ?? []
  ).entries()) {
    let name = wadName(path, index);
    while (
      assets.some((asset) => asset.name.toLowerCase() === name.toLowerCase())
    ) {
      name = wadName(`${index}_${name}`, index);
    }
    assets.push({
      name,
      mediaType: "application/x-wad",
      data: await (await projectFile(project!.handle, path)).arrayBuffer(),
    });
  }
  if (
    project &&
    (project.manifest.game === "quake2" || project.manifest.game === "gower")
  ) {
    const roots = project.manifest.resources.gameRoots ?? [];
    const needed = materialUsageInDocument(document)
      .map(({ material }) => material.toLowerCase())
      .filter(
        (material) => classifyMaterial(material, "quake2-bsp38") !== "tool",
      );
    const paths = [
      "pics/colormap.pcx",
      ...needed.flatMap((material) =>
        ["wal", "png", "tga", "wal_json"].map(
          (extension) => `textures/${material}.${extension}`,
        ),
      ),
    ];
    for (const logicalPath of new Set(paths)) {
      if (!isGameTreeAssetPath(logicalPath)) {
        throw new Error(`Unsupported Quake II texture path: ${logicalPath}`);
      }
      for (const root of roots.toReversed()) {
        const path = root === "." ? logicalPath : `${root}/${logicalPath}`;
        let file: File;
        try {
          file = await projectFile(project.handle, path);
        } catch (error) {
          if (
            (error instanceof DOMException && error.name === "NotFoundError") ||
            (error instanceof Error && /not found/i.test(error.message))
          ) {
            continue;
          }
          throw error;
        }
        assets.push({
          name: logicalPath,
          mediaType: file.type || "application/octet-stream",
          data: await file.arrayBuffer(),
        });
        break;
      }
    }
  }
  return assets;
}

export async function buildMap(
  input: {
    readonly document: MapDocument;
    readonly mapName: string;
    readonly project: MapProject | null;
    readonly quality: MapCompileQuality;
    readonly game?: MapsGameProfile;
    readonly standalone?: StandaloneResources | null;
    readonly preferredProfileId?: string;
  },
  buildService: MapBuildService = compiler,
): Promise<{
  result: MapCompileResult;
  profileId: string;
  launchProfileId: string | null;
  previewSource: WorldSource | null;
  exportInput: BuildExportInput | null;
}> {
  const game = input.project?.manifest.game ?? input.game ?? "quake";
  const capabilities = await buildService.capabilities();
  const profile = selectMapBuildProfile(capabilities, {
    game,
    quality: input.quality,
    ...(input.preferredProfileId
      ? { preferredId: input.preferredProfileId }
      : {}),
  });
  if (!profile) {
    throw new Error(
      `No local ${game} compiler is configured for ${input.quality} builds`,
    );
  }
  const assets = await compileAssets(
    input.project,
    input.document,
    game,
    input.standalone ?? null,
  );
  const mapText =
    game === "quake" || game === "goldsrc"
      ? serializeMapForCompile(
          input.document,
          assets.map(({ name, data }) => ({ name, data })),
          game,
        )
      : serializeMap(documentWithoutOmittedLayers(input.document));
  const mapName =
    input.mapName
      .replace(/\.map$/i, "")
      .replace(/[^A-Za-z0-9_-]/g, "_")
      .slice(0, 64) || "tea_map";
  const result = await buildService.compile({
    mapName,
    mapText,
    quality: input.quality,
    profileId: profile.id,
    expectedDocumentRevision: input.document.revision,
    assets,
  });
  const bsp = result.artifacts.find((entry) => entry.kind === "bsp");
  const previewSource =
    result.status === "succeeded" && bsp && supportsCompiledBspPreview(bsp.data)
      ? {
          bsp: new File([bsp.data], bsp.name, { type: bsp.mediaType }),
          ...(game === "quake" || game === "goldsrc"
            ? {
                ...(input.standalone?.palette
                  ? {
                      palette: new File(
                        [new Uint8Array(input.standalone.palette)],
                        "palette.lmp",
                      ),
                    }
                  : {}),
                wads: assets.map(
                  (asset) =>
                    new File([asset.data], asset.name, {
                      type: asset.mediaType,
                    }),
                ),
              }
            : {
                gameAssets: Object.fromEntries(
                  assets.map((asset) => [
                    asset.name,
                    new File([asset.data], asset.name, {
                      type: asset.mediaType,
                    }),
                  ]),
                ),
              }),
        }
      : null;
  const exportInput: BuildExportInput | null =
    result.status === "succeeded" && bsp
      ? {
          name: input.mapName,
          bsp: bsp.data,
          source: mapText,
          wads: assets.filter((asset) =>
            asset.name.toLowerCase().endsWith(".wad"),
          ),
          gameAssets: new Map(
            assets
              .filter((asset) => !asset.name.toLowerCase().endsWith(".wad"))
              .map((asset) => [asset.name, asset.data]),
          ),
          ...(input.standalone?.palette
            ? { palette: new Uint8Array(input.standalone.palette).buffer }
            : {}),
          project: input.project,
        }
      : null;
  return {
    result,
    profileId: profile.id,
    launchProfileId: selectMapLaunchProfile(capabilities, game)?.id ?? null,
    previewSource,
    exportInput,
  };
}

export async function launchLocalBuild(
  result: MapCompileResult,
  profileId: string,
  buildService: MapBuildService = compiler,
) {
  return buildService.launch({
    buildId: result.buildId,
    profileId,
    expectedDocumentRevision: result.sourceDocumentRevision,
  });
}

export function downloadBsp(result: MapCompileResult): boolean {
  const artifact = result.artifacts.find((entry) => entry.kind === "bsp");
  if (!artifact) return false;
  downloadBuildFile({
    name: artifact.name,
    data: artifact.data,
    mediaType: artifact.mediaType,
  });
  return true;
}
