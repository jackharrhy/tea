import "fake-indexeddb/auto";
import { createHash } from "node:crypto";
import {
  createStarterDocument,
  parseWorldviewProject,
  serializeMap,
} from "@tea/maps-editor/core";
import { deleteDB } from "idb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MapFileHandle } from "../editor-files.ts";
import type { MapProject } from "../editor-project.ts";
import {
  inspectLinkedMap,
  linkHostedProject,
  pullLinkedMap,
  pushLinkedMap,
} from "../editor-project-sync.ts";

const origin = "https://maps.example";
const projectId = "project00001";
const mapId = "map000000001";
const document = createStarterDocument();
const baseSource = serializeMap(document);
const hash = (source: string) =>
  createHash("sha256").update(source).digest("hex");

function fileHandle(name: string, initial: string) {
  let source = initial;
  const handle: MapFileHandle = {
    name,
    async getFile() {
      return new File([source], name);
    },
    async createWritable() {
      let next = source;
      return {
        async write(data: Blob | string) {
          next = typeof data === "string" ? data : await data.text();
        },
        async close() {
          source = next;
        },
      };
    },
  };
  return {
    handle,
    read: () => source,
    change: (value: string) => (source = value),
  };
}

function fixture(
  localSource = baseSource,
  manifestFileName = "worldview.project.json",
) {
  const local = fileHandle("demo.map", localSource);
  const manifest = fileHandle(
    manifestFileName,
    JSON.stringify({
      schemaVersion: 1,
      name: "Demo",
      game: "quake",
      mapRoots: ["maps"],
      resources: { wads: [], spriteRoots: [], entityDefinitions: [] },
      buildProfiles: [],
    }),
  );
  const project = {
    manifestFileName,
    manifest: parseWorldviewProject(manifest.read()),
    maps: [{ path: "maps/demo.map", handle: local.handle }],
    handle: {
      getFileHandle: async (name: string) => {
        if (name !== manifestFileName) throw new Error(`Missing ${name}`);
        return manifest.handle;
      },
    },
  } as unknown as MapProject;
  return { project, local, manifest };
}

function hostedMap(source: string, mapVersion = 1) {
  return {
    id: mapId,
    slug: "demo",
    projectId,
    projectSlug: "demo",
    projectName: "Demo",
    game: "quake",
    name: "Demo map",
    format: "valve-220",
    role: "owner",
    actorId: "actor",
    displayName: "Editor",
    mapId,
    mapVersion,
    document,
    source,
    sourceSha256: hash(source),
  } as const;
}

beforeEach(() => deleteDB("tea-maps-project-sync"));
afterEach(() => {
  vi.unstubAllGlobals();
  return deleteDB("tea-maps-project-sync");
});

it("validates map syntax before saving project links", async () => {
  const { project, manifest } = fixture(baseSource);
  const remote = {
    id: projectId,
    game: "quake",
    maps: [{ id: mapId, name: "Demo map", format: "quake" }],
  } as Parameters<typeof linkHostedProject>[1];
  await expect(
    linkHostedProject(project, remote, { "maps/demo.map": mapId }, origin),
  ).rejects.toThrow(/uses valve-220/);
  expect(JSON.parse(manifest.read())).not.toHaveProperty("hosted");
});

it("writes a Tea project link to its opened manifest", async () => {
  const { project, manifest } = fixture(baseSource, "tea.maps.project.json");
  const remote = {
    id: projectId,
    game: "quake",
    maps: [{ id: mapId, name: "Demo map", format: "valve-220" }],
  } as Parameters<typeof linkHostedProject>[1];
  await linkHostedProject(project, remote, { "maps/demo.map": mapId }, origin);
  expect(JSON.parse(manifest.read()).hosted.projectId).toBe(projectId);
});

