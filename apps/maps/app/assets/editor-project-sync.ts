import {
  mapSourceFingerprint,
  parseMapSource,
  serializeWorldviewProject,
} from "@tea/maps-editor/core";
import {
  HostedMapResponseSchema,
  HostedProjectResponseSchema,
  type HostedMapLaunch,
  type HostedProject,
} from "@tea/maps-protocol";
import { openDB, type DBSchema } from "idb";
import { writeMapFile } from "./editor-files.ts";
import { replaceHostedSource } from "./editor-hosted-source.ts";
import { readHostedApi } from "./hosted-api.ts";
import type { MapProject } from "./editor-project.ts";

export type ProjectSyncStatus =
  | "in-sync"
  | "first-link"
  | "local-changed"
  | "hosted-changed"
  | "conflict";

interface ProjectSyncBaseline {
  readonly key: string;
  readonly localSha256: string;
  readonly hostedSha256: string;
  readonly hostedMapVersion: number;
  readonly updatedAt: number;
}

interface ProjectSyncDatabase extends DBSchema {
  baselines: { key: string; value: ProjectSyncBaseline };
}

export interface ProjectSyncInspection {
  readonly path: string;
  readonly mapId: string;
  readonly projectId: string;
  readonly localSource: string;
  readonly localSha256: string;
  readonly hosted: HostedMapLaunch;
  readonly status: ProjectSyncStatus;
}

function database() {
  return openDB<ProjectSyncDatabase>("tea-maps-project-sync", 1, {
    upgrade(connection) {
      connection.createObjectStore("baselines", { keyPath: "key" });
    },
  });
}

