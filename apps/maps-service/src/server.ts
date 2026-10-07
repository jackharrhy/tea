import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { createRequest, sendResponse } from "remix/node-fetch-server";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ArtbinClient } from "./artbin.js";
import { FileBlobStore } from "./blob-store.js";
import { RemoteBuildQueue } from "./build-queue.js";
import { WorldviewDatabase } from "./database.js";
import { MapCellClient } from "./map-cell-client.js";
import { createServiceRoutes } from "./routes/index.js";
import { createServiceDispatcher } from "./service-routing.js";
import { webError, webErrorFromUnknown } from "./service-web-http.js";
import type { WorldviewServiceOptions } from "./service-options.js";
import { serveStaticFile } from "./static-files.js";

export type {
  HostedMapStore,
  WorldviewServiceOptions,
} from "./service-options.js";

function configuredOrigin(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`Invalid Maps public origin: ${value}`);
  }
  return url.origin;
}

export function createWorldviewService(options: WorldviewServiceOptions) {
  const primaryPublicOrigin = configuredOrigin(options.oauth.publicUrl);
  const publicOriginsByHost = new Map(
    [primaryPublicOrigin, ...(options.additionalPublicOrigins ?? [])].map(
      (value) => {
        const origin = configuredOrigin(value);
        return [new URL(origin).host, origin];
      },
    ),
  );
  const routes = createServiceRoutes(options);
  const dispatch = createServiceDispatcher(routes);
  const server = createServer(
    { maxHeaderSize: 16 * 1024 },
    async (request, response) => {
      try {
        const publicOrigin =
          publicOriginsByHost.get(request.headers.host?.toLowerCase() ?? "") ??
          primaryPublicOrigin;
        const routed = await dispatch(
          createRequest(request, response, {
            host: new URL(publicOrigin).host,
            protocol: new URL(publicOrigin).protocol,
          }),
        );
        if (routed) {
          await sendResponse(response, routed);
          return;
        }
        if (options.staticRoot && request.method === "GET") {
          const staticResponse = await serveStaticFile(
            new URL(request.url ?? "/", publicOrigin).pathname,
            options.staticRoot,
          );
          if (staticResponse) {
            await sendResponse(response, staticResponse);
            return;
          }
        }
        await sendResponse(response, webError(404, "Not found"));
      } catch (error) {
        if (response.headersSent) response.destroy();
        else await sendResponse(response, webErrorFromUnknown(error));
      }
    },
  );
  server.requestTimeout = 10 * 60_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  return server;
}

function environment(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function configuredCompilerEndpoints(values: NodeJS.ProcessEnv) {
  return {
    ...(values.TEA_MAPS_QUAKE_COMPILER_URL
      ? { quake: values.TEA_MAPS_QUAKE_COMPILER_URL }
      : {}),
    ...(values.TEA_MAPS_GOLDSRC_COMPILER_URL
      ? { goldsrc: values.TEA_MAPS_GOLDSRC_COMPILER_URL }
      : {}),
    ...(values.TEA_MAPS_GOWER_COMPILER_URL
      ? { gower: values.TEA_MAPS_GOWER_COMPILER_URL }
      : {}),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dataRoot = environment("TEA_MAPS_DATA_ROOT", "./data/maps");
  mkdirSync(dataRoot, { recursive: true });
  const database = new WorldviewDatabase(join(dataRoot, "maps.db"));
  const blobs = new FileBlobStore(join(dataRoot, "blobs"));
  const buildEndpoints = configuredCompilerEndpoints(process.env);
  const service = createWorldviewService({
    database,
    blobs,
    additionalPublicOrigins: (
      process.env.TEA_MAPS_ADDITIONAL_PUBLIC_ORIGINS ?? ""
    )
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    oauth: {
      fourmUrl: environment("FOURM_URL", "http://127.0.0.1:8000"),
      clientId: environment("FOURM_CLIENT_ID", "maps"),
      publicUrl: environment("TEA_MAPS_URL", "http://localhost:8790"),
    },
    ...(process.env.TEA_MAPS_FOURM_INTROSPECTION_SECRET
      ? {
          mcpAuth: {
            fourmUrl: environment("FOURM_URL", "http://127.0.0.1:8000"),
            publicUrl: environment("TEA_MAPS_URL", "http://localhost:8790"),
            clientId: environment(
              "TEA_MAPS_FOURM_INTROSPECTION_CLIENT_ID",
              "tea-maps-service",
            ),
            clientSecret: process.env.TEA_MAPS_FOURM_INTROSPECTION_SECRET,
          },
        }
      : {}),
    ...(process.env.TEA_MAPS_STATIC_ROOT
      ? { staticRoot: process.env.TEA_MAPS_STATIC_ROOT }
      : {}),
    realtimeTicketSecret: environment(
      "TEA_MAPS_REALTIME_TICKET_SECRET",
      "tea-maps-local-realtime-ticket-secret-change-me",
    ),
    maps: new MapCellClient(
      environment("TEA_MAPS_COLLABORATION_URL", "http://127.0.0.1:8787"),
      environment(
        "TEA_MAPS_REALTIME_TICKET_SECRET",
        "tea-maps-local-realtime-ticket-secret-change-me",
      ),
    ),
    ...(process.env.ARTBIN_URL &&
    process.env.FOURM_SERVICE_CLIENT_ID &&
    process.env.FOURM_SERVICE_CLIENT_SECRET
      ? {
          artbin: new ArtbinClient({
            url: process.env.ARTBIN_URL,
            fourmUrl: environment("FOURM_URL", "http://127.0.0.1:8000"),
            clientId: process.env.FOURM_SERVICE_CLIENT_ID,
            clientSecret: process.env.FOURM_SERVICE_CLIENT_SECRET,
          }),
        }
      : {}),
    ...(Object.keys(buildEndpoints).length
      ? { builds: new RemoteBuildQueue(database, blobs, buildEndpoints) }
      : {}),
  });
  const port = Number(process.env.PORT ?? 8792);
  service.listen(port, process.env.HOST ?? "127.0.0.1", () =>
    console.log(`Tea Maps service listening on ${port}`),
  );
}