it("tracks the common baseline and refuses a stale pull", async () => {
  const { project, local } = fixture();
  const remote = {
    id: projectId,
    game: "quake",
    maps: [{ id: mapId, name: "Demo map", format: "valve-220" }],
  } as Parameters<typeof linkHostedProject>[1];
  const linked = await linkHostedProject(
    project,
    remote,
    { "maps/demo.map": mapId },
    origin,
  );
  let hosted = hostedMap(`${baseSource}\n// hosted`);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ map: hosted })),
  );

  const first = await inspectLinkedMap(linked, "maps/demo.map", origin);
  expect(first.status).toBe("first-link");
  await pullLinkedMap(linked, first, origin);
  expect(local.read()).toBe(hosted.source);
  expect((await inspectLinkedMap(linked, first.path, origin)).status).toBe(
    "in-sync",
  );

  local.change(`${local.read()}\n// local`);
  expect((await inspectLinkedMap(linked, first.path, origin)).status).toBe(
    "local-changed",
  );
  const reviewed = await inspectLinkedMap(linked, first.path, origin);
  hosted = hostedMap(`${hosted.source}\n// remote change`, 2);
  await expect(pullLinkedMap(linked, reviewed, origin)).rejects.toThrow(
    /changed since comparison/,
  );
  expect(local.read()).toContain("// local");
  expect((await inspectLinkedMap(linked, first.path, origin)).status).toBe(
    "conflict",
  );
});

it("sends a checked hosted version and keeps a rejected push local", async () => {
  const { project, local } = fixture(`${baseSource}\n// local`);
  const remote = {
    id: projectId,
    game: "quake",
    maps: [{ id: mapId, name: "Demo map", format: "valve-220" }],
  } as Parameters<typeof linkHostedProject>[1];
  const linked = await linkHostedProject(
    project,
    remote,
    { "maps/demo.map": mapId },
    origin,
  );
  const hosted = hostedMap(baseSource, 8);
  const fetcher = vi.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      expect(JSON.parse(String(init.body))).toMatchObject({
        expectedMapVersion: 8,
        expectedSourceSha256: hosted.sourceSha256,
      });
      return Response.json(
        { status: "conflict", mapVersion: 9, sourceSha256: "b".repeat(64) },
        { status: 409 },
      );
    }
    return Response.json({ map: hosted });
  });
  vi.stubGlobal("fetch", fetcher);
  const reviewed = await inspectLinkedMap(linked, "maps/demo.map", origin);
  await expect(pushLinkedMap(linked, reviewed, origin)).rejects.toThrow(
    /changed during the push/,
  );
  expect(local.read()).toContain("// local");
  expect(fetcher).toHaveBeenCalledWith(
    `/api/projects/${projectId}/maps/${mapId}/source`,
    expect.objectContaining({ method: "PUT", credentials: "same-origin" }),
  );
});

it("records the new common baseline after a successful push", async () => {
  const { project, local } = fixture(`${baseSource}\n// local`);
  const remote = {
    id: projectId,
    game: "quake",
    maps: [{ id: mapId, name: "Demo map", format: "valve-220" }],
  } as Parameters<typeof linkHostedProject>[1];
  const linked = await linkHostedProject(
    project,
    remote,
    { "maps/demo.map": mapId },
    origin,
  );
  let hosted = hostedMap(baseSource, 8);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method !== "PUT") return Response.json({ map: hosted });
      hosted = hostedMap(local.read(), 9);
      return Response.json({
        status: "replaced",
        map: {
          mapId,
          mapVersion: hosted.mapVersion,
          document,
          source: hosted.source,
          sourceSha256: hosted.sourceSha256,
        },
      });
    }),
  );
  const reviewed = await inspectLinkedMap(linked, "maps/demo.map", origin);
  await pushLinkedMap(linked, reviewed, origin);
  expect(local.read()).toBe(reviewed.localSource);
  expect((await inspectLinkedMap(linked, reviewed.path, origin)).status).toBe(
    "in-sync",
  );
});

it("rejects a hosted snapshot whose source does not match its advertised hash", async () => {
  const { project, local } = fixture();
  const remote = {
    id: projectId,
    game: "quake",
    maps: [{ id: mapId, name: "Demo map", format: "valve-220" }],
  } as Parameters<typeof linkHostedProject>[1];
  const linked = await linkHostedProject(
    project,
    remote,
    { "maps/demo.map": mapId },
    origin,
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        map: { ...hostedMap(baseSource), sourceSha256: "a".repeat(64) },
      }),
    ),
  );
  await expect(
    inspectLinkedMap(linked, "maps/demo.map", origin),
  ).rejects.toThrow(/hash does not match/);
  expect(local.read()).toBe(baseSource);
});
