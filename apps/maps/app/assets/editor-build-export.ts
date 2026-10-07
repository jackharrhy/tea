import {
  entityValue,
  normalizeGameAssetPath,
  parseBsp,
  parseWad,
  planWorldAssets,
} from "@tea/maps-renderer/core";
import type { MapCompileInputAsset } from "@tea/maps-editor/core";
import type { WorldSource } from "@tea/maps-renderer";
import type { MapDirectoryHandle, MapProject } from "./editor-project.ts";

export interface BuildExportInput {
  readonly name: string;
  readonly bsp: ArrayBuffer;
  readonly source: string;
  readonly wads: readonly MapCompileInputAsset[];
  readonly gameAssets: ReadonlyMap<string, ArrayBuffer>;
  readonly project: MapProject | null;
}

export interface BuildExportFile {
  readonly name: string;
  readonly data: ArrayBuffer;
  readonly mediaType: string;
}

function safePath(path: string): string {
  const normalized = normalizeGameAssetPath(path);
  if (
    normalized.includes(":") ||
    [...normalized].some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new Error(`Unsafe export path: ${path}`);
  }
  return normalized;
}

function modelString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return new TextDecoder().decode(
    bytes.subarray(0, end < 0 ? bytes.length : end),
  );
}

export function modelAssetPaths(path: string, data: ArrayBuffer): string[] {
  const bytes = new Uint8Array(data);
  if (bytes.length < 8) throw new Error(`Invalid model ${path}`);
  const signature = modelString(bytes.subarray(0, 4));
  const view = new DataView(data);
  const version = view.getInt32(4, true);
  if (signature === "IDPO" && version === 6 && path.endsWith(".mdl")) {
    if (bytes.length < 84) throw new Error(`Invalid model ${path}`);
    return [];
  }
  if (signature === "IDST" && version === 10 && path.endsWith(".mdl")) {
    if (bytes.length < 244) throw new Error(`Invalid model ${path}`);
    const count = view.getInt32(172, true);
    if (count < 0 || count > 16) throw new Error(`Invalid model ${path}`);
    const assets = new Set<string>();
    if (view.getInt32(180, true) === 0) {
      assets.add(safePath(path.replace(/\.mdl$/i, "T.mdl")));
    }
    for (let index = 1; index < count; index += 1) {
      assets.add(
        safePath(
          path.replace(/\.mdl$/i, `${String(index).padStart(2, "0")}.mdl`),
        ),
      );
    }
    return [...assets];
  }
  if (signature !== "IDP2" && signature !== "IDS2") {
    throw new Error(`Unsupported model ${path}`);
  }
  const sprite = signature === "IDS2";
  if (!path.endsWith(sprite ? ".sp2" : ".md2")) {
    throw new Error(`Unsupported model ${path}`);
  }
  if (version !== (sprite ? 2 : 8) || bytes.length < (sprite ? 12 : 68)) {
    throw new Error(`Unsupported model ${path}`);
  }
  const count = view.getInt32(sprite ? 8 : 20, true);
  const offset = sprite ? 12 : view.getInt32(44, true);
  const stride = sprite ? 80 : 64;
  const end = sprite ? bytes.length : view.getInt32(64, true);
  if (
    count < 0 ||
    count > 4096 ||
    offset < (sprite ? 12 : 68) ||
    end < offset ||
    end > bytes.length ||
    count * stride > end - offset
  ) {
    throw new Error(`Invalid model ${path}`);
  }
  const assets = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const start = offset + index * stride + (sprite ? 16 : 0);
    const name = modelString(bytes.subarray(start, start + 64));
    if (!name) throw new Error(`Invalid model asset in ${path}`);
    assets.add(safePath(name));
  }
  return [...assets];
}

async function matchingEntry(directory: MapDirectoryHandle, name: string) {
  for await (const [entryName, entry] of directory.entries()) {
    if (entryName.toLowerCase() === name.toLowerCase()) return entry;
  }
  return null;
}

async function fileAt(
  directory: MapDirectoryHandle,
  path: string,
): Promise<File | null> {
  const parts = path.split("/");
  let current = directory;
  for (const part of parts.slice(0, -1)) {
    const entry = await matchingEntry(current, part);
    if (!entry || entry.kind !== "directory") return null;
    current = entry;
  }
  const entry = await matchingEntry(current, parts.at(-1)!);
  return entry?.kind === "file" ? entry.getFile() : null;
}

async function projectAsset(
  project: MapProject | null,
  path: string,
): Promise<ArrayBuffer | null> {
  if (!project) return null;
  const roots = project.manifest.resources.gameRoots ?? [];
  const spriteRoots = path.startsWith("sprites/")
    ? project.manifest.resources.spriteRoots.map((root) =>
        root.toLowerCase() === "sprites" ||
        root.toLowerCase().endsWith("/sprites")
          ? `${root}/${path.slice("sprites/".length)}`
          : root === "."
            ? path
            : `${root}/${path}`,
      )
    : [];
  const candidates = [
    ...spriteRoots.toReversed(),
    ...roots
      .toReversed()
      .map((root) => (root === "." ? path : `${root}/${path}`)),
  ];
  for (const candidate of candidates) {
    const file = await fileAt(project.handle, candidate);
    if (file) return file.arrayBuffer();
  }
  return null;
}

