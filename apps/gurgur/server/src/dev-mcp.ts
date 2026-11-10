import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { RuntimeEntityRef, RuntimeId, Vec3 } from "@tea/gurgur-engine";
import * as z from "zod/v4";
import { type DevPlayerIntentUpdate, type WorldHost } from "./game";
import { runtimeBodyRef } from "./runtime-bodies";

const MAX_REQUEST_BYTES = 1_048_576;
const DEFAULT_BODY_LIMIT = 64;

const coordinate = z.number().finite().min(-100_000).max(100_000);
const vec3Schema = z
  .object({ x: coordinate, y: coordinate, z: coordinate })
  .strict()
  .describe("A Y-up position or vector in metres");
const runtimeIdSchema = z
  .object({
    index: z.number().int().min(0),
    generation: z.number().int().min(0),
  })
  .strict();
const nearbySchema = {
  near: vec3Schema.optional(),
  radius: z.number().finite().positive().max(10_000).optional(),
};

export type DevMcpListener = {
  port: number;
  url: string;
  stop(): void;
};

export type DevMcpOptions = {
  game: WorldHost;
  port: number;
  connectedNetworkPlayers(): RuntimeId[];
  created(entity: RuntimeEntityRef): void;
  removed(id: RuntimeId): void;
};

export function createDevMcpListener(options: DevMcpOptions): DevMcpListener {
  if (
    !Number.isInteger(options.port) ||
    options.port < 0 ||
    options.port > 65_535
  )
    throw new Error("dev MCP port must be an integer between 0 and 65535");

  const listener = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port,
    async fetch(request) {
      if (!safeLoopbackRequest(request))
        return new Response("forbidden", { status: 403 });
      const url = new URL(request.url);
      if (url.pathname === "/healthz")
        return Response.json(
          {
            status: "ok",
            transport: "streamable-http",
            endpoint: "/mcp",
            worldEpoch: options.game.worldEpoch,
            serverTick: options.game.serverTick,
          },
          { headers: { "cache-control": "no-store" } },
        );
      if (url.pathname !== "/mcp")
        return new Response("not found", { status: 404 });
      const declaredLength = Number(request.headers.get("content-length") ?? 0);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES)
        return new Response("request too large", { status: 413 });

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      const mcp = createMcpServer(options);
      try {
        await mcp.connect(transport);
        const response = await transport.handleRequest(request);
        queueMicrotask(() => void mcp.close());
        return response;
      } catch (error) {
        void mcp.close();
        return Response.json(
          {
            jsonrpc: "2.0",
            error: {
              code: -32_603,
              message:
                error instanceof Error ? error.message : "internal MCP error",
            },
            id: null,
          },
          { status: 500 },
        );
      }
    },
  });
  const port = listener.port ?? options.port;
  return {
    port,
    url: `http://127.0.0.1:${port}/mcp`,
    stop: () => listener.stop(true),
  };
}

