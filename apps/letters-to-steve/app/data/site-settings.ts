import type { SqliteDatabase } from "remix/data-table/sqlite";

import { siteSettings } from "./schema.ts";

const siteSettingsId = 1;

export async function isSiteEnabled(
  database: SqliteDatabase,
): Promise<boolean> {
  let settings = await database.find(siteSettings, siteSettingsId);
  return settings ? settings.is_enabled : true;
}

export async function setSiteEnabled(
  database: SqliteDatabase,
  isEnabled: boolean,
) {
  let settings = await database.find(siteSettings, siteSettingsId);
  let updatedAt = Date.now();

  if (settings) {
    await database.update(siteSettings, siteSettingsId, {
      is_enabled: isEnabled,
      updated_at: updatedAt,
    });
    return;
  }

  await database.create(siteSettings, {
    id: siteSettingsId,
    is_enabled: isEnabled,
    updated_at: updatedAt,
  });
}
