import { openDB, type DBSchema } from "idb";
import { z } from "zod";
import {
  importExportSettings,
  type ExportDirectory,
} from "./editor-export-settings.ts";

interface LegacyExportDatabase extends DBSchema {
  "build-exports": { key: string; value: unknown };
}

const portableExportSettingsSchema = z.strictObject({
  scopeId: z.string().min(1).max(4_096),
  includeSource: z.boolean(),
  afterBuild: z.boolean(),
});
export { portableExportSettingsSchema };

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

export async function readLegacyExportSettings() {
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
  return (await readLegacyExportSettings()).length;
}

export async function importLegacyExportSettings() {
  return importExportSettings(await readLegacyExportSettings());
}

export async function portableLegacyExportSettings() {
  return (await readLegacyExportSettings()).map((settings) =>
    portableExportSettingsSchema.parse({
      scopeId: settings.scopeId,
      includeSource: settings.includeSource,
      afterBuild: settings.afterBuild,
    }),
  );
}

export async function importPortableLegacyExportSettings(
  settings: readonly z.infer<typeof portableExportSettingsSchema>[],
) {
  return importExportSettings(
    settings.map((setting) => ({ ...setting, directory: null })),
  );
}
