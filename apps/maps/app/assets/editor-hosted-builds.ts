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

export function initHostedBuilds(options: {
  readonly map: () => HostedMapLaunch | null;
  readonly preview: (build: HostedBuild, artifactPath: string) => void;
  readonly onUpdate: (build: HostedBuild, durationHint?: string) => void;
}) {
  const root = document.querySelector<HTMLDetailsElement>("#hosted-builds")!;
  const status = document.querySelector<HTMLElement>("#hosted-builds-status")!;
  const list = document.querySelector<HTMLUListElement>("#hosted-builds-list")!;
  const refreshButton = document.querySelector<HTMLButtonElement>(
    "#hosted-builds-refresh",
  )!;
  let generation = 0;
  let active: AbortController | null = null;

  function render(builds: readonly HostedBuild[], map: HostedMapLaunch) {
    list.replaceChildren();
    if (builds.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = "No hosted builds yet";
      list.append(empty);
      return;
    }
    for (const build of builds.toSorted((a, b) => b.createdAt - a.createdAt)) {
      const row = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `${build.quality} · v${build.mapVersion} · ${build.status}${build.result?.error ? ` · ${build.result.error}` : ""}`;
      row.append(label);
      const bsp = build.result?.artifacts?.find(
        (artifact) => artifact.kind === "bsp",
      );
      if (bsp && build.status === "succeeded") {
        const path = hostedBuildArtifactPath(map.id, build.id, bsp.sha256);
        const download = document.createElement("a");
        download.href = path;
        download.download = bsp.name;
        download.textContent = "Download BSP";
        row.append(download);
        if (build.mapVersion === options.map()?.mapVersion) {
          const preview = document.createElement("button");
          preview.type = "button";
          preview.textContent = "Preview";
          preview.addEventListener("click", () => options.preview(build, path));
          row.append(preview);
        }
      }
      list.append(row);
    }
  }

  async function refresh(map: HostedMapLaunch, version: number) {
    refreshButton.disabled = true;
    status.textContent = "Loading hosted builds";
    try {
      const response = await listHostedBuilds(map.id);
      if (version !== generation || options.map()?.id !== map.id)
        return response;
      render(response.builds, map);
      status.textContent = response.capability
        ? `${response.builds.length} builds · hosted compiler available${response.capability.durationHint ? ` · ${response.capability.durationHint}` : ""}`
        : `${response.builds.length} builds · hosted compiler unavailable`;
      return response;
    } finally {
      if (version === generation) refreshButton.disabled = false;
    }
  }

  refreshButton.addEventListener("click", () => {
    const map = options.map();
    if (!map) return;
    void refresh(map, generation).catch((error: unknown) => {
      status.textContent =
        error instanceof Error ? error.message : String(error);
    });
  });

  return {
    setMap(map: HostedMapLaunch | null) {
      ++generation;
      active?.abort(new Error("Hosted map changed"));
      active = null;
      root.hidden = !map;
      list.replaceChildren();
      status.textContent = "";
      if (map) {
        void refresh(map, generation).catch((error: unknown) => {
          if (options.map()?.id === map.id)
            status.textContent =
              error instanceof Error ? error.message : String(error);
        });
      }
    },
    async build(quality: BuildQuality): Promise<HostedBuild> {
      const map = options.map();
      if (!map) throw new Error("Open a hosted map first");
      if (map.role === "viewer")
        throw new Error("Editor access required to build");
      if (active) throw new Error("A hosted build is already being watched");
      const version = generation;
      const available = await listHostedBuilds(map.id);
      if (version !== generation || options.map()?.id !== map.id)
        throw new Error("Hosted map changed before the build started");
      if (!available.capability)
        throw new Error("Hosted compiler is unavailable for this map");
      const durationHint = available.capability.durationHint;
      const controller = new AbortController();
      active = controller;
      try {
        const created = await queueHostedBuild(
          map.id,
          quality,
          map.mapVersion,
          fetch,
          controller.signal,
        );
        if (version === generation) options.onUpdate(created, durationHint);
        const result = await waitForHostedBuild(map.id, created, {
          signal: controller.signal,
          onUpdate(build) {
            if (version === generation) options.onUpdate(build, durationHint);
          },
        });
        if (version === generation) await refresh(map, version);
        return result;
      } finally {
        if (active === controller) active = null;
      }
    },
  };
}