async function sourceSha256(source: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function syncKey(
  origin: string,
  projectId: string,
  mapId: string,
  path: string,
) {
  return `${origin}:${projectId}:${mapId}:${path}`;
}

async function loadBaseline(key: string): Promise<ProjectSyncBaseline | null> {
  const connection = await database();
  try {
    return (await connection.get("baselines", key)) ?? null;
  } finally {
    connection.close();
  }
}

async function rememberBaseline(
  key: string,
  localSha256: string,
  hosted: HostedMapLaunch,
): Promise<void> {
  const connection = await database();
  try {
    await connection.put("baselines", {
      key,
      localSha256,
      hostedSha256: hosted.sourceSha256,
      hostedMapVersion: hosted.mapVersion,
      updatedAt: Date.now(),
    });
  } finally {
    connection.close();
  }
}

function linkFor(project: MapProject, origin: string) {
  const link = project.manifest.hosted;
  if (!link)
    throw new Error("Link the local project to a hosted project first");
  if (link.origin !== origin)
    throw new Error(
      `Open this project at ${link.origin} to sync its hosted maps`,
    );
  return link;
}

export async function loadHostedProjectForSync(
  projectId: string,
  project: MapProject,
): Promise<HostedProject> {
  const { project: hosted } = await readHostedApi(
    `/api/projects/${encodeURIComponent(projectId.trim())}`,
    HostedProjectResponseSchema,
  );
  if (hosted.game !== project.manifest.game)
    throw new Error(
      `Hosted project is ${hosted.game}; local project is ${project.manifest.game}`,
    );
  return hosted;
}

export async function linkHostedProject(
  project: MapProject,
  hosted: HostedProject,
  mappings: Readonly<Record<string, string>>,
  origin = location.origin,
): Promise<MapProject> {
  if (hosted.game !== project.manifest.game)
    throw new Error("Local and hosted project games differ");
  const entries = Object.entries(mappings).filter(([, mapId]) => mapId);
  if (!entries.length) throw new Error("Choose at least one hosted map");
  if (new Set(entries.map(([, mapId]) => mapId)).size !== entries.length)
    throw new Error("Each hosted map can be linked only once");
  for (const [path, mapId] of entries) {
    const local = project.maps.find((map) => map.path === path);
    const remote = hosted.maps.find((map) => map.id === mapId);
    if (!local || !remote) throw new Error(`Invalid map link: ${path}`);
    const syntax = parseMapSource(await (await local.handle.getFile()).text())
      .document.faceSyntax;
    if (syntax !== remote.format)
      throw new Error(
        `${path} uses ${syntax}; ${remote.name} uses ${remote.format}`,
      );
  }
  const manifest = {
    ...project.manifest,
    hosted: {
      origin,
      projectId: hosted.id,
      maps: entries.map(([path, mapId]) => ({ path, mapId })),
    },
  };
  const text = serializeWorldviewProject(manifest);
  const file = await project.handle.getFileHandle(project.manifestFileName);
  await writeMapFile(
    file,
    text,
    mapSourceFingerprint(await (await file.getFile()).text()),
  );
  return { ...project, manifest };
}

export async function inspectLinkedMap(
  project: MapProject,
  path: string,
  origin = location.origin,
): Promise<ProjectSyncInspection> {
  const link = linkFor(project, origin);
  const entry = link.maps.find((map) => map.path === path);
  const local = project.maps.find((map) => map.path === path);
  if (!entry || !local) throw new Error(`Map is not linked: ${path}`);
  const key = syncKey(origin, link.projectId, entry.mapId, path);
  const [localSource, response, baseline] = await Promise.all([
    local.handle.getFile().then((file) => file.text()),
    readHostedApi(
      `/api/maps/${encodeURIComponent(entry.mapId)}`,
      HostedMapResponseSchema,
    ),
    loadBaseline(key),
  ]);
  const hosted = response.map;
  if (hosted.projectId !== link.projectId)
    throw new Error("Linked map belongs to another hosted project");
  if (hosted.game !== project.manifest.game)
    throw new Error("Local and hosted project games differ");
  const [localSha256, hostedSha256] = await Promise.all([
    sourceSha256(localSource),
    sourceSha256(hosted.source),
  ]);
  if (hostedSha256 !== hosted.sourceSha256)
    throw new Error("Hosted map source hash does not match its source");
  const localChanged =
    baseline !== null && baseline.localSha256 !== localSha256;
  const hostedChanged =
    baseline !== null && baseline.hostedSha256 !== hosted.sourceSha256;
  const status: ProjectSyncStatus =
    localSha256 === hosted.sourceSha256
      ? "in-sync"
      : !baseline
        ? "first-link"
        : localChanged && hostedChanged
          ? "conflict"
          : localChanged
            ? "local-changed"
            : hostedChanged
              ? "hosted-changed"
              : "conflict";
  if (
    status === "in-sync" &&
    (!baseline || baseline.hostedMapVersion !== hosted.mapVersion)
  ) {
    await rememberBaseline(key, localSha256, hosted);
  }
  return {
    path,
    mapId: entry.mapId,
    projectId: link.projectId,
    localSource,
    localSha256,
    hosted,
    status,
  };
}

async function recheck(
  project: MapProject,
  reviewed: ProjectSyncInspection,
  origin: string,
): Promise<ProjectSyncInspection> {
  const current = await inspectLinkedMap(project, reviewed.path, origin);
  if (
    current.projectId !== reviewed.projectId ||
    current.mapId !== reviewed.mapId ||
    current.localSha256 !== reviewed.localSha256 ||
    current.hosted.sourceSha256 !== reviewed.hosted.sourceSha256 ||
    current.hosted.mapVersion !== reviewed.hosted.mapVersion
  ) {
    throw new Error(
      "The map changed since comparison. Review it again before syncing",
    );
  }
  return current;
}

export async function pullLinkedMap(
  project: MapProject,
  reviewed: ProjectSyncInspection,
  origin = location.origin,
): Promise<void> {
  const current = await recheck(project, reviewed, origin);
  if (
    parseMapSource(current.hosted.source).document.faceSyntax !==
    current.hosted.format
  )
    throw new Error("Hosted map source does not match its face syntax");
  const local = project.maps.find((map) => map.path === reviewed.path)!;
  await writeMapFile(
    local.handle,
    current.hosted.source,
    mapSourceFingerprint(current.localSource),
  );
  await rememberBaseline(
    syncKey(origin, current.projectId, current.mapId, current.path),
    current.hosted.sourceSha256,
    current.hosted,
  );
}

export async function pushLinkedMap(
  project: MapProject,
  reviewed: ProjectSyncInspection,
  origin = location.origin,
): Promise<void> {
  const current = await recheck(project, reviewed, origin);
  if (current.hosted.role === "viewer")
    throw new Error("Editor access is required to push source");
  const result = await replaceHostedSource(
    {
      id: current.hosted.id,
      projectId: current.projectId,
      format: current.hosted.format,
      mapVersion: current.hosted.mapVersion,
      sourceSha256: current.hosted.sourceSha256,
      source: current.hosted.source,
    },
    current.localSource,
  );
  if (result.status === "conflict")
    throw new Error("Hosted source changed during the push. Review it again");
  await rememberBaseline(
    syncKey(origin, current.projectId, current.mapId, current.path),
    current.localSha256,
    { ...current.hosted, ...result.map },
  );
}
