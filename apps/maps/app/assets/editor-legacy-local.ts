import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { z } from "zod";
import { MapDocumentSchema, MapSourceStateSchema } from "@tea/maps-editor/core";
import {
  DetachedHostedMapSchema,
  StoredOperationSchema,
  StoredSessionSchema,
  type DetachedHostedMap,
  type StoredCollaborationOperation,
  type StoredCollaborationSession,
} from "./editor-collaboration-outbox.ts";
import {
  EDITOR_STORES,
  openEditorDatabase,
} from "./editor-collaboration-database.ts";
import {
  importRecentProjects,
  type RecentProject,
} from "./editor-recent-projects.ts";
import type { MapDirectoryHandle } from "./editor-project.ts";
import {
  fromPortableLegacyMount,
  importLegacyBrowserMounts,
  PortableLegacyMountSchema,
  readLegacyBrowserMounts,
  toPortableLegacyMount,
  type LegacyBrowserMount,
} from "./editor-legacy-mounts.ts";

interface LegacyEditorDatabase extends DBSchema {
  "detached-maps": { key: string; value: DetachedHostedMap };
  "recovery-history": { key: string; value: LegacyRecoverySnapshot };
  "recovery-latest": { key: string; value: LegacyRecoverySnapshot };
  "local-projects": { key: string; value: LegacyLocalProject };
  "collaboration-operations": {
    key: string;
    value: StoredCollaborationOperation;
  };
  "collaboration-sessions": {
    key: string;
    value: StoredCollaborationSession;
  };
}

interface LegacyLocalProject {
  version: 2;
  workspaceId: string;
  projectKey: string;
  displayName: string;
  handle: MapDirectoryHandle;
  buildBindings: Readonly<Record<string, string>>;
  lastMapPath?: string;
  updatedAt: number;
}

const LegacyLocalProjectSchema = z.strictObject({
  version: z.literal(2),
  workspaceId: z.string().min(1).max(256),
  projectKey: z.string().min(1).max(4_096),
  displayName: z.string().min(1).max(4_096),
  handle: z.custom<MapDirectoryHandle>(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      "kind" in value &&
      value.kind === "directory" &&
      "name" in value &&
      typeof value.name === "string",
  ),
  buildBindings: z.record(z.string().max(256), z.string().max(256)),
  lastMapPath: z.string().min(1).max(4_096).optional(),
  updatedAt: z.number().int().nonnegative(),
});

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
const LocalArchiveV3Schema = z.strictObject({
  kind: z.literal("tea-maps-worldview-local"),
  version: z.literal(3),
  copies: z.array(DetachedHostedMapSchema),
  recovery: z.array(LegacyRecoverySnapshotSchema),
  mounts: z.array(PortableLegacyMountSchema),
});
const MAX_ARCHIVE_BYTES = 128 * 1_024 * 1_024;

function recoveryDatabase() {
  return openDB<TeaRecoveryDatabase>("tea-maps-worldview-recovery", 1, {
    upgrade(database) {
      database.createObjectStore("snapshots", { keyPath: "snapshotId" });
    },
  });
}

async function legacyLocalProjects(): Promise<readonly RecentProject[]> {
  if (!indexedDB.databases) return [];
  const databases = await indexedDB.databases();
  if (!databases.some((database) => database.name === "worldview-editor"))
    return [];
  const legacy = await openDB<LegacyEditorDatabase>("worldview-editor");
  try {
    if (!legacy.objectStoreNames.contains("local-projects")) return [];
    const values: unknown[] = await legacy.getAll("local-projects");
    return values.flatMap((value) => {
      const parsed = LegacyLocalProjectSchema.safeParse(value);
      if (!parsed.success) return [];
      const project = parsed.data;
      return [
        {
          id: project.workspaceId,
          name: project.displayName,
          handle: project.handle,
          ...(project.lastMapPath ? { lastMapPath: project.lastMapPath } : {}),
          updatedAt: project.updatedAt,
        },
      ];
    });
  } finally {
    legacy.close();
  }
}

export async function countLegacyLocalProjects(): Promise<number> {
  return (await legacyLocalProjects()).length;
}

export async function importLegacyLocalProjects() {
  return importRecentProjects(await legacyLocalProjects());
}

