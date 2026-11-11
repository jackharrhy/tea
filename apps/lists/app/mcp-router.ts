import { IdentityError } from "@tea/identity";
import { createRouter } from "remix/router";
import { z } from "zod";

import type { Config } from "../src/config.ts";
import type { Db } from "../src/db/index.ts";
import { mcpOperations, mcpTools } from "../src/operations/catalog.ts";
import {
  authenticateBearer,
  createCentralBearerAuth,
} from "../src/services/request-auth.ts";

const RpcRequest = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

const versions = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;

function result(id: unknown, value: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result: value };
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export function createMcpRouter(db: Db, config: Config) {
  const router = createRouter();
  const central = config.identity ? createCentralBearerAuth(db, config) : null;

  async function handle(request: Request) {
    let principal;
    try {
      principal = central
        ? await central(request)
        : authenticateBearer(db, request, `${config.baseUrl}/mcp`);
    } catch (error) {
      const status = error instanceof IdentityError ? error.status : 503;
      return Response.json(rpcError(null, -32001, "Unauthorized"), {
        status,
        headers:
          status === 401
            ? {
                "WWW-Authenticate": `Bearer resource_metadata="${config.baseUrl}/.well-known/oauth-protected-resource"`,
              }
            : undefined,
      });
    }
    if (!principal) {
      return Response.json(rpcError(null, -32001, "Unauthorized"), {
        status: 401,
        headers: {
          "WWW-Authenticate": `Bearer resource_metadata="${config.baseUrl}/.well-known/oauth-protected-resource"`,
        },
      });
    }
    if (request.method === "GET")
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "POST" },
      });
    let parsed: z.infer<typeof RpcRequest>;
    try {
      parsed = RpcRequest.parse(await request.json());
    } catch {
      return Response.json(rpcError(null, -32600, "Invalid Request"), {
        status: 400,
      });
    }
    if (parsed.method === "initialize") {
      const requested = parsed.params?.protocolVersion;
      const protocolVersion =
        typeof requested === "string" &&
        versions.includes(requested as (typeof versions)[number])
          ? requested
          : versions[0];
      return Response.json(
        result(parsed.id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "lists", version: "1.0.0" },
        }),
      );
    }
    if (parsed.method === "notifications/initialized")
      return new Response(null, { status: 202 });
    if (parsed.method === "tools/list")
      return Response.json(result(parsed.id, { tools: mcpTools }));
    if (parsed.method === "tools/call") {
      const params = parsed.params ?? {};
      try {
        const operation = mcpOperations.get(String(params.name ?? ""));
        if (!operation)
          throw new Error(`Unknown tool: ${String(params.name ?? "")}`);
        const value = await operation.execute(
          { db, config, principal },
          params.arguments ?? {},
        );
        return Response.json(
          result(parsed.id, {
            content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
            structuredContent: value,
          }),
        );
      } catch (error) {
        return Response.json(
          result(parsed.id, {
            content: [
              {
                type: "text",
                text: error instanceof Error ? error.message : "Tool failed",
              },
            ],
            isError: true,
          }),
        );
      }
    }
    return Response.json(rpcError(parsed.id, -32601, "Method not found"));
  }

  router.get("/mcp", ({ request }) => handle(request));
  router.get("/mcp/", ({ request }) => handle(request));
  router.post("/mcp", ({ request }) => handle(request));
  router.post("/mcp/", ({ request }) => handle(request));
  return router;
}
