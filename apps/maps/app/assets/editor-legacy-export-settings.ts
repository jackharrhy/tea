import { openDB, type DBSchema } from "idb";
import { z } from "zod";
import {
  importExportSettings,
  type ExportDirectory,
} from "./editor-export-settings.ts";

interface LegacyExportDatabase extends DBSchema {
  "build-exports": { key: string; value: unknown };
}

const legacyExportSettingsSchema = z.object({
  scopeId: z.string().min(1).max(4_096),
  includeSource: z.boolean().default(false),
  afterBuild: z.boolean().default(false),
  directory: z
    .custom<ExportDirectory>(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        "kind" in value &&
        value.kind === "directory" &&
        "name" in value &&
        typeof value.name === "string" &&
        "queryPermission" in value &&
        typeof value.queryPermission === "function" &&
        "getFileHandle" in value &&
        typeof value.getFileHandle === "function",
    )
    .nullable()
    .default(null),
});

async function legacyExportSettings() {
  if (!indexedDB.databases) return [];
  const databases = await indexedDB.databases();
  if (!databases.some((database) => database.name === "worldview-editor"))
    return [];
  const legacy = await openDB<LegacyExportDatabase>("worldview-editor");
  try {
    if (!legacy.objectStoreNames.contains("build-exports")) return [];
    const values: unknown[] = await legacy.getAll("build-exports");
    return values.map((value) => legacyExportSettingsSchema.parse(value));
  } finally {
    legacy.close();
  }
}

export async function countLegacyExportSettings() {
  return (await legacyExportSettings()).length;
}

export async function importLegacyExportSettings() {
  return importExportSettings(await legacyExportSettings());
}
