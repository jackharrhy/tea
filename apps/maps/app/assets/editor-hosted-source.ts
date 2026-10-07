import { parseMapSource } from "@tea/maps-editor/core";
import {
  HostedErrorResponseSchema,
  HostedMapResponseSchema,
  ReplaceHostedMapSourceRequestSchema,
  ReplaceHostedMapSourceResultSchema,
  type HostedMapLaunch,
  type ReplaceHostedMapSourceResult,
} from "@tea/maps-protocol";
import { openDB, type DBSchema } from "idb";
import { readHostedApi } from "./hosted-api.ts";

const MAX_SOURCE_BYTES = 2 * 1_024 * 1_024;

export interface HostedSourceBaseline {
  readonly id: string;
  readonly projectId: string;
  readonly format: HostedMapLaunch["format"];
  readonly mapVersion: number;
  readonly sourceSha256: string;
  readonly source: string;
}

export interface HostedSourceDraft {
  readonly mapId: string;
  readonly baseline: HostedSourceBaseline;
  readonly source: string;
  readonly updatedAt: number;
}

interface DraftDatabase extends DBSchema {
  drafts: {
    key: string;
    value: HostedSourceDraft;
  };
}

async function openDraftDatabase() {
  return openDB<DraftDatabase>("tea-maps-hosted-source-drafts", 1, {
    upgrade(connection) {
      connection.createObjectStore("drafts", { keyPath: "mapId" });
    },
  });
}

export async function loadHostedSourceDraft(
  mapId: string,
): Promise<HostedSourceDraft | null> {
  const db = await openDraftDatabase();
  try {
    const value = await db.get("drafts", mapId);
    return value?.mapId === mapId &&
      value.baseline?.id === mapId &&
      typeof value.source === "string"
      ? value
      : null;
  } finally {
    db.close();
  }
}

export async function saveHostedSourceDraft(
  draft: HostedSourceDraft,
): Promise<void> {
  const db = await openDraftDatabase();
  try {
    await db.put("drafts", draft);
  } finally {
    db.close();
  }
}

export async function clearHostedSourceDraft(mapId: string): Promise<void> {
  const db = await openDraftDatabase();
  try {
    await db.delete("drafts", mapId);
  } finally {
    db.close();
  }
}

export async function readHostedSource(
  mapId: string,
): Promise<HostedMapLaunch> {
  return (
    await readHostedApi(
      `/api/maps/${encodeURIComponent(mapId)}`,
      HostedMapResponseSchema,
    )
  ).map;
}

export async function replaceHostedSource(
  baseline: HostedSourceBaseline,
  source: string,
  fetcher: typeof fetch = fetch,
): Promise<ReplaceHostedMapSourceResult> {
  if (new TextEncoder().encode(source).byteLength > MAX_SOURCE_BYTES) {
    throw new Error("Hosted maps are limited to 2 MiB of source");
  }
  const document = parseMapSource(source).document;
  if (document.faceSyntax !== baseline.format) {
    throw new Error("Map face syntax does not match the hosted map");
  }
  const request = ReplaceHostedMapSourceRequestSchema.parse({
    expectedMapVersion: baseline.mapVersion,
    expectedSourceSha256: baseline.sourceSha256,
    source,
  });
  const response = await fetcher(
    `/api/projects/${encodeURIComponent(baseline.projectId)}/maps/${encodeURIComponent(baseline.id)}/source`,
    {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );
  const payload: unknown = await response.json().catch(() => null);
  if (response.status !== 200 && response.status !== 409) {
    const error = HostedErrorResponseSchema.safeParse(payload);
    throw new Error(
      error.success
        ? error.data.error
        : `Source save failed (${response.status})`,
    );
  }
  const result = ReplaceHostedMapSourceResultSchema.safeParse(payload);
  if (
    !result.success ||
    (response.status === 200) !== (result.data.status === "replaced")
  ) {
    throw new Error("Maps service returned an invalid source save result");
  }
  return result.data;
}
