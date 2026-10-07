import { openDB, type DBSchema } from "idb";

export interface ProjectDirectoryIdentity {
  readonly kind: "directory";
  readonly name: string;
  isSameEntry?(other: ProjectDirectoryIdentity): Promise<boolean>;
}

interface BindingRecord {
  readonly id: string;
  readonly handle: ProjectDirectoryIdentity;
  readonly bindings: Readonly<Record<string, string>>;
}

interface BindingDatabase extends DBSchema {
  projects: {
    key: string;
    value: BindingRecord;
  };
}

export interface ProjectBuildBindings {
  readonly scopeId: string;
  preferred(logicalProfileId: string): string | undefined;
  remember(logicalProfileId: string, capabilityId: string): Promise<void>;
}

async function openBindingsDatabase() {
  return openDB<BindingDatabase>("tea-maps-project-build-bindings", 1, {
    upgrade(connection) {
      connection.createObjectStore("projects", { keyPath: "id" });
    },
  });
}

export async function openProjectBuildBindings(
  handle: ProjectDirectoryIdentity,
): Promise<ProjectBuildBindings | null> {
  if (!handle.isSameEntry) return null;
  const db = await openBindingsDatabase();
  let record: BindingRecord | undefined;
  try {
    for (const candidate of await db.getAll("projects")) {
      try {
        if (await handle.isSameEntry(candidate.handle)) {
          record = candidate;
          break;
        }
      } catch {
        // Revoked handles cannot identify the current directory.
      }
    }
    if (!record) {
      record = { id: crypto.randomUUID(), handle, bindings: {} };
      await db.put("projects", record);
    }
  } finally {
    db.close();
  }
  let current: BindingRecord = record;
  return {
    scopeId: current.id,
    preferred(logicalProfileId) {
      return current.bindings[logicalProfileId];
    },
    async remember(logicalProfileId, capabilityId) {
      if (current.bindings[logicalProfileId] === capabilityId) return;
      const next: BindingRecord = {
        ...current,
        bindings: { ...current.bindings, [logicalProfileId]: capabilityId },
      };
      const writeDb = await openBindingsDatabase();
      try {
        await writeDb.put("projects", next);
        current = next;
      } finally {
        writeDb.close();
      }
    },
  };
}
