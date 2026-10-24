import {
  CreateHostedBuildRequestSchema,
  HostedBuildCreatedResponseSchema,
  HostedBuildsResponseSchema,
} from "@tea/maps-protocol";

import { submitHostedBuild } from "../hosted-build-operation.js";
import { hostedBuildProfile } from "../hosted-game-profiles.js";
import { ServiceHttpError } from "../service-http.js";
import { defineWebRoute, pathParameter } from "../service-routing.js";
import {
  rejectCrossOriginMutation,
  requireWebUser,
  webError,
  webJson,
  webRequestBody,
} from "../service-web-http.js";
import type { MapsServiceOptions } from "../service-options.js";

export function createBuildRoutes(
  options: Pick<MapsServiceOptions, "blobs" | "builds" | "database" | "maps">,
) {
  return [
    defineWebRoute(
      "list-map-builds",
      "GET",
      /^\/api\/maps\/([^/]+)\/builds$/,
      (context, match) => {
        const user = requireWebUser(context, options.database);
        const mapId = pathParameter(match, 0);
        const map = options.database.map(mapId, user.id);
        if (!map) return webError(404, "Map not found");
        return webJson(200, HostedBuildsResponseSchema, {
          builds: [...(options.database.listBuilds(mapId, user.id) ?? [])],
          capability: options.builds?.supports(map.game)
            ? {
                profileId: "default",
                durationHint: hostedBuildProfile(map.game).durationHint,
              }
            : null,
        });
      },
    ),
    defineWebRoute(
      "create-map-build",
      "POST",
      /^\/api\/maps\/([^/]+)\/builds$/,
      async (context, match) => {
        const denied = rejectCrossOriginMutation(context);
        if (denied) return denied;
        const user = requireWebUser(context, options.database);
        const input = await webRequestBody(
          context.request,
          CreateHostedBuildRequestSchema,
        );
        try {
          const build = await submitHostedBuild(options, {
            mapId: pathParameter(match, 0),
            userId: user.id,
            quality: input.quality,
            ...(input.expectedMapVersion !== undefined
              ? { expectedMapVersion: input.expectedMapVersion }
              : {}),
          });
          return webJson(202, HostedBuildCreatedResponseSchema, { build });
        } catch (error) {
          if (!(error instanceof ServiceHttpError)) throw error;
          const headers = new Headers();
          if (error.status === 429) {
            headers.set(
              "Retry-After",
              error.message === "Build limit reached; try again later"
                ? "3600"
                : "30",
            );
          }
          return webError(error.status, error.message, headers);
        }
      },
    ),
    defineWebRoute(
      "get-build-artifact",
      "GET",
      /^\/api\/maps\/([^/]+)\/builds\/([^/]+)\/artifacts\/([a-f0-9]{64})$/,
      async (context, match) => {
        const user = requireWebUser(context, options.database);
        const build = options.database.build(
          pathParameter(match, 0),
          pathParameter(match, 1),
          user.id,
        );
        const sha256 = pathParameter(match, 2);
        const artifact = build?.result?.artifacts?.find(
          (candidate) => candidate.sha256 === sha256,
        );
        if (!artifact) return webError(404, "Build artifact not found");
        const bytes = await options.blobs.get(artifact.sha256);
        if (!bytes) return webError(404, "Build artifact data not found");
        return new Response(new Uint8Array(bytes), {
          status: 200,
          headers: {
            "Content-Type": artifact.mediaType,
            "Content-Length": String(bytes.byteLength),
            "Cache-Control": "private, max-age=31536000, immutable",
          },
        });
      },
    ),
  ] as const;
}
