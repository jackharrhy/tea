export { MapCell } from "./map-cell.js";

import { createController, createRouter } from "remix/router";
import {
  MapCellCheckpointRequestSchema,
  MapCellInitializeRequestSchema,
  ReplaceHostedMapSourceRequestSchema,
} from "@tea/maps-protocol";
import { verifyHostedRealtimeTicket } from "./realtime-ticket.js";
import { routes } from "./routes.js";

const corsHeaders = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Origin": "*",
} as const;

type MapAction =
  | "snapshot"
  | "live"
  | "initialize"
  | "checkpoints"
  | "checkpointSource"
  | "createCheckpoint"
  | "source";

function json(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  for (const [name, content] of Object.entries(corsHeaders))
    headers.set(name, content);
  return Response.json(value, { ...init, headers });
}

async function handleMap(
  request: Request,
  mapId: string,
  action: MapAction,
  env: Env,
  checkpointId?: string,
): Promise<Response> {
  if (mapId.length > 128) return json({ error: "Not found" }, { status: 404 });
  const url = new URL(request.url);
  const authorization = request.headers.get("Authorization");
  const ticketValue = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : url.searchParams.get("access_token");
  const ticket = ticketValue
    ? await verifyHostedRealtimeTicket(
        ticketValue,
        env.TEA_MAPS_REALTIME_TICKET_SECRET,
      )
    : null;
  if (!ticket || ticket.mapId !== mapId) {
    return json(
      { error: "A valid hosted-map ticket is required" },
      { status: 401 },
    );
  }
  if (request.method !== "GET" && ticket.role === "viewer") {
    return json({ error: "Editor access is required" }, { status: 403 });
  }
  url.searchParams.delete("access_token");
  url.searchParams.set("actor", ticket.actorId);
  url.searchParams.set("role", ticket.role);
  const stub = env.MAP_CELLS.getByName(mapId);

  if (action === "initialize") {
    const input = MapCellInitializeRequestSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!input.success)
      return json({ error: "Map source is required" }, { status: 400 });
    return json(await stub.initialize(mapId, input.data.source));
  }
  if (action === "snapshot") return json(await stub.snapshot(mapId));
  if (action === "source") {
    const input = ReplaceHostedMapSourceRequestSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!input.success) {
      return json(
        { error: "Valid map source and version are required" },
        { status: 400 },
      );
    }
    const result = await stub.replaceSource(
      mapId,
      ticket.actorId,
      input.data.expectedMapVersion,
      input.data.expectedSourceSha256,
      input.data.source,
    );
    return json(result, { status: result.status === "conflict" ? 409 : 200 });
  }
  if (action === "checkpoints")
    return json({ checkpoints: await stub.listCheckpoints() });
  if (action === "checkpointSource") {
    if (!checkpointId || checkpointId.length > 128)
      return json({ error: "Checkpoint not found" }, { status: 404 });
    const snapshot = await stub.checkpointSource(checkpointId);
    return snapshot
      ? json(snapshot)
      : json({ error: "Checkpoint not found" }, { status: 404 });
  }
  if (action === "createCheckpoint") {
    const input = MapCellCheckpointRequestSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!input.success) {
      return json({ error: "Checkpoint name is required" }, { status: 400 });
    }
    return json({
      checkpoint: await stub.createCheckpoint(ticket.actorId, input.data.name),
    });
  }
  url.searchParams.set("map", mapId);
  return stub.fetch(new Request(url, request));
}

function createAppRouter(env: Env) {
  const router = createRouter();
  router.map(
    routes,
    createController(routes, {
      actions: {
        health: () => json({ ok: true }),
        snapshot: (context) =>
          handleMap(context.request, context.params.mapId, "snapshot", env),
        live: (context) =>
          handleMap(context.request, context.params.mapId, "live", env),
        initialize: (context) =>
          handleMap(context.request, context.params.mapId, "initialize", env),
        checkpoints: (context) =>
          handleMap(context.request, context.params.mapId, "checkpoints", env),
        checkpointSource: (context) =>
          handleMap(
            context.request,
            context.params.mapId,
            "checkpointSource",
            env,
            context.params.checkpointId,
          ),
        createCheckpoint: (context) =>
          handleMap(
            context.request,
            context.params.mapId,
            "createCheckpoint",
            env,
          ),
        source: (context) =>
          handleMap(context.request, context.params.mapId, "source", env),
      },
    }),
  );
  return router;
}

export default {
  async fetch(request, env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    try {
      const response = await createAppRouter(env).fetch(request);
      if (response.status === 101) return response;
      const headers = new Headers(response.headers);
      for (const [name, content] of Object.entries(corsHeaders))
        headers.set(name, content);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "Collaboration request failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return json({ error: "Collaboration request failed" }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
