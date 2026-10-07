import {
  WorldviewGameProfileSchema,
  type WorldviewGameProfile,
} from "@tea/maps-editor/core";
import { openDB, type DBSchema } from "idb";
import { z } from "zod";
import {
  addStandaloneWad,
  emptyStandaloneResources,
  saveStandaloneResourcesIfAbsent,
  setStandalonePalette,
} from "./editor-standalone-resources.ts";

const MountFields = {
  id: z.string().min(1).max(4_096),
  scopeId: z.string().min(1).max(4_096),
  label: z.string().min(1).max(4_096),
  priority: z.number().int(),
  profile: WorldviewGameProfileSchema,
  sourceName: z.string().min(1).max(4_096),
  contentFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
};

export const LegacyBrowserMountSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...MountFields,
    kind: z.literal("browser-wad"),
    data: z.instanceof(ArrayBuffer),
  }),
  z.strictObject({
    ...MountFields,
    kind: z.literal("browser-palette"),
    data: z.instanceof(ArrayBuffer).refine((data) => data.byteLength === 768),
  }),
]);
export type LegacyBrowserMount = z.infer<typeof LegacyBrowserMountSchema>;

export const PortableLegacyMountSchema = z.strictObject({
  ...MountFields,
  kind: z.enum(["browser-wad", "browser-palette"]),
  dataBase64: z.string(),
});
export type PortableLegacyMount = z.infer<typeof PortableLegacyMountSchema>;

interface WorldviewMountDatabase extends DBSchema {
  "asset-mounts": { key: string; value: unknown };
}

interface TeaMountDatabase extends DBSchema {
  mounts: { key: string; value: LegacyBrowserMount };
}

function mountDatabase() {
  return openDB<TeaMountDatabase>("tea-maps-worldview-mounts", 1, {
    upgrade(database) {
      database.createObjectStore("mounts", { keyPath: "id" });
    },
  });
}

function base64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32_766)
    chunks.push(
      btoa(String.fromCharCode(...bytes.subarray(offset, offset + 32_766))),
    );
  return chunks.join("");
}

function unbase64(value: string): ArrayBuffer {
  const text = atob(value);
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++)
    bytes[index] = text.charCodeAt(index);
  return bytes.buffer;
}

async function validatedMount(value: unknown): Promise<LegacyBrowserMount> {
  const mount = LegacyBrowserMountSchema.parse(value);
  const digest = await crypto.subtle.digest("SHA-256", mount.data);
  const fingerprint = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (fingerprint !== mount.contentFingerprint)
    throw new Error(`Worldview resource ${mount.sourceName} has changed bytes`);
  return mount;
}

export async function readLegacyBrowserMounts(): Promise<
  readonly LegacyBrowserMount[]
> {
  if (!indexedDB.databases) return [];
  const databases = await indexedDB.databases();
  if (!databases.some((database) => database.name === "worldview-editor"))
    return [];
  const legacy = await openDB<WorldviewMountDatabase>("worldview-editor");
  try {
    if (!legacy.objectStoreNames.contains("asset-mounts")) return [];
    const values: unknown[] = await legacy.getAll("asset-mounts");
    return Promise.all(
      values
        .filter(
          (value): value is Record<string, unknown> =>
            !!value && typeof value === "object",
        )
        .filter(
          (value) =>
            value.kind === "browser-wad" || value.kind === "browser-palette",
        )
        .map(validatedMount),
    );
  } finally {
    legacy.close();
  }
}

export async function toPortableLegacyMount(
  mount: LegacyBrowserMount,
): Promise<PortableLegacyMount> {
  await validatedMount(mount);
  const { data, ...fields } = mount;
  return { ...fields, dataBase64: base64(data) };
}

export async function fromPortableLegacyMount(
  value: PortableLegacyMount,
): Promise<LegacyBrowserMount> {
  const { dataBase64, ...fields } = value;
  return validatedMount({ ...fields, data: unbase64(dataBase64) });
}

export async function importLegacyBrowserMounts(
  mounts: readonly LegacyBrowserMount[],
): Promise<{ imported: number; existing: number }> {
  if (!mounts.length) return { imported: 0, existing: 0 };
  const validated = await Promise.all(mounts.map(validatedMount));
  const database = await mountDatabase();
  try {
    const transaction = database.transaction("mounts", "readwrite");
    const store = transaction.objectStore("mounts");
    let imported = 0;
    let existing = 0;
    for (const mount of validated) {
      if (await store.get(mount.id)) {
        existing++;
      } else {
        await store.add(mount);
        imported++;
      }
    }
    await transaction.done;
    return { imported, existing };
  } finally {
    database.close();
  }
}

export async function installLegacyRecoveryResources(
  scopeId: string,
  documentId: string,
  game: WorldviewGameProfile,
): Promise<boolean> {
  const database = await mountDatabase();
  let mounts: LegacyBrowserMount[];
  try {
    const values: unknown[] = await database.getAll("mounts");
    mounts = values
      .map((value) => LegacyBrowserMountSchema.parse(value))
      .filter((mount) => mount.scopeId === scopeId && mount.profile === game)
      .toSorted((left, right) => left.priority - right.priority);
  } finally {
    database.close();
  }
  if (!mounts.length) return false;
  let resources = emptyStandaloneResources();
  const palette = mounts.find((mount) => mount.kind === "browser-palette");
  if (palette)
    resources = setStandalonePalette(
      resources,
      new Uint8Array(palette.data),
      game,
    );
  for (const mount of mounts)
    if (mount.kind === "browser-wad")
      resources = addStandaloneWad(
        resources,
        { name: mount.sourceName, data: mount.data },
        game,
      );
  return saveStandaloneResourcesIfAbsent(documentId, game, resources);
}
