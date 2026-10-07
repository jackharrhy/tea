import { openDB, type DBSchema } from "idb";
import type { BuildExportFile } from "./editor-build-export.ts";

interface ExportWritable {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

export interface ExportDirectory {
  readonly kind: "directory";
  readonly name: string;
  queryPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  getFileHandle(
    name: string,
    options: { create: true },
  ): Promise<{ createWritable(): Promise<ExportWritable> }>;
}

export interface ExportSettings {
  readonly scopeId: string;
  readonly includeSource: boolean;
  readonly afterBuild: boolean;
  readonly directory: ExportDirectory | null;
}

interface ExportDatabase extends DBSchema {
  settings: {
    key: string;
    value: ExportSettings;
  };
}

async function openExportDatabase() {
  return openDB<ExportDatabase>("tea-maps-export-settings", 1, {
    upgrade(connection) {
      connection.createObjectStore("settings", { keyPath: "scopeId" });
    },
  });
}

export function defaultExportSettings(scopeId: string): ExportSettings {
  return {
    scopeId,
    includeSource: false,
    afterBuild: false,
    directory: null,
  };
}

export async function loadExportSettings(
  scopeId: string,
): Promise<ExportSettings> {
  const db = await openExportDatabase();
  try {
    const value = await db.get("settings", scopeId);
    return value?.scopeId === scopeId &&
      typeof value.includeSource === "boolean" &&
      typeof value.afterBuild === "boolean" &&
      (value.directory === null || value.directory?.kind === "directory")
      ? value
      : defaultExportSettings(scopeId);
  } finally {
    db.close();
  }
}

export async function saveExportSettings(
  settings: ExportSettings,
): Promise<void> {
  const db = await openExportDatabase();
  try {
    await db.put("settings", settings);
  } finally {
    db.close();
  }
}

export function directoryExportSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export function pickExportDirectory(): Promise<ExportDirectory> {
  const picker = (
    window as Window & {
      showDirectoryPicker?(options: {
        mode: "readwrite";
      }): Promise<ExportDirectory>;
    }
  ).showDirectoryPicker;
  if (!picker) throw new Error("This browser supports downloads only");
  return picker({ mode: "readwrite" });
}

export async function writeBuildExport(
  directory: ExportDirectory,
  file: BuildExportFile,
): Promise<void> {
  if ((await directory.queryPermission({ mode: "readwrite" })) !== "granted") {
    throw new Error("Export folder permission expired; choose it again");
  }
  const handle = await directory.getFileHandle(file.name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(new Blob([file.data], { type: file.mediaType }));
    await writable.close();
  } catch (error) {
    await writable.abort?.().catch(() => undefined);
    throw error;
  }
}
