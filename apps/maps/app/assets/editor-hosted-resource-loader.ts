import {
  developmentTexturePack,
  EditorMaterialCatalog,
  EntityDefinitionCatalog,
  parseEntityDefinitionFile,
  mapsGameProfile,
  type EditorMaterial,
  type EntityDefinitionDiagnostic,
  type ParsedEntityDefinitionFile,
  type MapsGameProfile,
} from "@tea/maps-editor/core";
import type { EditorSpriteMaterial } from "@tea/maps-editor/render";
import {
  parseGoldSrcSprite,
  parseWad,
  readPcxPalette,
  readWalTextureHeader,
} from "@jackharrhy/tea-maps-renderer/core";
import { listHostedResources } from "./editor-hosted-resources.ts";
import {
  decodeProjectMaterialImage,
  projectMaterialName,
} from "./editor-project-images.ts";

export interface HostedEditorResources {
  readonly definitions: EntityDefinitionCatalog;
  readonly definitionDiagnostics: readonly EntityDefinitionDiagnostic[];
  readonly materials: readonly EditorMaterial[];
  readonly materialDiagnostics: readonly string[];
  readonly sprites: readonly EditorSpriteMaterial[];
  readonly spriteDiagnostics: readonly string[];
}

interface Resource {
  readonly name: string;
  readonly kind: string;
  readonly bytes: ArrayBuffer;
}

const editorKinds = new Set([
  "wad",
  "palette",
  "fgd",
  "def",
  "ent",
  "sprite",
  "wal",
  "png",
  "jpg",
  "jpeg",
  "tga",
]);
const replacementPriority = new Map([
  ["jpeg", 0],
  ["jpg", 1],
  ["tga", 2],
  ["png", 3],
]);

