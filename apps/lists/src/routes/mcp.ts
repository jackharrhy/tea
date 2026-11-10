import { z } from "zod";
import { Elysia } from "elysia";
import type { Db } from "../db";
import type { Config } from "../config";
import { mcpOperations, mcpTools } from "../operations/catalog";
import { bearerAuth } from "./api-auth";

const RpcRequest = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
] as const;

function result(id: unknown, value: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result: value };
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export function mcpRoutes(db: Db, config: Config) {
  const app = new Elysia({ name: "mcp" })
    .use(
      bearerAuth(db, {
        config,
        unauthorizedBody: rpcError(null, -32001, "Unauthorized"),
        resourceMetadata: `${config.baseUrl}/.well-known/oauth-protected-resource`,
        expectedAudience: `${config.baseUrl}/mcp`,
      }),
    )
    .onError(({ code, status }) => {
      if (code === "VALIDATION")
        return status(400, rpcError(null, -32600, "Invalid Request"));
    });
  app.post(
    "/",
    async (c) => {
      const request = c.body;
      if (request.method === "initialize") {
        const requested =
          typeof request.params?.protocolVersion === "string"
            ? request.params.protocolVersion
            : null;
        const protocolVersion =
          requested &&
          SUPPORTED_PROTOCOL_VERSIONS.includes(
            requested as (typeof SUPPORTED_PROTOCOL_VERSIONS)[number],
          )
            ? requested
            : SUPPORTED_PROTOCOL_VERSIONS[0];
        return result(request.id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "lists", version: "1.0.0" },
        });
      }
      if (request.method === "notifications/initialized")
        return new Response(null, { status: 202 });
      if (request.method === "tools/list")
        return result(request.id, { tools: mcpTools });
      if (request.method === "tools/call") {
        const params = request.params ?? {};
        try {
          const operation = mcpOperations.get(String(params.name ?? ""));
          if (!operation)
            throw Object.assign(
              new Error(`Unknown tool: ${String(params.name ?? "")}`),
              { status: 404 },
            );
          const value = await operation.execute(
            { db, config, principal: c.principal },
            params.arguments ?? {},
          );
          return result(request.id, {
            content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
            structuredContent: value,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Tool failed";
          return result(request.id, {
            content: [{ type: "text", text: message }],
            isError: true,
          });
        }
      }
      return rpcError(request.id, -32601, "Method not found");
    },
    { authenticated: true, body: RpcRequest },
  );
  app.get(
    "/",
    ({ set, status }) => {
      set.headers.allow = "POST";
      return status(405, "Method Not Allowed");
    },
    { authenticated: true },
  );
  return app;
}