async function pendingHostedCopies(
  legacy: IDBPDatabase<LegacyEditorDatabase>,
): Promise<readonly DetachedHostedMap[]> {
  if (!legacy.objectStoreNames.contains("collaboration-operations")) return [];
  if (!legacy.objectStoreNames.contains("collaboration-sessions"))
    throw new Error("Worldview hosted edits have no session records");
  const transaction = legacy.transaction(
    ["collaboration-operations", "collaboration-sessions"],
    "readonly",
  );
  const [operationValues, sessionValues]: unknown[][] = await Promise.all([
    transaction.objectStore("collaboration-operations").getAll(),
    transaction.objectStore("collaboration-sessions").getAll(),
  ]);
  await transaction.done;
  const operations = operationValues.map((value) =>
    StoredOperationSchema.parse(value),
  );
  const sessions = new Map(
    sessionValues.map((value) => {
      const session = StoredSessionSchema.parse(value);
      return [session.mapId, session] as const;
    }),
  );
  const byMap = Map.groupBy(operations, (operation) => operation.mapId);
  return Promise.all(
    [...byMap].map(async ([mapId, pending]) => {
      const session = sessions.get(mapId);
      const recovery = session?.recovery;
      if (!recovery || recovery.mapId !== mapId)
        throw new Error(
          `Worldview has unsynced edits for ${mapId} without a recovery snapshot; reopen that map in Worldview before importing`,
        );
      const encodedBytes = pending.reduce(
        (total, operation) => total + operation.encodedBytes,
        0,
      );
      if (encodedBytes <= 0)
        throw new Error(`Worldview has invalid unsynced edits for ${mapId}`);
      const keys = pending.map((operation) => operation.key).toSorted();
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(keys)),
      );
      const id = `worldview-pending:${[...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")}`;
      return DetachedHostedMapSchema.parse({
        version: 1,
        id,
        originalMapId: mapId,
        documentKey: `detached-hosted:${id}`,
        fileName: recovery.fileName,
        profile: recovery.profile,
        document: recovery.document,
        source: recovery.source,
        originalMapVersion: session.mapVersion,
        createdAt: recovery.updatedAt,
        reason: "Unsynced Worldview hosted edits imported as a local copy",
        operationCount: pending.length,
        encodedBytes,
      });
    }),
  );
}

async function legacyLocalData(): Promise<{
  copies: readonly DetachedHostedMap[];
  recovery: readonly LegacyRecoverySnapshot[];
  mounts: readonly LegacyBrowserMount[];
}> {
  const empty = { copies: [], recovery: [], mounts: [] };
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
    const pending = await pendingHostedCopies(legacy);
    const mounts = await readLegacyBrowserMounts();
    return {
      copies: [
        ...copies.map((value) => DetachedHostedMapSchema.parse(value)),
        ...pending,
      ],
      recovery: [...recovery.values()],
      mounts,
    };
  } finally {
    legacy.close();
  }
}

export async function countLegacyLocalData(): Promise<{
  copies: number;
  recovery: number;
  mounts: number;
}> {
  const data = await legacyLocalData();
  return {
    copies: data.copies.length,
    recovery: data.recovery.length,
    mounts: data.mounts.length,
  };
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
  mounts: readonly LegacyBrowserMount[];
}) {
  const copies = await importCopies(data.copies);
  const recovery = await importRecovery(data.recovery);
  const mounts = await importLegacyBrowserMounts(data.mounts);
  return { copies, recovery, mounts };
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
        version: 3,
        copies: data.copies,
        recovery: data.recovery,
        mounts: await Promise.all(data.mounts.map(toPortableLegacyMount)),
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
  if (v1.success)
    return importLocalData({
      copies: v1.data.copies,
      recovery: [],
      mounts: [],
    });
  const v2 = LocalArchiveV2Schema.safeParse(value);
  if (v2.success) return importLocalData({ ...v2.data, mounts: [] });
  const v3 = LocalArchiveV3Schema.parse(value);
  return importLocalData({
    copies: v3.copies,
    recovery: v3.recovery,
    mounts: await Promise.all(v3.mounts.map(fromPortableLegacyMount)),
  });
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