export async function loadHostedEditorResources(
  projectId: string,
  game: MapsGameProfile,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<HostedEditorResources> {
  const mounts = await listHostedResources(projectId, fetcher, signal);
  const resources: Resource[] = [];
  const materialDiagnostics: string[] = [];
  const definitionDiagnostics: EntityDefinitionDiagnostic[] = [];
  const spriteDiagnostics: string[] = [];
  for (const mount of mounts) {
    if (
      !editorKinds.has(mount.kind) ||
      (["png", "jpg", "jpeg", "tga"].includes(mount.kind) &&
        !projectMaterialName(mount.displayName))
    )
      continue;
    signal?.throwIfAborted();
    try {
      const response = await fetcher(
        `/api/projects/${encodeURIComponent(projectId)}/resources/${encodeURIComponent(mount.id)}/content`,
        { credentials: "same-origin", signal },
      );
      if (!response.ok) throw new Error(`Download failed (${response.status})`);
      resources.push({
        name: mount.displayName,
        kind: mount.kind,
        bytes: await response.arrayBuffer(),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      materialDiagnostics.push(
        `${mount.displayName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  signal?.throwIfAborted();

  let palette: Uint8Array | undefined;
  for (const resource of resources.filter(({ kind }) => kind === "palette")) {
    try {
      const bytes = new Uint8Array(resource.bytes);
      palette = resource.name.toLowerCase().endsWith(".pcx")
        ? readPcxPalette(bytes)
        : bytes.byteLength >= 768
          ? bytes.slice(0, 768)
          : undefined;
      if (!palette) throw new Error("Palette needs at least 768 bytes");
    } catch (error) {
      materialDiagnostics.push(
        `${resource.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const catalog = new EditorMaterialCatalog();
  for (const material of developmentTexturePack(game, palette)?.materials ?? [])
    catalog.set(material);
  const profile = mapsGameProfile(game);
  for (const resource of resources.filter(({ kind }) => kind === "wad")) {
    try {
      const wad = parseWad(resource.bytes);
      if (!profile.wadVersions.includes(wad.version))
        throw new Error(
          `WAD${wad.version} is not supported by ${profile.label}`,
        );
      materialDiagnostics.push(
        ...wad.warnings.map(
          (warning) => `${resource.name}: ${warning.message}`,
        ),
      );
      const result = catalog.importWad(resource.name, resource.bytes, palette);
      materialDiagnostics.push(
        ...result.diagnostics.map(
          (diagnostic) => `${resource.name}: ${diagnostic.message}`,
        ),
      );
    } catch (error) {
      materialDiagnostics.push(
        `${resource.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const byPath = new Map(
    resources.map((resource) => [resource.name.toLowerCase(), resource]),
  );
  if (profile.materialFormat === "wal") {
    for (const resource of resources.filter(({ kind }) => kind === "wal")) {
      try {
        if (!palette) throw new Error("Quake II WAL textures need a palette");
        const result = catalog.importWal(
          resource.name,
          resource.bytes,
          palette,
        );
        materialDiagnostics.push(
          ...result.diagnostics.map(
            (diagnostic) => `${resource.name}: ${diagnostic.message}`,
          ),
        );
      } catch (error) {
        materialDiagnostics.push(
          `${resource.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  const replacements = new Map<string, Resource>();
  for (const resource of resources) {
    const name = projectMaterialName(resource.name);
    const extension = resource.name.split(".").at(-1)?.toLowerCase() ?? "";
    if (!name || !replacementPriority.has(extension)) continue;
    const previous = replacements.get(name);
    const previousExtension =
      previous?.name.split(".").at(-1)?.toLowerCase() ?? "";
    if (
      !previous ||
      (replacementPriority.get(extension) ?? -1) >
        (replacementPriority.get(previousExtension) ?? -1)
    )
      replacements.set(name, resource);
  }
  for (const [name, resource] of replacements) {
    signal?.throwIfAborted();
    try {
      const image = await decodeProjectMaterialImage(
        resource.name,
        resource.bytes,
      );
      const companion = byPath.get(`textures/${name}.wal`);
      const header = companion ? readWalTextureHeader(companion.bytes) : null;
      const original = catalog.find(name);
      catalog.set({
        name: header?.name ?? name,
        sourceName: resource.name,
        width: image.width,
        height: image.height,
        logicalWidth:
          header?.width ??
          original?.logicalWidth ??
          original?.width ??
          image.width,
        logicalHeight:
          header?.height ??
          original?.logicalHeight ??
          original?.height ??
          image.height,
        rgba: image.rgba,
        alphaTest: false,
      });
    } catch (error) {
      materialDiagnostics.push(
        `${resource.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const parsed: ParsedEntityDefinitionFile[] = [];
  const definitionNames = new Set(
    resources
      .filter(({ kind }) => ["fgd", "def", "ent"].includes(kind))
      .map(({ name }) => name.toLowerCase()),
  );
  for (const resource of resources.filter(({ kind }) =>
    ["fgd", "def", "ent"].includes(kind),
  )) {
    try {
      const result = parseEntityDefinitionFile(
        resource.kind as "fgd" | "def" | "ent",
        new TextDecoder().decode(resource.bytes),
        resource.name,
      );
      parsed.push(result);
      definitionDiagnostics.push(...result.diagnostics);
      const parent = resource.name.includes("/")
        ? resource.name.slice(0, resource.name.lastIndexOf("/") + 1)
        : "";
      for (const include of result.includes) {
        if (!definitionNames.has(`${parent}${include}`.toLowerCase())) {
          definitionDiagnostics.push({
            severity: "error",
            sourcePath: resource.name,
            message: `Missing FGD include ${include}`,
          });
        }
      }
    } catch (error) {
      definitionDiagnostics.push({
        severity: "error",
        sourcePath: resource.name,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const sprites: EditorSpriteMaterial[] = [];
  for (const resource of resources.filter(({ kind }) => kind === "sprite")) {
    try {
      const sprite = parseGoldSrcSprite(resource.bytes);
      const frame = sprite.frames[0]?.frames[0];
      if (!frame) throw new Error("Sprite has no displayable frame");
      sprites.push({
        path: resource.name,
        material: {
          name: `__tea_sprite__${resource.name.toLowerCase()}`,
          sourceName: resource.name,
          width: frame.width,
          height: frame.height,
          rgba: frame.rgba,
          alphaTest: true,
        },
      });
    } catch (error) {
      spriteDiagnostics.push(
        `${resource.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return {
    definitions: new EntityDefinitionCatalog(parsed),
    definitionDiagnostics,
    materials: catalog.materials(),
    materialDiagnostics,
    sprites,
    spriteDiagnostics,
  };
}