function createMcpServer(options: DevMcpOptions): McpServer {
  const mcp = new McpServer(
    { name: "gurgur-dev-world", version: "1.0.0" },
    {
      instructions:
        "This is an ephemeral development control plane for Gurgur's host world. " +
        "Coordinates are metres in a right-handed Y-up world; player positions are capsule centres; " +
        "angles are radians. MCP player movement automatically stops after at most five seconds. " +
        "Spawned players and props are excluded from persistence and removed on world reset.",
    },
  );

  mcp.registerTool(
    "get_world_state",
    {
      title: "Get host world state",
      description:
        "Read the current map revision, epoch, fixed server tick, gravity, body counts, and every player pose.",
      annotations: readOnlyAnnotations,
    },
    () => {
      const world = readWorld(options);
      return toolResult({
        mapRevision: world.mapRevision,
        worldEpoch: world.worldEpoch,
        serverTick: world.serverTick,
        gravity: world.gravity,
        playerCount: world.players.length,
        connectedNetworkPlayerCount: world.players.filter(
          (player) => player.control === "network" && player.connected,
        ).length,
        mcpPlayerCount: world.players.filter(
          (player) => player.control === "mcp",
        ).length,
        bodyCount: world.bodies.length,
        propCount: world.bodies.filter((body) => body.kind === "physics-prop")
          .length,
        ephemeralPropCount: world.bodies.filter((body) => body.ephemeral)
          .length,
        players: world.players,
      });
    },
  );

  mcp.registerTool(
    "list_players",
    {
      title: "List players",
      description:
        "List network-managed and MCP-controlled players with the host's latest accepted pose, movement state, and connection status. Optional proximity filtering uses capsule-centre positions.",
      inputSchema: z.object(nearbySchema).strict(),
      annotations: readOnlyAnnotations,
    },
    ({ near, radius }) => {
      const players = filterNearby(readWorld(options).players, near, radius);
      return toolResult({ players, count: players.length });
    },
  );

  mcp.registerTool(
    "list_props",
    {
      title: "List props",
      description:
        "List physics props and their complete host-accepted Box3D poses. Filter around a point to keep spatial probes compact.",
      inputSchema: z
        .object({
          ...nearbySchema,
          includeSleeping: z.boolean().default(true),
          limit: z.number().int().min(1).max(256).default(DEFAULT_BODY_LIMIT),
        })
        .strict(),
      annotations: readOnlyAnnotations,
    },
    ({ near, radius, includeSleeping, limit }) => {
      const candidates = filterNearby(
        readWorld(options).bodies.filter(
          (body) =>
            body.kind === "physics-prop" && (includeSleeping || body.awake),
        ),
        near,
        radius,
      );
      const props = candidates.slice(0, limit);
      return toolResult({
        props,
        count: props.length,
        truncated: candidates.length > limit,
      });
    },
  );

  mcp.registerTool(
    "list_prop_archetypes",
    {
      title: "List spawnable prop archetypes",
      description:
        "List compiled physics-prop entity indices that can be cloned into ephemeral host-owned props.",
      annotations: readOnlyAnnotations,
    },
    () => {
      const archetypes = options.game.devPropArchetypes();
      return toolResult({ archetypes, count: archetypes.length });
    },
  );

  mcp.registerTool(
    "raycast",
    {
      title: "Raycast the host world",
      description:
        "Cast a ray through the current Box3D world. Displacement is an offset from origin, not an endpoint.",
      inputSchema: z
        .object({
          origin: vec3Schema,
          displacement: vec3Schema,
        })
        .strict(),
      annotations: readOnlyAnnotations,
    },
    ({ origin, displacement }) =>
      toolResult({ hit: options.game.devRaycast(origin, displacement) }),
  );

  mcp.registerTool(
    "spawn_prop",
    {
      title: "Spawn an ephemeral prop",
      description:
        "Clone a compiled physics-prop archetype into the host Box3D world. Omit entityIndex to use the first available archetype.",
      inputSchema: z
        .object({
          entityIndex: z.number().int().min(0).optional(),
          position: vec3Schema,
          yaw: z.number().finite().min(-1_000_000).max(1_000_000).default(0),
        })
        .strict(),
      annotations: mutationAnnotations,
    },
    ({ entityIndex, position, yaw }) => {
      const selectedEntityIndex =
        entityIndex ?? options.game.devPropArchetypes()[0]?.entityIndex;
      if (selectedEntityIndex === undefined)
        throw new Error(
          "the current map has no spawnable physics-prop archetype",
        );
      const body = options.game.spawnDevProp(
        selectedEntityIndex,
        position,
        yaw,
      );
      options.created(runtimeBodyRef(body));
      const state = readWorld(options).bodies.find((candidate) =>
        sameId(candidate.id, body.id),
      );
      return toolResult({ prop: state ?? null });
    },
  );

  mcp.registerTool(
    "remove_spawned_prop",
    {
      title: "Remove an MCP-spawned prop",
      description:
        "Remove one ephemeral prop by generation-safe runtime ID. Authored and stress-test bodies cannot be removed.",
      inputSchema: z.object({ id: runtimeIdSchema }).strict(),
      annotations: mutationAnnotations,
    },
    ({ id }) => {
      const removed = options.game.removeDevProp(id);
      if (removed) options.removed(id);
      return toolResult({ removed, id });
    },
  );

  mcp.registerTool(
    "spawn_player",
    {
      title: "Spawn an MCP-controlled player",
      description:
        "Spawn an ephemeral host-owned player. Position is the capsule centre; omit it to use the default map spawn.",
      inputSchema: z
        .object({
          position: vec3Schema.optional(),
          yaw: z.number().finite().min(-1_000_000).max(1_000_000).optional(),
        })
        .strict(),
      annotations: mutationAnnotations,
    },
    ({ position, yaw }) => {
      const player = options.game.spawnDevPlayer(position, yaw);
      options.created({
        id: player.id,
        kind: "player",
        ownerPlayerId: null,
        authorityVersion: 1,
        transferPolicy: "fixed",
      });
      const state = readWorld(options).players.find((candidate) =>
        sameId(candidate.id, player.id),
      );
      return toolResult({
        controllerId: player.controllerId,
        player: state ?? null,
      });
    },
  );

  mcp.registerTool(
    "set_player_intent",
    {
      title: "Drive an MCP-controlled player",
      description:
        "Set newest-wins movement/look intent on an MCP player. moveZ is forward, moveX is strafe, and omitted fields retain their previous value. Movement auto-stops after durationSeconds (default 0.5, maximum 5). Actions are edge-triggered once.",
      inputSchema: z
        .object({
          controllerId: z.string().uuid(),
          moveX: z.number().finite().min(-1).max(1).optional(),
          moveZ: z.number().finite().min(-1).max(1).optional(),
          lookYaw: z
            .number()
            .finite()
            .min(-1_000_000)
            .max(1_000_000)
            .optional(),
          lookPitch: z
            .number()
            .finite()
            .min(-Math.PI / 2)
            .max(Math.PI / 2)
            .optional(),
          crouch: z.boolean().optional(),
          action: z.enum(["jump", "interact", "primary"]).optional(),
          interactTarget: runtimeIdSchema.nullable().optional(),
          durationSeconds: z.number().finite().min(0).max(5).default(0.5),
        })
        .strict(),
      annotations: mutationAnnotations,
    },
    (input) => {
      const update: DevPlayerIntentUpdate = {
        moveX: input.moveX,
        moveZ: input.moveZ,
        lookYaw: input.lookYaw,
        lookPitch: input.lookPitch,
        crouch: input.crouch,
        action: input.action,
        interactTarget: input.interactTarget,
        durationSeconds: input.durationSeconds,
      };
      return toolResult({
        player: options.game.setDevPlayerIntent(input.controllerId, update),
      });
    },
  );

  mcp.registerTool(
    "stop_player",
    {
      title: "Stop an MCP-controlled player",
      description:
        "Immediately clear movement and crouch intent for an MCP-controlled player.",
      inputSchema: z.object({ controllerId: z.string().uuid() }).strict(),
      annotations: mutationAnnotations,
    },
    ({ controllerId }) =>
      toolResult({ player: options.game.stopDevPlayer(controllerId) }),
  );

  mcp.registerTool(
    "remove_player",
    {
      title: "Remove an MCP-controlled player",
      description:
        "Disconnect and remove an ephemeral MCP-controlled player. Network-managed players cannot be removed.",
      inputSchema: z.object({ controllerId: z.string().uuid() }).strict(),
      annotations: mutationAnnotations,
    },
    ({ controllerId }) => {
      const id = options.game.removeDevPlayer(controllerId);
      if (id) options.removed(id);
      return toolResult({ removed: id !== null, id });
    },
  );

  return mcp;
}

function readWorld(options: DevMcpOptions) {
  return options.game.devWorldState(options.connectedNetworkPlayers());
}

function filterNearby<T extends { position: Vec3 }>(
  values: T[],
  near: Vec3 | undefined,
  radius: number | undefined,
): T[] {
  if (!near) return values;
  const maximum = radius ?? 25;
  return values.filter(
    (value) =>
      Math.hypot(
        value.position.x - near.x,
        value.position.y - near.y,
        value.position.z - near.z,
      ) <= maximum,
  );
}

function toolResult(value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function safeLoopbackRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname;
  return (
    request.headers.get("origin") === null &&
    (hostname === "127.0.0.1" || hostname === "localhost")
  );
}

function sameId(left: RuntimeId, right: RuntimeId): boolean {
  return left.index === right.index && left.generation === right.generation;
}

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const mutationAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;