export async function buildExportEntries(
  input: BuildExportInput,
  includeSource: boolean,
): Promise<{ stem: string; files: Map<string, ArrayBuffer> }> {
  const world = parseBsp(input.bsp);
  const plan = planWorldAssets(world, { includeViewerDefaults: false });
  const stem =
    input.name
      .replace(/\.map$/i, "")
      .replace(/[^A-Za-z0-9_-]/g, "_")
      .toLowerCase() || "map";
  const files = new Map<string, ArrayBuffer>([[`maps/${stem}.bsp`, input.bsp]]);
  const knownAssets = new Map(
    [...input.gameAssets].map(([path, data]) => [safePath(path), data]),
  );
  const add = (path: string, data: ArrayBuffer) => {
    const name = safePath(path);
    if (files.has(name)) throw new Error(`Duplicate export path: ${name}`);
    files.set(name, data);
  };
  const findAsset = async (path: string): Promise<ArrayBuffer | null> => {
    const name = safePath(path);
    const cached = knownAssets.get(name);
    if (cached) return cached;
    const data = await projectAsset(input.project, name);
    if (data) knownAssets.set(name, data);
    return data;
  };
  const requireAsset = async (path: string) => {
    const name = safePath(path);
    if (files.has(name)) return files.get(name)!;
    const data = await findAsset(name);
    if (!data) {
      throw new Error(`Export needs ${name}. Add it to the project resources.`);
    }
    add(name, data);
    return data;
  };
  const candidate = async (paths: readonly string[], required = true) => {
    for (const path of paths) {
      const data = await findAsset(path);
      if (data) {
        if (!files.has(safePath(path))) add(path, data);
        return;
      }
    }
    if (required && paths[0]) await requireAsset(paths[0]);
  };

  const external = world.materials.filter(
    (material) => material.kind !== "tool" && !material.embeddedTexture,
  );
  if (external.length) {
    if (world.version === 38) {
      for (const texture of plan.textures) {
        await candidate(texture.walCandidates);
        await candidate(texture.imageCandidates, false);
      }
    } else {
      if (world.version !== 30) {
        throw new Error(
          "The Quake BSP has missing textures. Rebuild with its WADs.",
        );
      }
      const requiredWads = world.wadReferences.map((reference) => {
        const wad = input.wads.find(
          ({ name }) => name.toLowerCase() === reference.basename,
        );
        if (!wad)
          throw new Error(
            `Export needs ${reference.basename}. Rebuild with its WAD.`,
          );
        return wad;
      });
      const textures = new Set(
        requiredWads.flatMap(({ data }) =>
          parseWad(data).lumps.flatMap((lump) =>
            lump.mipTexture ? [lump.mipTexture.name.toLowerCase()] : [],
          ),
        ),
      );
      for (const material of external) {
        if (!textures.has(material.name.toLowerCase())) {
          throw new Error(
            `Export needs texture ${material.name}. Rebuild with its WAD.`,
          );
        }
      }
      for (const wad of requiredWads) {
        if (!files.has(safePath(wad.name))) add(wad.name, wad.data);
      }
      if (!world.wadReferences.length) {
        throw new Error("The BSP has external textures but no WAD references.");
      }
    }
  }
  for (const asset of [
    ...plan.sounds,
    ...plan.sprites,
    ...(plan.skybox?.faces ?? []),
  ]) {
    await candidate(asset.candidates);
  }
  for (const entity of world.entities) {
    for (const key of ["model", "noise", "noise1", "noise2", "noise3"]) {
      const value = entityValue(entity, key);
      if (
        !value ||
        value.startsWith("*") ||
        !/\.(mdl|md2|spr|sp2|wav|ogg|mp3)$/i.test(value)
      ) {
        continue;
      }
      if (/\.(mdl|md2|sp2)$/i.test(value)) {
        const path = safePath(value);
        const data = await requireAsset(path);
        for (const asset of modelAssetPaths(path, data))
          await requireAsset(asset);
        continue;
      }
      await requireAsset(
        /\.(wav|ogg|mp3)$/i.test(value) && !value.startsWith("sound/")
          ? `sound/${value}`
          : value,
      );
    }
  }
  if (includeSource) {
    add(`maps/${stem}.map`, new TextEncoder().encode(input.source).buffer);
    for (const wad of input.wads) {
      if (!files.has(safePath(wad.name))) add(wad.name, wad.data);
    }
  }
  return { stem, files };
}

export async function prepareBuildExport(
  input: BuildExportInput,
): Promise<BuildExportInput> {
  const { files } = await buildExportEntries(input, false);
  const gameAssets = new Map(input.gameAssets);
  for (const [path, data] of files) {
    if (!path.startsWith("maps/") && !path.endsWith(".wad")) {
      gameAssets.set(path, data);
    }
  }
  return { ...input, gameAssets, project: null };
}

export function previewSourceWithExportAssets(
  source: WorldSource,
  prepared: BuildExportInput,
): WorldSource {
  return {
    ...source,
    gameAssets: {
      ...source.gameAssets,
      ...Object.fromEntries(prepared.gameAssets),
    },
  };
}

export async function packageBuildExport(
  input: BuildExportInput,
  includeSource: boolean,
): Promise<BuildExportFile> {
  const { stem, files } = await buildExportEntries(input, includeSource);
  if (files.size === 1) {
    return {
      name: `${stem}.bsp`,
      data: input.bsp,
      mediaType: "application/x-quake-bsp",
    };
  }
  const { zip } = await import("fflate");
  const data = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    zip(
      Object.fromEntries(
        [...files].map(([path, bytes]) => [path, new Uint8Array(bytes)]),
      ),
      { level: 0 },
      (error, result) => (error ? reject(error) : resolve(result)),
    );
  });
  return {
    name: `${stem}.zip`,
    data: data.buffer,
    mediaType: "application/zip",
  };
}

export function downloadBuildFile(file: BuildExportFile): void {
  const url = URL.createObjectURL(
    new Blob([file.data], { type: file.mediaType }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
