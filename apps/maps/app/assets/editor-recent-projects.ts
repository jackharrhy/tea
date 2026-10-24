import { openDB, type DBSchema } from "idb";
import type { MapDirectoryHandle } from "./editor-project.ts";

export interface RecentProject {
  readonly id: string;
  readonly name: string;
  readonly handle: MapDirectoryHandle;
  readonly lastMapPath?: string;
  readonly updatedAt: number;
}

interface RecentProjectDatabase extends DBSchema {
  projects: { key: string; value: RecentProject };
}

function database() {
  return openDB<RecentProjectDatabase>("tea-maps-recent-projects", 1, {
    upgrade(connection) {
      connection.createObjectStore("projects", { keyPath: "id" });
    },
  });
}

function isRecentProject(value: unknown): value is RecentProject {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const handle = record.handle as Record<string, unknown> | undefined;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.updatedAt === "number" &&
    (record.lastMapPath === undefined ||
      typeof record.lastMapPath === "string") &&
    handle?.kind === "directory" &&
    typeof handle.name === "string"
  );
}

export async function listRecentProjects(): Promise<RecentProject[]> {
  const connection = await database();
  try {
    return (await connection.getAll("projects"))
      .filter(isRecentProject)
      .toSorted((left, right) => right.updatedAt - left.updatedAt);
  } finally {
    connection.close();
  }
}

export async function recentProject(id: string): Promise<RecentProject | null> {
  const connection = await database();
  try {
    const value: unknown = await connection.get("projects", id);
    return isRecentProject(value) ? value : null;
  } finally {
    connection.close();
  }
}

export async function rememberRecentProject(
  handle: MapDirectoryHandle,
  name: string,
): Promise<RecentProject> {
  let existing: RecentProject | undefined;
  for (const candidate of await listRecentProjects()) {
    if (candidate.handle === handle) {
      existing = candidate;
      break;
    }
    try {
      if (handle.isSameEntry && (await handle.isSameEntry(candidate.handle))) {
        existing = candidate;
        break;
      }
    } catch {
      // A stale handle cannot identify the selected folder.
    }
  }
  const record: RecentProject = {
    id: existing?.id ?? crypto.randomUUID(),
    name,
    handle,
    ...(existing?.lastMapPath ? { lastMapPath: existing.lastMapPath } : {}),
    updatedAt: Date.now(),
  };
  const connection = await database();
  try {
    await connection.put("projects", record);
    for (const stale of (await connection.getAll("projects"))
      .filter(isRecentProject)
      .toSorted((left, right) => right.updatedAt - left.updatedAt)
      .slice(12)) {
      await connection.delete("projects", stale.id);
    }
  } finally {
    connection.close();
  }
  return record;
}

export async function rememberRecentProjectMap(
  id: string,
  path: string,
): Promise<void> {
  const connection = await database();
  try {
    const record: unknown = await connection.get("projects", id);
    if (!isRecentProject(record)) return;
    await connection.put("projects", {
      ...record,
      lastMapPath: path,
      updatedAt: Date.now(),
    });
  } finally {
    connection.close();
  }
}
