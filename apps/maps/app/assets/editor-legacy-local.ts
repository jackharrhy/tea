import { openDB, type DBSchema } from "idb";
import { z } from "zod";
import {
  DetachedHostedMapSchema,
  type DetachedHostedMap,
} from "./editor-collaboration-outbox.ts";
import {
  EDITOR_STORES,
  openEditorDatabase,
} from "./editor-collaboration-database.ts";

interface LegacyEditorDatabase extends DBSchema {
  "detached-maps": { key: string; value: DetachedHostedMap };
}

const DetachedArchiveSchema = z.strictObject({
  kind: z.literal("tea-maps-worldview-detached"),
  version: z.literal(1),
  copies: z.array(DetachedHostedMapSchema),
});
const MAX_ARCHIVE_BYTES = 128 * 1_024 * 1_024;

async function legacyDetachedMaps(): Promise<readonly DetachedHostedMap[]> {
  if (!indexedDB.databases) return [];
  const databases = await indexedDB.databases();
  if (!databases.some((database) => database.name === "worldview-editor"))
    return [];
  const legacy = await openDB<LegacyEditorDatabase>("worldview-editor");
  try {
    if (!legacy.objectStoreNames.contains("detached-maps")) return [];
    const values: unknown[] = await legacy.getAll("detached-maps");
    return values.map((value) => DetachedHostedMapSchema.parse(value));
  } finally {
    legacy.close();
  }
}

export async function countLegacyDetachedMaps(): Promise<number> {
  return (await legacyDetachedMaps()).length;
}

async function importCopies(copies: readonly DetachedHostedMap[]): Promise<{
  imported: number;
  existing: number;
}> {
  if (!copies.length) return { imported: 0, existing: 0 };
  const destination = await openEditorDatabase();
  const transaction = destination.transaction(
    EDITOR_STORES.detachedMaps,
    "readwrite",
  );
  const store = transaction.objectStore(EDITOR_STORES.detachedMaps);
  let imported = 0;
  let existing = 0;
  try {
    for (const copy of copies) {
      if (await store.get(copy.id)) {
        existing++;
      } else {
        await store.add(copy);
        imported++;
      }
    }
    await transaction.done;
  } catch (cause) {
    try {
      transaction.abort();
    } catch {
      // The transaction may already have settled.
    }
    throw cause;
  }
  return { imported, existing };
}

export async function importLegacyDetachedMaps() {
  return importCopies(await legacyDetachedMaps());
}

export async function exportLegacyDetachedMaps(): Promise<Blob> {
  const copies = await legacyDetachedMaps();
  const archive = new Blob(
    [
      JSON.stringify({
        kind: "tea-maps-worldview-detached",
        version: 1,
        copies,
      }),
    ],
    { type: "application/json" },
  );
  if (archive.size > MAX_ARCHIVE_BYTES)
    throw new Error("Worldview copy archive exceeds 128 MiB");
  return archive;
}

export async function importDetachedArchive(file: File) {
  if (file.size > MAX_ARCHIVE_BYTES)
    throw new Error("Worldview copy archive exceeds 128 MiB");
  const parsed = DetachedArchiveSchema.parse(JSON.parse(await file.text()));
  return importCopies(parsed.copies);
}
