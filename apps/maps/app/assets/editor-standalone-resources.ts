import { openDB, type DBSchema } from "idb";
import {
  developmentTexturePack,
  EditorMaterialCatalog,
  worldviewGameProfile,
  type EditorMaterial,
  type WorldviewGameProfile,
} from "@tea/maps-editor/core";
import { parseWad } from "@tea/maps-renderer/core";

export interface StandaloneWad {
  readonly name: string;
  readonly data: ArrayBuffer;
}

export interface StandaloneResources {
  readonly wads: readonly StandaloneWad[];
  readonly palette: Uint8Array | null;
}

interface StoredResources {
  wads: StandaloneWad[];
  palette: ArrayBuffer | null;
}

interface ResourceDatabase extends DBSchema {
  resources: { key: string; value: StoredResources };
}

const maxWadBytes = 16 * 1024 * 1024;
const maxTotalBytes = 20 * 1024 * 1024;

function database() {
  return openDB<ResourceDatabase>("tea-maps-standalone-resources", 1, {
    upgrade(connection) {
      connection.createObjectStore("resources");
    },
  });
}

function key(documentId: string, game: WorldviewGameProfile) {
  return `${documentId}:${game}`;
}

export function emptyStandaloneResources(): StandaloneResources {
  return { wads: [], palette: null };
}

export function validateStandaloneWad(
  name: string,
  data: ArrayBuffer,
  game: WorldviewGameProfile,
): void {
  if (!/\.wad$/i.test(name)) throw new Error(`${name} is not a WAD file`);
  if (data.byteLength > maxWadBytes)
    throw new Error(`${name} exceeds the 16 MiB WAD limit`);
  const wad = parseWad(data);
  if (!worldviewGameProfile(game).wadVersions.includes(wad.version))
    throw new Error(`${name} is WAD${wad.version}, which ${game} cannot use`);
  if (wad.warnings[0]) throw new Error(`${name}: ${wad.warnings[0].message}`);
}

export function addStandaloneWad(
  resources: StandaloneResources,
  wad: StandaloneWad,
  game: WorldviewGameProfile,
): StandaloneResources {
  validateStandaloneWad(wad.name, wad.data, game);
  const wads = [
    ...resources.wads.filter(
      (existing) => existing.name.toLowerCase() !== wad.name.toLowerCase(),
    ),
    wad,
  ];
  if (wads.length > 15) throw new Error("A map can import up to 15 WADs");
  if (
    wads.reduce((total, entry) => total + entry.data.byteLength, 0) >
    maxTotalBytes
  )
    throw new Error("Imported WADs exceed the 20 MiB map limit");
  standaloneMaterials({ wads, palette: resources.palette }, game);
  return { wads, palette: resources.palette };
}

export function setStandalonePalette(
  resources: StandaloneResources,
  palette: Uint8Array,
  game: WorldviewGameProfile,
): StandaloneResources {
  if (game !== "quake") throw new Error("Custom palettes require Quake");
  if (palette.byteLength !== 768)
    throw new Error(
      `A Quake palette needs 768 bytes; received ${palette.byteLength}`,
    );
  const next = { wads: resources.wads, palette: new Uint8Array(palette) };
  standaloneMaterials(next, game);
  return next;
}

export function standaloneMaterials(
  resources: StandaloneResources,
  game: WorldviewGameProfile,
): readonly EditorMaterial[] {
  const catalog = new EditorMaterialCatalog();
  for (const material of developmentTexturePack(
    game,
    resources.palette ?? undefined,
  )?.materials ?? [])
    catalog.set(material);
  for (const wad of resources.wads) {
    validateStandaloneWad(wad.name, wad.data, game);
    const result = catalog.importWad(
      wad.name,
      wad.data,
      resources.palette ?? undefined,
    );
    if (result.diagnostics[0])
      throw new Error(`${wad.name}: ${result.diagnostics[0].message}`);
  }
  return catalog.materials();
}

export async function loadStandaloneResources(
  documentId: string,
  game: WorldviewGameProfile,
): Promise<StandaloneResources> {
  const connection = await database();
  try {
    const stored = await connection.get("resources", key(documentId, game));
    if (!stored) return emptyStandaloneResources();
    const palette = stored.palette ? new Uint8Array(stored.palette) : null;
    const resources = { wads: stored.wads, palette };
    standaloneMaterials(resources, game);
    return resources;
  } finally {
    connection.close();
  }
}

export async function saveStandaloneResources(
  documentId: string,
  game: WorldviewGameProfile,
  resources: StandaloneResources,
): Promise<void> {
  const connection = await database();
  try {
    await connection.put(
      "resources",
      {
        wads: [...resources.wads],
        palette: resources.palette?.slice().buffer ?? null,
      },
      key(documentId, game),
    );
  } finally {
    connection.close();
  }
}

export async function saveStandaloneResourcesIfAbsent(
  documentId: string,
  game: WorldviewGameProfile,
  resources: StandaloneResources,
): Promise<boolean> {
  const connection = await database();
  try {
    const transaction = connection.transaction("resources", "readwrite");
    const store = transaction.objectStore("resources");
    if (await store.get(key(documentId, game))) {
      await transaction.done;
      return false;
    }
    await store.add(
      {
        wads: [...resources.wads],
        palette: resources.palette?.slice().buffer ?? null,
      },
      key(documentId, game),
    );
    await transaction.done;
    return true;
  } finally {
    connection.close();
  }
}
