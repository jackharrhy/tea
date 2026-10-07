import "fake-indexeddb/auto";
import { serializeMap, createStarterDocument } from "@tea/maps-editor/core";
import { deleteDB } from "idb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  clearHostedSourceDraft,
  loadHostedSourceDraft,
  replaceHostedSource,
  saveHostedSourceDraft,
  type HostedSourceBaseline,
} from "../editor-hosted-source.ts";

const databaseName = "tea-maps-hosted-source-drafts";
const baseline: HostedSourceBaseline = {
  id: "map-1",
  projectId: "project-1",
  format: "valve-220",
  mapVersion: 7,
  sourceSha256: "a".repeat(64),
  source: serializeMap(createStarterDocument()),
};

beforeEach(() => deleteDB(databaseName));
afterEach(() => deleteDB(databaseName));

it("preserves a hosted source draft separately by map", async () => {
  await saveHostedSourceDraft({
    mapId: baseline.id,
    baseline,
    source: `${baseline.source}\n// draft`,
    updatedAt: 123,
  });

  expect((await loadHostedSourceDraft("map-1"))?.source).toContain("draft");
  expect(await loadHostedSourceDraft("map-2")).toBeNull();
  await clearHostedSourceDraft("map-1");
  expect(await loadHostedSourceDraft("map-1")).toBeNull();
});

it("sends the reviewed version and hash and keeps conflicts explicit", async () => {
  const fetcher = vi.fn<typeof fetch>(async (_path, init) => {
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      expectedMapVersion: 7,
      expectedSourceSha256: "a".repeat(64),
    });
    return Response.json(
      { status: "conflict", mapVersion: 8, sourceSha256: "b".repeat(64) },
      { status: 409 },
    );
  });

  const result = await replaceHostedSource(baseline, baseline.source, fetcher);
  expect(result).toMatchObject({ status: "conflict", mapVersion: 8 });
  expect(fetcher).toHaveBeenCalledWith(
    "/api/projects/project-1/maps/map-1/source",
    expect.objectContaining({ credentials: "same-origin" }),
  );
});

it("rejects incompatible map syntax before sending a replacement", async () => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(
    replaceHostedSource(
      { ...baseline, format: "quake" },
      baseline.source,
      fetcher,
    ),
  ).rejects.toThrow(/face syntax/);
  expect(fetcher).not.toHaveBeenCalled();
});
