import { openDB, type DBSchema } from "idb";
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

export async function importLegacyDetachedMaps(): Promise<{
  imported: number;
  existing: number;
}> {
  const copies = await legacyDetachedMaps();
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
