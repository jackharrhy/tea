import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";

import type {
  DetachedHostedMap,
  StoredCollaborationOperation,
  StoredCollaborationSession,
} from "./editor-collaboration-outbox.ts";

export const EDITOR_STORES = {
  collaborationOperations: "collaboration-operations",
  collaborationSessions: "collaboration-sessions",
  detachedMaps: "detached-maps",
} as const;

interface CollaborationDatabaseSchema extends DBSchema {
  "collaboration-operations": {
    key: string;
    value: StoredCollaborationOperation;
    indexes: { mapId: string };
  };
  "collaboration-sessions": {
    key: string;
    value: StoredCollaborationSession;
  };
  "detached-maps": {
    key: string;
    value: DetachedHostedMap;
    indexes: { originalMapId: string; createdAt: number };
  };
}

type CollaborationDatabase = IDBPDatabase<CollaborationDatabaseSchema>;
let databasePromise: Promise<CollaborationDatabase> | null = null;

export function openEditorDatabase(): Promise<CollaborationDatabase> {
  if (!globalThis.indexedDB)
    return Promise.reject(new Error("IndexedDB is unavailable"));
  databasePromise ??= openDB<CollaborationDatabaseSchema>(
    "tea-maps-collaboration",
    1,
    {
      upgrade(database) {
        const operations = database.createObjectStore(
          EDITOR_STORES.collaborationOperations,
          { keyPath: "key" },
        );
        operations.createIndex("mapId", "mapId");
        database.createObjectStore(EDITOR_STORES.collaborationSessions, {
          keyPath: "mapId",
        });
        const detached = database.createObjectStore(
          EDITOR_STORES.detachedMaps,
          {
            keyPath: "id",
          },
        );
        detached.createIndex("originalMapId", "originalMapId");
        detached.createIndex("createdAt", "createdAt");
      },
      blocking() {
        databasePromise?.then((database) => database.close());
        databasePromise = null;
      },
    },
  ).catch((error: unknown) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
}

export async function closeEditorDatabase(): Promise<void> {
  const pending = databasePromise;
  databasePromise = null;
  (await pending?.catch(() => null))?.close();
}

export async function deleteEditorDatabase(): Promise<void> {
  await closeEditorDatabase();
  if (globalThis.indexedDB) await deleteDB("tea-maps-collaboration");
}

export async function completeEditorTransaction<Result>(
  transaction: { readonly done: Promise<unknown>; abort(): void },
  work: Promise<Result>,
): Promise<Result> {
  try {
    const [result] = await Promise.all([work, transaction.done]);
    return result;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // The transaction may have already settled.
    }
    throw error;
  }
}
