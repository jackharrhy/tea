import {
  developmentTexturePack,
  EntityDefinitionCatalog,
  EditorMaterialCatalog,
  mapSourceFingerprint,
  parseEntityDefinitionFile,
  parseWorldviewProject,
  worldviewGameProfile,
  type EntityDefinitionDiagnostic,
  type EditorMaterial,
  type ParsedEntityDefinitionFile,
  type WorldviewProjectManifest,
} from "@tea/maps-editor/core";
import {
  parseWad,
  readPcxPalette,
  readWalTextureHeader,
} from "@tea/maps-renderer/core";
import type { MapFileHandle } from "./editor-files.ts";
import type { EditorSpriteMaterial } from "@tea/maps-editor/render";
import {
  decodeProjectMaterialImage,
  projectMaterialName,
} from "./editor-project-images.ts";
import { loadProjectSprites } from "./editor-project-sprites.ts";
import type { ProjectDirectoryIdentity } from "./editor-project-build-bindings.ts";

export interface MapDirectoryHandle extends ProjectDirectoryIdentity {
  readonly kind: "directory";
  readonly name: string;
  getFileHandle(
    name: string,
    options?: { readonly create?: boolean },
  ): Promise<MapFileHandle>;
  getDirectoryHandle(name: string): Promise<MapDirectoryHandle>;
  queryPermission?(options: { readonly mode: "readwrite" }): Promise<string>;
  requestPermission?(options: { readonly mode: "readwrite" }): Promise<string>;
  entries(): AsyncIterableIterator<
    [string, MapDirectoryHandle | (MapFileHandle & { readonly kind: "file" })]
  >;
}

export interface ProjectMap {
  readonly path: string;
  readonly handle: MapFileHandle;
}

export interface MapProject {
  readonly handle: MapDirectoryHandle;
  readonly manifestFileName: string;
  readonly manifestFingerprint: string;
  readonly manifest: WorldviewProjectManifest;
  readonly maps: readonly ProjectMap[];
  readonly definitions: EntityDefinitionCatalog;
  readonly definitionDiagnostics: readonly EntityDefinitionDiagnostic[];
  readonly materials: readonly EditorMaterial[];
  readonly materialDiagnostics: readonly string[];
  readonly sprites: readonly EditorSpriteMaterial[];
  readonly spriteDiagnostics: readonly string[];
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options: {
    readonly mode: "readwrite";
  }) => Promise<MapDirectoryHandle>;
}

export function supportsProjectPicker(): boolean {
  return !!(window as DirectoryPickerWindow).showDirectoryPicker;
}

export async function pickProjectDirectory(): Promise<MapDirectoryHandle | null> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) return null;
  return picker({ mode: "readwrite" });
}

async function directoryAt(
  root: MapDirectoryHandle,
  relativePath: string,
): Promise<MapDirectoryHandle> {
  let current = root;
  for (const part of relativePath.split("/")) {
    if (part && part !== ".") current = await current.getDirectoryHandle(part);
  }
  return current;
}

export async function projectFile(
  root: MapDirectoryHandle,
  path: string,
): Promise<File> {
  if (
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[a-z][a-z\d+.-]*:/i.test(path) ||
    path.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new Error(`Resource escapes the project folder: ${path}`);
  }
  const parts = path.split("/").filter((part) => part !== ".");
  const fileName = parts.pop();
  if (!fileName) throw new Error(`Invalid project resource path: ${path}`);
  const directory = await directoryAt(root, parts.join("/"));
  return (await directory.getFileHandle(fileName)).getFile();
}

export async function projectManifestFile(
  root: MapDirectoryHandle,
): Promise<{ name: string; file: File }> {
  const names = ["tea.maps.project.json", "worldview.project.json"];
  const found = new Set<string>();
  for await (const [name, handle] of root.entries()) {
    if (handle.kind === "file" && names.includes(name)) found.add(name);
  }
  const name = names.find((candidate) => found.has(candidate));
  if (!name) throw new Error(`Project folder needs ${names.join(" or ")}`);
  return { name, file: await (await root.getFileHandle(name)).getFile() };
}

async function mapsInDirectory(
  directory: MapDirectoryHandle,
  prefix: string,
): Promise<ProjectMap[]> {
  const maps: ProjectMap[] = [];
  for await (const [name, handle] of directory.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      maps.push(...(await mapsInDirectory(handle, path)));
    } else if (name.toLowerCase().endsWith(".map")) {
      maps.push({ path, handle });
    }
  }
  return maps;
}

interface ProjectTextureFile {
  readonly logicalPath: string;
  readonly sourcePath: string;
  readonly handle: MapFileHandle;
}

