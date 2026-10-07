import { z } from "zod";
import { mcpResourceUrl, mcpScope, requireMcpAdmin } from "../mcp-auth.js";
import { mcpOperationsByName, mcpToolDescriptions } from "../mcp-operations.js";
import { ServiceHttpError } from "../service-http.js";
import { defineWebRoute } from "../service-routing.js";
import { webError, webRequestBody } from "../service-web-http.js";
import type { WorldviewServiceOptions } from "../service-options.js";

const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
const RpcRequestSchema = z.strictObject({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
});

function rpcResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function createMcpRoutes(options: WorldviewServiceOptions) {
  const scope = mcpScope(options.mcpAuth);
  return [
    defineWebRoute(
      "mcp-protected-resource",
      "GET",
      "/.well-known/oauth-protected-resource/mcp",
      () => {
        if (!options.mcpAuth) {
          return webError(503, "Tea Maps MCP is not configured");
        }
        return new Response(
          JSON.stringify({
            resource: mcpResourceUrl(options.mcpAuth),
            authorization_servers: [options.mcpAuth.fourmUrl],
            bearer_methods_supported: ["header"],
            scopes_supported: ["openid", scope],
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=300",
            },
          },
        );
      },
    ),
    defineWebRoute("mcp-get", "GET", "/mcp", () =>
      webError(
        405,
        "MCP SSE streams are not offered",
        new Headers({ Allow: "POST" }),
      ),
    ),
    defineWebRoute("mcp-post", "POST", "/mcp", async (context) => {
      const config = options.mcpAuth;
      if (!config) return webError(503, "Tea Maps MCP is not configured");
      const origin = context.request.headers.get("origin");
      if (
        (origin && origin !== config.publicUrl) ||
        context.request.headers.get("host") !== new URL(config.publicUrl).host
      ) {
        return webError(403, "Tea Maps MCP origin is not allowed");
      }
      let user;
      try {
        user = await requireMcpAdmin(
          context.request.headers.get("authorization") ?? undefined,
          config,
          options.database,
          options.fetch,
        );
      } catch (error) {
        if (!(error instanceof ServiceHttpError)) throw error;
        const headers = new Headers();
        if (error.status === 401) {
          headers.set(
            "WWW-Authenticate",
            `Bearer resource_metadata="${config.publicUrl}/.well-known/oauth-protected-resource/mcp", scope="openid ${scope}"`,
          );
        }
        return webError(error.status, error.message, headers);
      }
      const request = await webRequestBody(
        context.request,
        RpcRequestSchema,
        3 * 1024 * 1024,
      );
      if (!Object.hasOwn(request, "id")) {
        return new Response(null, {
          status: request.method === "notifications/initialized" ? 202 : 400,
          headers: { "Cache-Control": "no-store" },
        });
      }
      const id = request.id ?? null;
      if (request.method === "initialize") {
        const requested = request.params?.protocolVersion;
        const version =
          typeof requested === "string" &&
          SUPPORTED_VERSIONS.includes(requested as never)
            ? requested
            : SUPPORTED_VERSIONS[0];
        return rpcResponse({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: version,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "tea-maps", version: "0.1.0" },
          },
        });
      }
      const protocolVersion = context.request.headers.get(
        "mcp-protocol-version",
      );
      if (
        protocolVersion &&
        !SUPPORTED_VERSIONS.includes(protocolVersion as never)
      ) {
        return webError(400, "Unsupported MCP protocol version");
      }
      if (request.method === "tools/list") {
        return rpcResponse({
          jsonrpc: "2.0",
          id,
          result: { tools: mcpToolDescriptions },
        });
      }
      if (request.method === "tools/call") {
        const name = String(request.params?.name ?? "");
        const tool = mcpOperationsByName.get(name);
        if (!tool) {
          return rpcResponse({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: `Unknown tool: ${name}` }],
              isError: true,
            },
          });
        }
        try {
          const value = await tool.execute(
            options,
            user,
            request.params?.arguments ?? {},
          );
          return rpcResponse({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
              structuredContent: value,
            },
          });
        } catch (error) {
          const message =
            error instanceof ServiceHttpError || error instanceof z.ZodError
              ? error.message
              : "Tool failed";
          if (
            !(error instanceof ServiceHttpError || error instanceof z.ZodError)
          ) {
            console.error("Tea Maps MCP tool failed", error);
          }
          return rpcResponse({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: message }],
              isError: true,
            },
          });
        }
      }
      return rpcResponse({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: "Method not found" },
      });
    }),
  ] as const;
}
