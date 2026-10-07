import { openDB, type DBSchema } from "idb";
import { z } from "zod";
import { MapDocumentSchema, MapSourceStateSchema } from "@tea/maps-editor/core";
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
  "recovery-history": { key: string; value: LegacyRecoverySnapshot };
  "recovery-latest": { key: string; value: LegacyRecoverySnapshot };
}

export const LegacyRecoverySnapshotSchema = z.strictObject({
  version: z.literal(1),
  snapshotId: z.string().min(1).max(4_096),
  documentKey: z.string().min(1).max(4_096),
  fileName: z.string().min(1).max(4_096),
  document: MapDocumentSchema,
  source: MapSourceStateSchema,
  savedDocumentRevision: z.number().int().min(-1),
  updatedAt: z.number().int().nonnegative(),
  label: z.string().max(4_096),
  protected: z.boolean(),
});
export type LegacyRecoverySnapshot = z.infer<
  typeof LegacyRecoverySnapshotSchema
>;

interface TeaRecoveryDatabase extends DBSchema {
  snapshots: { key: string; value: LegacyRecoverySnapshot };
}

const DetachedArchiveV1Schema = z.strictObject({
  kind: z.literal("tea-maps-worldview-detached"),
  version: z.literal(1),
  copies: z.array(DetachedHostedMapSchema),
});
const LocalArchiveV2Schema = z.strictObject({
  kind: z.literal("tea-maps-worldview-local"),
  version: z.literal(2),
  copies: z.array(DetachedHostedMapSchema),
  recovery: z.array(LegacyRecoverySnapshotSchema),
});
const MAX_ARCHIVE_BYTES = 128 * 1_024 * 1_024;

function recoveryDatabase() {
  return openDB<TeaRecoveryDatabase>("tea-maps-worldview-recovery", 1, {
    upgrade(database) {
      database.createObjectStore("snapshots", { keyPath: "snapshotId" });
    },
  });
}

async function legacyLocalData(): Promise<{
  copies: readonly DetachedHostedMap[];
  recovery: readonly LegacyRecoverySnapshot[];
}> {
  const empty = { copies: [], recovery: [] };
  if (!indexedDB.databases) return empty;
  const databases = await indexedDB.databases();
  if (!databases.some((database) => database.name === "worldview-editor"))
    return empty;
  const legacy = await openDB<LegacyEditorDatabase>("worldview-editor");
  try {
    const [copies, history, latest]: unknown[][] = await Promise.all([
      legacy.objectStoreNames.contains("detached-maps")
        ? legacy.getAll("detached-maps")
        : [],
      legacy.objectStoreNames.contains("recovery-history")
        ? legacy.getAll("recovery-history")
        : [],
      legacy.objectStoreNames.contains("recovery-latest")
        ? legacy.getAll("recovery-latest")
        : [],
    ]);
    const recovery = new Map(
      [...latest, ...history].map((value) => {
        const snapshot = LegacyRecoverySnapshotSchema.parse(value);
        return [snapshot.snapshotId, snapshot] as const;
      }),
    );
    return {
      copies: copies.map((value) => DetachedHostedMapSchema.parse(value)),
      recovery: [...recovery.values()],
    };
  } finally {
    legacy.close();
  }
}

export async function countLegacyLocalData(): Promise<{
  copies: number;
  recovery: number;
}> {
  const data = await legacyLocalData();
  return { copies: data.copies.length, recovery: data.recovery.length };
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

async function importRecovery(recovery: readonly LegacyRecoverySnapshot[]) {
  if (!recovery.length) return { imported: 0, existing: 0 };
  const database = await recoveryDatabase();
  try {
    const transaction = database.transaction("snapshots", "readwrite");
    const store = transaction.objectStore("snapshots");
    let imported = 0;
    let existing = 0;
    for (const snapshot of recovery) {
      if (await store.get(snapshot.snapshotId)) {
        existing++;
      } else {
        await store.add(snapshot);
        imported++;
      }
    }
    await transaction.done;
    return { imported, existing };
  } finally {
    database.close();
  }
}

async function importLocalData(data: {
  copies: readonly DetachedHostedMap[];
  recovery: readonly LegacyRecoverySnapshot[];
}) {
  const copies = await importCopies(data.copies);
  const recovery = await importRecovery(data.recovery);
  return { copies, recovery };
}

export async function importLegacyLocalData() {
  return importLocalData(await legacyLocalData());
}

export async function exportLegacyLocalArchive(): Promise<Blob> {
  const data = await legacyLocalData();
  const archive = new Blob(
    [
      JSON.stringify({
        kind: "tea-maps-worldview-local",
        version: 2,
        ...data,
      }),
    ],
    { type: "application/json" },
  );
  if (archive.size > MAX_ARCHIVE_BYTES)
    throw new Error("Worldview copy archive exceeds 128 MiB");
  return archive;
}

export async function importLegacyLocalArchive(file: File) {
  if (file.size > MAX_ARCHIVE_BYTES)
    throw new Error("Worldview copy archive exceeds 128 MiB");
  const value: unknown = JSON.parse(await file.text());
  const v1 = DetachedArchiveV1Schema.safeParse(value);
  const data = v1.success
    ? { copies: v1.data.copies, recovery: [] }
    : LocalArchiveV2Schema.parse(value);
  return importLocalData(data);
}

export async function listImportedLegacyRecovery(): Promise<
  readonly LegacyRecoverySnapshot[]
> {
  const database = await recoveryDatabase();
  try {
    const values: unknown[] = await database.getAll("snapshots");
    return values
      .map((value) => LegacyRecoverySnapshotSchema.parse(value))
      .toSorted((left, right) => right.updatedAt - left.updatedAt);
  } finally {
    database.close();
  }
}

export async function loadImportedLegacyRecovery(
  id: string,
): Promise<LegacyRecoverySnapshot | null> {
  const database = await recoveryDatabase();
  try {
    const value: unknown = await database.get("snapshots", id);
    return value ? LegacyRecoverySnapshotSchema.parse(value) : null;
  } finally {
    database.close();
  }
}