async function textureFilesInDirectory(
  directory: MapDirectoryHandle,
  prefix: string,
  root: string,
): Promise<readonly ProjectTextureFile[]> {
  const files: ProjectTextureFile[] = [];
  for await (const [name, entry] of directory.entries()) {
    const logicalPath = `${prefix}/${name}`;
    if (entry.kind === "directory") {
      files.push(...(await textureFilesInDirectory(entry, logicalPath, root)));
    } else if (/\.(?:wal|png|jpe?g|tga)$/i.test(name)) {
      files.push({
        logicalPath: logicalPath.toLowerCase(),
        sourcePath: root === "." ? logicalPath : `${root}/${logicalPath}`,
        handle: entry,
      });
    }
  }
  return files.toSorted((left, right) =>
    left.logicalPath.localeCompare(right.logicalPath),
  );
}

async function gameRootResources(
  handle: MapDirectoryHandle,
  manifest: WorldviewProjectManifest,
  loadPalette: boolean,
): Promise<{
  palette?: Uint8Array;
  textures: readonly ProjectTextureFile[];
  diagnostics: readonly string[];
}> {
  const palettePath =
    manifest.game === "quake" ? "gfx/palette.lmp" : "pics/colormap.pcx";
  const diagnostics: string[] = [];
  const textureFiles: ProjectTextureFile[] = [];
  let palette: Uint8Array | undefined;
  for (const root of manifest.resources.gameRoots ?? []) {
    let directory: MapDirectoryHandle;
    try {
      directory = await directoryAt(handle, root);
    } catch (error) {
      diagnostics.push(
        `${root}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    if (loadPalette) {
      const path = root === "." ? palettePath : `${root}/${palettePath}`;
      const paletteFile = await projectFile(handle, path).catch(() => null);
      if (paletteFile) {
        try {
          const bytes = new Uint8Array(await paletteFile.arrayBuffer());
          if (palettePath.endsWith(".pcx")) {
            palette = readPcxPalette(bytes);
          } else if (bytes.byteLength >= 768) {
            palette = bytes.slice(0, 768);
          } else {
            throw new Error("Palette needs at least 768 bytes");
          }
        } catch (error) {
          diagnostics.push(
            `${path}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
    const textures = await directory
      .getDirectoryHandle("textures")
      .catch(() => null);
    if (textures) {
      try {
        textureFiles.push(
          ...(await textureFilesInDirectory(textures, "textures", root)),
        );
      } catch (error) {
        diagnostics.push(
          `${root}/textures: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  return {
    ...(palette ? { palette } : {}),
    textures: textureFiles,
    diagnostics,
  };
}

async function loadProjectDefinitions(
  handle: MapDirectoryHandle,
  manifest: WorldviewProjectManifest,
): Promise<{
  definitions: EntityDefinitionCatalog;
  diagnostics: readonly EntityDefinitionDiagnostic[];
}> {
  const parsed: ParsedEntityDefinitionFile[] = [];
  const diagnostics: EntityDefinitionDiagnostic[] = [];
  const loaded = new Set<string>();
  const load = async (
    path: string,
    format: "fgd" | "def" | "ent",
  ): Promise<void> => {
    const normalized = path.toLowerCase();
    if (loaded.has(normalized)) return;
    loaded.add(normalized);
    try {
      const parts = path.split("/").filter((part) => part !== ".");
      parts.pop();
      const file = await projectFile(handle, path);
      const result = parseEntityDefinitionFile(format, await file.text(), path);
      parsed.push(result);
      diagnostics.push(...result.diagnostics);
      if (format !== "fgd") return;
      const parent = parts.length ? `${parts.join("/")}/` : "";
      for (const include of result.includes) {
        await load(`${parent}${include}`, "fgd");
      }
    } catch (error) {
      diagnostics.push({
        severity: "error",
        message: error instanceof Error ? error.message : String(error),
        sourcePath: path,
      });
    }
  };
  for (const { path, format } of manifest.resources.entityDefinitions) {
    await load(path, format);
  }
  return { definitions: new EntityDefinitionCatalog(parsed), diagnostics };
}

async function loadProjectMaterials(
  handle: MapDirectoryHandle,
  manifest: WorldviewProjectManifest,
): Promise<{
  materials: readonly EditorMaterial[];
  diagnostics: readonly string[];
}> {
  const diagnostics: string[] = [];
  let palette: Uint8Array | undefined;
  const palettePath = manifest.resources.palette;
  if (palettePath) {
    try {
      const bytes = new Uint8Array(
        await (await projectFile(handle, palettePath)).arrayBuffer(),
      );
      if (palettePath.toLowerCase().endsWith(".pcx")) {
        palette = readPcxPalette(bytes);
      } else if (bytes.byteLength >= 768) {
        palette = bytes.slice(0, 768);
      } else {
        throw new Error("Palette needs at least 768 bytes");
      }
    } catch (error) {
      diagnostics.push(
        `${palettePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const gameResources = await gameRootResources(handle, manifest, !palette);
  diagnostics.push(...gameResources.diagnostics);
  palette ??= gameResources.palette;
  const catalog = new EditorMaterialCatalog();
  for (const material of developmentTexturePack(manifest.game, palette)
    ?.materials ?? []) {
    catalog.set(material);
  }
  const profile = worldviewGameProfile(manifest.game);
  for (const path of manifest.resources.wads) {
    try {
      const bytes = await (await projectFile(handle, path)).arrayBuffer();
      const wad = parseWad(bytes);
      if (!profile.wadVersions.includes(wad.version)) {
        throw new Error(
          `WAD${wad.version} is not supported by ${profile.label}`,
        );
      }
      diagnostics.push(
        ...wad.warnings.map((warning) => `${path}: ${warning.message}`),
      );
      const result = catalog.importWad(path, bytes, palette);
      diagnostics.push(
        ...result.diagnostics.map(
          (diagnostic) => `${path}: ${diagnostic.message}`,
        ),
      );
    } catch (error) {
      diagnostics.push(
        `${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const wals =
    profile.materialFormat === "wal"
      ? gameResources.textures.filter(({ logicalPath }) =>
          logicalPath.endsWith(".wal"),
        )
      : [];
  const walsByPath = new Map(wals.map((wal) => [wal.logicalPath, wal]));
  if (wals.length > 0 && !palette) {
    diagnostics.push(
      "Quake II WAL textures need pics/colormap.pcx in a game root or a palette resource",
    );
  } else if (palette) {
    for (const { sourcePath, handle: walHandle } of wals) {
      try {
        const result = catalog.importWal(
          sourcePath,
          await (await walHandle.getFile()).arrayBuffer(),
          palette,
        );
        diagnostics.push(
          ...result.diagnostics.map(
            (diagnostic) => `${sourcePath}: ${diagnostic.message}`,
          ),
        );
      } catch (error) {
        diagnostics.push(
          `${sourcePath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  const replacementPriority = new Map([
    ["jpeg", 0],
    ["jpg", 1],
    ["tga", 2],
    ["png", 3],
  ]);
  const replacements = new Map<string, ProjectTextureFile>();
  for (const candidate of gameResources.textures) {
    const name = projectMaterialName(candidate.logicalPath);
    const extension = candidate.logicalPath.split(".").at(-1) ?? "";
    if (!name || extension === "wal") continue;
    const existing = replacements.get(name);
    const existingExtension = existing?.logicalPath.split(".").at(-1) ?? "";
    if (
      !existing ||
      (replacementPriority.get(extension) ?? -1) >
        (replacementPriority.get(existingExtension) ?? -1) ||
      (extension === existingExtension &&
        candidate.logicalPath === existing.logicalPath)
    ) {
      replacements.set(name, candidate);
    }
  }
  for (const [name, replacement] of replacements) {
    try {
      const bytes = await (await replacement.handle.getFile()).arrayBuffer();
      const image = await decodeProjectMaterialImage(
        replacement.logicalPath,
        bytes,
      );
      const companion = walsByPath.get(`textures/${name}.wal`);
      let walHeader: ReturnType<typeof readWalTextureHeader> | null = null;
      if (companion) {
        try {
          walHeader = readWalTextureHeader(
            await (await companion.handle.getFile()).arrayBuffer(),
          );
        } catch (error) {
          diagnostics.push(
            `${companion.sourcePath}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      const original = catalog.find(name);
      catalog.set({
        name: walHeader?.name ?? name,
        sourceName: replacement.sourcePath,
        width: image.width,
        height: image.height,
        logicalWidth:
          walHeader?.width ??
          original?.logicalWidth ??
          original?.width ??
          image.width,
        logicalHeight:
          walHeader?.height ??
          original?.logicalHeight ??
          original?.height ??
          image.height,
        rgba: image.rgba,
        alphaTest: false,
      });
    } catch (error) {
      diagnostics.push(
        `${replacement.sourcePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { materials: catalog.materials(), diagnostics };
}

export async function openMapProject(
  handle: MapDirectoryHandle,
): Promise<MapProject> {
  const { name: manifestFileName, file } = await projectManifestFile(handle);
  const manifestSource = await file.text();
  const manifest = parseWorldviewProject(manifestSource);
  const maps = (
    await Promise.all(
      manifest.mapRoots.map(async (root) => {
        const directory = await directoryAt(handle, root);
        return mapsInDirectory(directory, root === "." ? "" : root);
      }),
    )
  )
    .flat()
    .toSorted((left, right) => left.path.localeCompare(right.path));
  const uniqueMaps = new Map(maps.map((map) => [map.path.toLowerCase(), map]));
  const [entityResources, materialResources, spriteResources] =
    await Promise.all([
      loadProjectDefinitions(handle, manifest),
      loadProjectMaterials(handle, manifest),
      loadProjectSprites(handle, manifest.resources.spriteRoots),
    ]);
  return {
    handle,
    manifestFileName,
    manifestFingerprint: mapSourceFingerprint(manifestSource),
    manifest,
    maps: [...uniqueMaps.values()],
    definitions: entityResources.definitions,
    definitionDiagnostics: entityResources.diagnostics,
    materials: materialResources.materials,
    materialDiagnostics: materialResources.diagnostics,
    sprites: spriteResources.sprites,
    spriteDiagnostics: spriteResources.diagnostics,
  };
}
