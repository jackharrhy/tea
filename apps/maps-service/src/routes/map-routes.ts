import {
  CreateHostedCheckpointRequestSchema,
  HostedCheckpointResponseSchema,
  HostedCheckpointsResponseSchema,
  HostedCheckpointSourceResponseSchema,
  HostedMapResponseSchema,
  HostedRealtimeTicketResponseSchema,
  ReplaceHostedMapSourceRequestSchema,
  ReplaceHostedMapSourceResultSchema,
} from "@tea/maps-protocol";
import { parseMapSource } from "@tea/maps-editor/core";

import { canEditProject } from "../access-policy.js";
import { signRealtimeTicket } from "../realtime-ticket.js";
import { MAX_HOSTED_MAP_BYTES } from "../service-http.js";
import { defineWebRoute, pathParameter } from "../service-routing.js";
import {
  rejectCrossOriginMutation,
  requireWebUser,
  webError,
  webJson,
  webRequestBody,
} from "../service-web-http.js";
import type { MapsServiceOptions } from "../service-options.js";

export function createMapRoutes(
  options: Pick<
    MapsServiceOptions,
    "database" | "maps" | "realtimeTicketSecret"
  >,
) {
  return [
    defineWebRoute(
      "get-map-checkpoint-source",
      "GET",
      /^\/api\/maps\/([^/]+)\/checkpoints\/([^/]+)$/,
      async (context, match) => {
        const user = requireWebUser(context, options.database);
        const mapId = pathParameter(match, 0);
        if (!options.database.map(mapId, user.id)) {
          return webError(404, "Map not found");
        }
        const snapshot = await options.maps.checkpointSource(
          mapId,
          pathParameter(match, 1),
        );
        return snapshot
          ? webJson(200, HostedCheckpointSourceResponseSchema, snapshot)
          : webError(404, "Checkpoint not found");
      },
    ),
    defineWebRoute(
      "list-map-checkpoints",
      "GET",
      /^\/api\/maps\/([^/]+)\/checkpoints$/,
      async (context, match) => {
        const user = requireWebUser(context, options.database);
        const mapId = pathParameter(match, 0);
        if (!options.database.map(mapId, user.id)) {
          return webError(403, "Project access required");
        }
        const checkpoints = await options.maps.listCheckpoints(mapId);
        return webJson(200, HostedCheckpointsResponseSchema, {
          checkpoints: [...checkpoints],
        });
      },
    ),
    defineWebRoute(
      "get-map",
      "GET",
      /^\/api\/maps\/([^/]+)$/,
      async (context, match) => {
        const user = requireWebUser(context, options.database);
        const map = options.database.map(pathParameter(match, 0), user.id);
        if (!map) return webError(404, "Map not found");
        const snapshot = await options.maps.snapshot(map.id);
        return webJson(200, HostedMapResponseSchema, {
          map: {
            ...map,
            ...snapshot,
            actorId: user.id,
            displayName: user.displayName,
          },
        });
      },
    ),
    defineWebRoute(
      "replace-map-source",
      "PUT",
      /^\/api\/projects\/([^/]+)\/maps\/([^/]+)\/source$/,
      async (context, match) => {
        const denied = rejectCrossOriginMutation(context);
        if (denied) return denied;
        const user = requireWebUser(context, options.database);
        const projectId = pathParameter(match, 0);
        const mapId = pathParameter(match, 1);
        const map = options.database.map(mapId, user.id);
        if (!map || map.projectId !== projectId) {
          return webError(404, "Map not found in project");
        }
        if (!canEditProject(map.role)) {
          return webError(403, "Editor access required");
        }
        const input = await webRequestBody(
          context.request,
          ReplaceHostedMapSourceRequestSchema,
          2 * MAX_HOSTED_MAP_BYTES + 1024,
        );
        if (Buffer.byteLength(input.source) > MAX_HOSTED_MAP_BYTES) {
          return webError(413, "Hosted maps are limited to 2 MiB of source");
        }
        try {
          if (parseMapSource(input.source).document.faceSyntax !== map.format) {
            return webError(
              400,
              "Map face syntax does not match the hosted map",
            );
          }
        } catch (error) {
          return webError(
            400,
            `Invalid map source: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        const result = await options.maps.replaceSource(
          mapId,
          user.id,
          input.expectedMapVersion,
          input.expectedSourceSha256,
          input.source,
        );
        return webJson(
          result.status === "replaced" ? 200 : 409,
          ReplaceHostedMapSourceResultSchema,
          result,
        );
      },
    ),
    defineWebRoute(
      "create-map-checkpoint",
      "POST",
      /^\/api\/maps\/([^/]+)\/checkpoints$/,
      async (context, match) => {
        const denied = rejectCrossOriginMutation(context);
        if (denied) return denied;
        const user = requireWebUser(context, options.database);
        const input = await webRequestBody(
          context.request,
          CreateHostedCheckpointRequestSchema,
        );
        const mapId = pathParameter(match, 0);
        const map = options.database.map(mapId, user.id);
        if (!map || !canEditProject(map.role)) {
          return webError(403, "Editor access required");
        }
        const checkpoint = await options.maps.createCheckpoint(
          mapId,
          input.name,
          user.id,
        );
        return webJson(201, HostedCheckpointResponseSchema, { checkpoint });
      },
    ),
    defineWebRoute(
      "create-realtime-ticket",
      "POST",
      /^\/api\/maps\/([^/]+)\/realtime-ticket$/,
      (context, match) => {
        const denied = rejectCrossOriginMutation(context);
        if (denied) return denied;
        const user = requireWebUser(context, options.database);
        const map = options.database.map(pathParameter(match, 0), user.id);
        if (!map) return webError(404, "Map not found");
        const expiresAt = Date.now() + 60_000;
        return webJson(201, HostedRealtimeTicketResponseSchema, {
          ticket: signRealtimeTicket(
            {
              version: 2,
              mapId: map.id,
              principalId: user.id,
              actorId: user.id,
              role: map.role,
              expiresAt,
            },
            options.realtimeTicketSecret,
          ),
          expiresAt,
          actorId: user.id,
          displayName: user.displayName,
        });
      },
    ),
  ] as const;
}
