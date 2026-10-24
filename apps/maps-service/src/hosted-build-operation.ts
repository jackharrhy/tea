import { canEditProject } from "./access-policy.js";
import { prepareWadBuildResources } from "./wad-build-resources.js";
import { prepareGameTreeBuildResources } from "./game-tree-build-resources.js";
import { hostedBuildProfile } from "./hosted-game-profiles.js";
import { ServiceHttpError, MAX_HOSTED_MAP_BYTES } from "./service-http.js";
import type { MapsServiceOptions } from "./service-options.js";

function admissionError(
  admission: "user-active" | "user-hourly" | "global-capacity",
): ServiceHttpError {
  const messages = {
    "user-active": "Wait for your current build to finish",
    "user-hourly": "Build limit reached; try again later",
    "global-capacity": "The build worker is at capacity",
  };
  return new ServiceHttpError(429, messages[admission]);
}

export async function submitHostedBuild(
  options: Pick<MapsServiceOptions, "blobs" | "builds" | "database" | "maps">,
  input: {
    readonly mapId: string;
    readonly userId: string;
    readonly quality: "preview" | "final";
    readonly expectedMapVersion?: number;
  },
) {
  if (!options.builds)
    throw new ServiceHttpError(503, "Remote builds are not configured");
  const map = options.database.map(input.mapId, input.userId);
  if (!map || !canEditProject(map.role))
    throw new ServiceHttpError(403, "Editor access required");
  if (!options.builds.supports(map.game)) {
    throw new ServiceHttpError(
      503,
      `No ${map.game} build worker is configured`,
    );
  }
  const snapshot = await options.maps.snapshot(map.id);
  if (
    input.expectedMapVersion !== undefined &&
    input.expectedMapVersion !== snapshot.mapVersion
  ) {
    throw new ServiceHttpError(
      409,
      "The hosted map has not saved this revision yet; wait a moment and try again",
    );
  }
  if (
    new TextEncoder().encode(snapshot.source).byteLength > MAX_HOSTED_MAP_BYTES
  ) {
    throw new ServiceHttpError(
      413,
      "Hosted builds are limited to 2 MiB map sources",
    );
  }
  const admission = options.database.buildAdmission(input.userId);
  if (admission !== "allowed") throw admissionError(admission);
  let resources;
  try {
    const mounts =
      options.database.listResourceMounts(map.projectId, input.userId) ?? [];
    const profile = hostedBuildProfile(map.game);
    resources =
      profile.resourceLayout === "game-tree"
        ? await prepareGameTreeBuildResources(
            snapshot.source,
            mounts,
            options.blobs,
            profile,
          )
        : await prepareWadBuildResources(
            snapshot.source,
            profile.wadGame,
            mounts,
            options.blobs,
          );
  } catch (error) {
    throw new ServiceHttpError(
      422,
      error instanceof Error ? error.message : String(error),
    );
  }
  const afterResources = options.database.buildAdmission(input.userId);
  if (afterResources !== "allowed") throw admissionError(afterResources);
  const build = options.database.createBuild({
    mapId: map.id,
    userId: input.userId,
    mapVersion: snapshot.mapVersion,
    profileId: "default",
    quality: input.quality,
  });
  const queued = options.builds.enqueue({
    id: build.id,
    game: map.game,
    mapName: map.name,
    source: resources.mapText,
    mapVersion: snapshot.mapVersion,
    sourceSha256: snapshot.sourceSha256,
    profileId: "default",
    quality: input.quality,
    assets: resources.assets,
  });
  if (!queued) {
    options.database.updateBuild(build.id, "failed", {
      error: "Build queue is full",
    });
    throw new ServiceHttpError(429, "The build queue is full");
  }
  return build;
}
