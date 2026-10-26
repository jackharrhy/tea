import { identityConfig } from "#lib/oauth.server";
import { createController } from "remix/router";
import { createRequestLogger } from "evlog";
import { z, ZodError } from "zod";

import {
  mcpResourceUrl,
  requireMcpAdmin,
  mcpAuthorizationScopes,
} from "#lib/mcp-auth.server";

import { mcpOperations, mcpTools } from "../../operations/catalog.ts";
import { OperationError } from "../../operations/errors.ts";
import { routes } from "../../routes.ts";

const rpcRequest = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number(), z.null()]).optional(),
    method: z.string(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
] as const;

const initializeParams = z
  .object({
    protocolVersion: z.string(),
    capabilities: z.record(z.string(), z.unknown()),
    clientInfo: z.object({ name: z.string(), version: z.string() }).loose(),
  })
  .loose();

export default createController(routes.mcp, {
  actions: {
    async endpointGet({ request }) {
      const originError = validateOrigin(request);
      if (originError) return originError;
      const user = await requireMcpAdmin(request);
      if (user instanceof Response) return user;
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "POST", "Cache-Control": "no-store" },
      });
    },

    async endpoint({ request }) {
      const originError = validateOrigin(request);
      if (originError) return originError;
      const user = await requireMcpAdmin(request);
      if (user instanceof Response) return user;

      let parsed: z.output<typeof rpcRequest>;
      try {
        parsed = rpcRequest.parse(await request.json());
      } catch {
        return Response.json(rpcError(null, -32600, "Invalid Request"), {
          status: 400,
          headers: noStoreHeaders(),
        });
      }

      if (parsed.method !== "initialize") {
        const versionError = validateProtocolVersion(request);
        if (versionError) return versionError;
      }
      const isNotification = !Object.hasOwn(parsed, "id");
      if (isNotification) {
        if (parsed.method === "notifications/initialized") {
          return new Response(null, { status: 202, headers: noStoreHeaders() });
        }
        return new Response(null, { status: 400, headers: noStoreHeaders() });
      }

      if (parsed.method === "initialize") {
        const initialized = initializeParams.safeParse(parsed.params);
        if (!initialized.success) {
          return rpcResponse(rpcError(parsed.id, -32602, "Invalid params"));
        }
        const requested = initialized.data.protocolVersion;
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(
          requested as never,
        )
          ? requested
          : SUPPORTED_PROTOCOL_VERSIONS[0];
        return rpcResponse(
          result(parsed.id, {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "artbin", version: "1.0.0" },
          }),
        );
      }
      if (parsed.method === "tools/list") {
        return rpcResponse(result(parsed.id, { tools: mcpTools }));
      }
      if (parsed.method === "tools/call") {
        const name = String(parsed.params?.name ?? "");
        const log = createRequestLogger();
        log.set({ mcp: { tool: name, userId: user.id } });
        const operation = mcpOperations.get(name);
        if (!operation) {
          log.set({
            mcp: { tool: name, userId: user.id, outcome: "unknown-tool" },
          });
          log.emit();
          return rpcResponse(
            result(parsed.id, toolError(`Unknown tool: ${name}`)),
          );
        }
        try {
          const value = await operation.execute(
            { user, channel: "mcp" },
            parsed.params?.arguments ?? {},
          );
          log.set({ mcp: { tool: name, userId: user.id, outcome: "success" } });
          log.emit();
          return rpcResponse(
            result(parsed.id, {
              content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
              structuredContent: value,
            }),
          );
        } catch (error) {
          const expected =
            error instanceof OperationError || error instanceof ZodError;
          const message =
            error instanceof OperationError
              ? error.message
              : error instanceof ZodError
                ? "Operation input is invalid"
                : "Tool failed";
          if (expected) {
            log.set({
              mcp: { tool: name, userId: user.id, outcome: "rejected" },
            });
          } else {
            log.error(error instanceof Error ? error : new Error(message), {
              tool: name,
              userId: user.id,
            });
          }
          log.emit();
          return rpcResponse(result(parsed.id, toolError(message)));
        }
      }
      return rpcResponse(rpcError(parsed.id, -32601, "Method not found"));
    },

    protectedResource() {
      return Response.json(
        {
          resource: mcpResourceUrl(),
          authorization_servers: [identityConfig().issuer],
          bearer_methods_supported: ["header"],
          scopes_supported: mcpAuthorizationScopes(),
        },
        { headers: { "Cache-Control": "public, max-age=300" } },
      );
    },
  },
});

function result(id: unknown, value: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result: value };
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function toolError(message: string) {
  return { content: [{ type: "text", text: message }], isError: true };
}

function noStoreHeaders(): HeadersInit {
  return { "Cache-Control": "no-store", "Content-Type": "application/json" };
}

function rpcResponse(body: unknown): Response {
  return Response.json(body, { headers: noStoreHeaders() });
}

function validateOrigin(request: Request): Response | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  let expected: string;
  try {
    expected = new URL(mcpResourceUrl()).origin;
  } catch {
    return new Response("MCP resource URL is invalid", {
      status: 500,
      headers: noStoreHeaders(),
    });
  }
  if (origin === expected) return null;
  return new Response("Forbidden Origin", {
    status: 403,
    headers: noStoreHeaders(),
  });
}

function validateProtocolVersion(request: Request): Response | null {
  const version = request.headers.get("MCP-Protocol-Version") ?? "2025-03-26";
  if (SUPPORTED_PROTOCOL_VERSIONS.includes(version as never)) return null;
  return new Response("Unsupported MCP protocol version", {
    status: 400,
    headers: noStoreHeaders(),
  });
}
