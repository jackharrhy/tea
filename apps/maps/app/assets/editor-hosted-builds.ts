import {
  CreateHostedBuildRequestSchema,
  HostedBuildCreatedResponseSchema,
  HostedBuildsResponseSchema,
  HostedErrorResponseSchema,
  type HostedBuild,
  type HostedMapLaunch,
} from "@tea/maps-protocol";

type BuildQuality = "preview" | "final";

async function decode<T>(
  response: Response,
  schema: {
    safeParse(value: unknown): { success: true; data: T } | { success: false };
  },
): Promise<T> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = HostedErrorResponseSchema.safeParse(payload);
    throw new Error(
      error.success ? error.data.error : `Request failed (${response.status})`,
    );
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success)
    throw new Error("Maps service returned an invalid response");
  return parsed.data;
}

export function hostedBuildArtifactPath(
  mapId: string,
  buildId: string,
  sha256: string,
): string {
  return `/api/maps/${encodeURIComponent(mapId)}/builds/${encodeURIComponent(buildId)}/artifacts/${sha256}`;
}

export async function listHostedBuilds(
  mapId: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  return decode(
    await fetcher(`/api/maps/${encodeURIComponent(mapId)}/builds`, {
      credentials: "same-origin",
      signal,
    }),
    HostedBuildsResponseSchema,
  );
}

export async function queueHostedBuild(
  mapId: string,
  quality: BuildQuality,
  expectedMapVersion: number,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<HostedBuild> {
  const request = CreateHostedBuildRequestSchema.parse({
    quality,
    expectedMapVersion,
  });
  const response = await fetcher(
    `/api/maps/${encodeURIComponent(mapId)}/builds`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    },
  );
  return (await decode(response, HostedBuildCreatedResponseSchema)).build;
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

export async function waitForHostedBuild(
  mapId: string,
  created: HostedBuild,
  options: {
    readonly fetcher?: typeof fetch;
    readonly signal: AbortSignal;
    readonly pollIntervalMilliseconds?: number;
    readonly onUpdate?: (build: HostedBuild) => void;
  },
): Promise<HostedBuild> {
  let build = created;
  while (build.status === "queued" || build.status === "running") {
    await delay(options.pollIntervalMilliseconds ?? 1_000, options.signal);
    const response = await listHostedBuilds(
      mapId,
      options.fetcher ?? fetch,
      options.signal,
    );
    const current = response.builds.find((entry) => entry.id === created.id);
    if (!current)
      throw new Error("Hosted build disappeared from build history");
    build = current;
    options.onUpdate?.(build);
  }
  return build;
}

export interface HostedBuildHistoryContext {
  readonly map: HostedMapLaunch | null;
  readonly builds: readonly HostedBuild[];
  readonly status: string;
  readonly refreshing: boolean;
  readonly refresh: () => void;
  readonly preview: (build: HostedBuild, artifactPath: string) => void;
  readonly currentVersion: () => number | null;
}

export function initHostedBuilds(options: {
  readonly map: () => HostedMapLaunch | null;
  readonly preview: (build: HostedBuild, artifactPath: string) => void;
  readonly onUpdate: (build: HostedBuild, durationHint?: string) => void;
}) {
  let generation = 0;
  let active: AbortController | null = null;
  let ready = false;
  let map: HostedMapLaunch | null = null;
  let builds: readonly HostedBuild[] = [];
  let status = "";
  let refreshing = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<HostedBuildHistoryContext>(
        "tea-maps-hosted-builds-state",
        {
          detail: {
            map,
            builds,
            status,
            refreshing,
            refresh: refreshCurrent,
            preview: options.preview,
            currentVersion: () => options.map()?.mapVersion ?? null,
          },
        },
      ),
    );
  }

  async function refresh(selected: HostedMapLaunch, version: number) {
    refreshing = true;
    status = "Loading hosted builds";
    publish();
    try {
      const response = await listHostedBuilds(selected.id);
      if (version !== generation || options.map()?.id !== selected.id)
        return response;
      builds = response.builds;
      status = response.capability
        ? `${response.builds.length} builds · hosted compiler available${response.capability.durationHint ? ` · ${response.capability.durationHint}` : ""}`
        : `${response.builds.length} builds · hosted compiler unavailable`;
      return response;
    } finally {
      if (version === generation) {
        refreshing = false;
        publish();
      }
    }
  }

  function refreshCurrent() {
    const selected = options.map();
    if (!selected) return;
    const version = generation;
    void refresh(selected, version).catch((cause: unknown) => {
      if (version !== generation) return;
      status = cause instanceof Error ? cause.message : String(cause);
      publish();
    });
  }

  window.addEventListener("tea-maps-hosted-builds-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-hosted-builds-bridge-ready"));

  return {
    setMap(next: HostedMapLaunch | null) {
      ++generation;
      active?.abort(new Error("Hosted map changed"));
      active = null;
      map = next;
      builds = [];
      status = "";
      refreshing = false;
      publish();
      if (next) refreshCurrent();
    },
    async build(quality: BuildQuality): Promise<HostedBuild> {
      const selected = options.map();
      if (!selected) throw new Error("Open a hosted map first");
      if (selected.role === "viewer")
        throw new Error("Editor access required to build");
      if (active) throw new Error("A hosted build is already being watched");
      const version = generation;
      const available = await listHostedBuilds(selected.id);
      if (version !== generation || options.map()?.id !== selected.id)
        throw new Error("Hosted map changed before the build started");
      if (!available.capability)
        throw new Error("Hosted compiler is unavailable for this map");
      const durationHint = available.capability.durationHint;
      const controller = new AbortController();
      active = controller;
      try {
        const created = await queueHostedBuild(
          selected.id,
          quality,
          selected.mapVersion,
          fetch,
          controller.signal,
        );
        if (version === generation) options.onUpdate(created, durationHint);
        const result = await waitForHostedBuild(selected.id, created, {
          signal: controller.signal,
          onUpdate(build) {
            if (version === generation) options.onUpdate(build, durationHint);
          },
        });
        if (version === generation) await refresh(selected, version);
        return result;
      } finally {
        if (active === controller) active = null;
      }
    },
  };
}
