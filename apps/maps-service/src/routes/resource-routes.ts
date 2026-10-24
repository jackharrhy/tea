import { Readable } from "node:stream";
import {
  HostedAssetSearchResponseSchema,
  HostedResourceMountedResponseSchema,
  HostedResourceMountsResponseSchema,
  MountHostedAssetRequestSchema,
} from "@tea/maps-protocol";

import { defineWebRoute, pathParameter } from "../service-routing.js";
import {
  rejectCrossOriginMutation,
  requireWebUser,
  webBodyChunks,
  webError,
  webJson,
  webOk,
  webRequestBody,
} from "../service-web-http.js";
import {
  RESOURCE_KINDS,
  resourceName,
  resourcePathMatchesKind,
} from "../resource-input.js";
import { MAX_RESOURCE_FILE_BYTES } from "../resource-limits.js";
import type { MapsServiceOptions } from "../service-options.js";

export function createResourceRoutes(
  options: Pick<MapsServiceOptions, "artbin" | "blobs" | "database">,
) {
  return [
    defineWebRoute(
      "search-assets",
      "GET",
      "/api/assets/search",
      async (context) => {
        requireWebUser(context, options.database);
        if (!options.artbin) {
          return webError(503, "Artbin integration is not configured");
        }
        const parameters = new URLSearchParams();
        for (const key of ["q", "kind", "folderId", "tag", "cursor", "limit"]) {
          const value = context.url.searchParams.get(key);
          if (value) parameters.set(key, value);
        }
        return webJson(
          200,
          HostedAssetSearchResponseSchema,
          await options.artbin.search(parameters),
        );
      },
    ),
    defineWebRoute(
      "list-project-resources",
      "GET",
      /^\/api\/projects\/([^/]+)\/resources$/,
      (context, match) => {
        const user = requireWebUser(context, options.database);
        const mounts = options.database.listResourceMounts(
          pathParameter(match, 0),
          user.id,
        );
        if (!mounts) return webError(404, "Project not found");
        return webJson(200, HostedResourceMountsResponseSchema, {
          mounts: [...mounts],
        });
      },
    ),
    defineWebRoute(
      "mount-project-resource",
      "POST",
      /^\/api\/projects\/([^/]+)\/resources$/,
      async (context, match) => {
        const denied = rejectCrossOriginMutation(context);
        if (denied) return denied;
        const user = requireWebUser(context, options.database);
        const projectId = pathParameter(match, 0);
        if (options.database.role(projectId, user.id) !== "owner") {
          return webError(403, "Owner access required");
        }
        if (!options.artbin) {
          return webError(503, "Artbin integration is not configured");
        }
        const { assetId } = await webRequestBody(
          context.request,
          MountHostedAssetRequestSchema,
        );
        const { asset } = await options.artbin.metadata(assetId);
        if (asset.size > MAX_RESOURCE_FILE_BYTES) {
          return webError(
            413,
            "Project assets must be at most 512 MiB per file",
          );
        }
        if (!asset.sha256 || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
          return webError(422, "Artbin asset has no stable SHA-256");
        }
        const stored = await options.blobs.putStream(
          await options.artbin.contentStream(asset.id, asset.sha256),
          MAX_RESOURCE_FILE_BYTES,
        );
        if (stored.size !== asset.size || stored.sha256 !== asset.sha256) {
          return webError(422, "Artbin asset size changed during import");
        }
        const mount = options.database.createResourceMount({
          projectId,
          userId: user.id,
          provider: "artbin",
          providerAssetId: asset.id,
          expectedSha256: asset.sha256,
          kind: asset.kind,
          displayName: asset.name,
          size: stored.size,
          metadata: { mimeType: asset.mimeType, size: asset.size },
        });
        if (!mount) return webError(403, "Owner access required");
        return webJson(201, HostedResourceMountedResponseSchema, { mount });
      },
    ),
    defineWebRoute(
      "upload-project-resource",
      "PUT",
      /^\/api\/projects\/([^/]+)\/resources\/upload$/,
      async (context, match) => {
        const denied = rejectCrossOriginMutation(context);
        if (denied) return denied;
        const user = requireWebUser(context, options.database);
        const projectId = pathParameter(match, 0);
        if (options.database.role(projectId, user.id) !== "owner") {
          return webError(403, "Owner access required");
        }
        const name = resourceName(context.url.searchParams.get("name"));
        const kind = context.url.searchParams.get("kind");
        if (!name || !kind || !RESOURCE_KINDS.has(kind)) {
          return webError(400, "Choose a supported resource name and kind");
        }
        if (!resourcePathMatchesKind(name, kind)) {
          return webError(400, "Choose a safe textures/ or env/ asset path");
        }
        const declaredSize = Number(
          context.request.headers.get("content-length") ?? 0,
        );
        if (
          !Number.isSafeInteger(declaredSize) ||
          declaredSize > MAX_RESOURCE_FILE_BYTES
        ) {
          return webError(
            413,
            "Project assets must be at most 512 MiB per file",
          );
        }
        const stored = await options.blobs.putStream(
          webBodyChunks(context.request),
          MAX_RESOURCE_FILE_BYTES,
        );
        const mount = options.database.createResourceMount({
          projectId,
          userId: user.id,
          provider: "upload",
          providerAssetId: stored.sha256,
          expectedSha256: stored.sha256,
          kind,
          displayName: name,
          size: stored.size,
          metadata: {
            mimeType:
              context.request.headers.get("content-type") ??
              "application/octet-stream",
          },
        });
        if (!mount) return webError(403, "Owner access required");
        return webJson(201, HostedResourceMountedResponseSchema, { mount });
      },
    ),
    defineWebRoute(
      "delete-project-resource",
      "DELETE",
      /^\/api\/projects\/([^/]+)\/resources\/([^/]+)$/,
      (context, match) => {
        const denied = rejectCrossOriginMutation(context);
        if (denied) return denied;
        const user = requireWebUser(context, options.database);
        const removed = options.database.deleteResourceMount(
          pathParameter(match, 0),
          pathParameter(match, 1),
          user.id,
        );
        return removed ? webOk() : webError(403, "Owner access required");
      },
    ),
    defineWebRoute(
      "get-project-resource-content",
      "GET",
      /^\/api\/projects\/([^/]+)\/resources\/([^/]+)\/content$/,
      async (context, match) => {
        const user = requireWebUser(context, options.database);
        const mount = options.database.resourceMount(
          pathParameter(match, 0),
          pathParameter(match, 1),
          user.id,
        );
        if (!mount) return webError(404, "Resource not found");
        const opened = await options.blobs.openStream(mount.expectedSha256);
        if (!opened) {
          return webError(503, "Pinned resource cache is unavailable");
        }
        return new Response(Readable.toWeb(opened.body) as ReadableStream, {
          status: 200,
          headers: {
            "Content-Type":
              typeof mount.metadata.mimeType === "string"
                ? mount.metadata.mimeType
                : "application/octet-stream",
            "Content-Length": String(opened.size),
            "Cache-Control": "private, max-age=31536000, immutable",
            ETag: `"${mount.expectedSha256}"`,
          },
        });
      },
    ),
  ] as const;
}
