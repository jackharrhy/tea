import { openDB, type DBSchema } from "idb";
import {
  MapCompileResultSchema,
  type MapCompileResult,
} from "@tea/maps-editor/core";
import { z } from "zod";

const DATABASE_NAME = "tea-maps-local-builds";
const HISTORY_LIMIT = 20;

export interface LocalBuildRecord {
  readonly version: 1;
  readonly id: string;
  readonly mapKey: string;
  readonly createdAt: number;
  readonly result: MapCompileResult;
}

const recordSchema = z.strictObject({
  version: z.literal(1),
  id: z.string().min(1),
  mapKey: z.string().min(1).max(4_096),
  createdAt: z.number().int().nonnegative(),
  result: MapCompileResultSchema,
}) satisfies z.ZodType<LocalBuildRecord>;

interface BuildDatabase extends DBSchema {
  builds: {
    key: string;
    value: LocalBuildRecord;
    indexes: { mapKey: string };
  };
}

function database() {
  return openDB<BuildDatabase>(DATABASE_NAME, 1, {
    upgrade(connection) {
      const builds = connection.createObjectStore("builds", { keyPath: "id" });
      builds.createIndex("mapKey", "mapKey");
    },
  });
}

function validRecords(values: readonly unknown[]): LocalBuildRecord[] {
  return values
    .flatMap((value) => {
      const parsed = recordSchema.safeParse(value);
      return parsed.success ? [parsed.data] : [];
    })
    .toSorted((left, right) => right.createdAt - left.createdAt);
}

export async function listLocalBuilds(
  mapKey: string,
): Promise<readonly LocalBuildRecord[]> {
  const connection = await database();
  try {
    return validRecords(
      await connection.getAllFromIndex("builds", "mapKey", mapKey),
    );
  } finally {
    connection.close();
  }
}

export async function recordLocalBuild(
  mapKey: string,
  result: MapCompileResult,
): Promise<void> {
  const connection = await database();
  try {
    const existing = validRecords(
      await connection.getAllFromIndex("builds", "mapKey", mapKey),
    );
    const record: LocalBuildRecord = {
      version: 1,
      id: `${mapKey}:${result.buildId}`,
      mapKey,
      createdAt: Math.max(Date.now(), (existing[0]?.createdAt ?? 0) + 1),
      result: structuredClone(result),
    };
    try {
      await connection.put("builds", record);
    } catch (error) {
      if (
        !(error instanceof DOMException && error.name === "QuotaExceededError")
      )
        throw error;
      for (const expired of existing.slice(Math.floor(HISTORY_LIMIT / 2)))
        await connection.delete("builds", expired.id);
      await connection.put("builds", record);
    }
    const records = validRecords(
      await connection.getAllFromIndex("builds", "mapKey", mapKey),
    );
    for (const expired of records.slice(HISTORY_LIMIT))
      await connection.delete("builds", expired.id);
  } finally {
    connection.close();
  }
}
