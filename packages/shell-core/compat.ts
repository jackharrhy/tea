import { LATEST_PROTOCOL_VERSION, MetaKey } from "@sdxc/mcp";
import { json } from "./middleware/security.ts";
const versions = new Set(["2025-03-26", "2025-06-18", "2025-11-25"]);

/** Explicit stateless Streamable HTTP compatibility, inside authenticated route.
 * No sessions, SSE subscriptions, server requests, or implicit mutation retries.
 */
export async function compatibleMcp(
  request: Request,
  serverName: string,
  forward: (r: Request) => Promise<Response>,
  current: () => Promise<Response>,
): Promise<Response> {
  const version = request.headers.get("MCP-Protocol-Version");
  if (version === LATEST_PROTOCOL_VERSION || request.headers.has("Mcp-Method"))
    return current();
  let body: any;
  try {
    body = await request.clone().json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (
    !body ||
    Array.isArray(body) ||
    body.jsonrpc !== "2.0" ||
    typeof body.method !== "string" ||
    (body.params !== undefined &&
      (typeof body.params !== "object" ||
        body.params === null ||
        Array.isArray(body.params)))
  )
    return json({ error: "invalid_request" }, 400);
  if (body.params?._meta?.[MetaKey.ProtocolVersion])
    return json({ error: "mixed_protocols" }, 400);
  const selected =
    body.method === "initialize"
      ? body.params?.protocolVersion
      : (version ?? "2025-03-26");
  if (!versions.has(selected))
    return json({ error: "unsupported_protocol" }, 400);
  if (body.method === "initialize")
    return json({
      jsonrpc: "2.0",
      id: body.id,
      result: {
        protocolVersion: selected,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: serverName, version: "0.2.0" },
        instructions:
          "Execute returns a job. Poll read_job; cancel does not undo changes. Never replay uncertain commands.",
      },
    });
  if (body.id === undefined)
    return new Response(null, {
      status: 202,
      headers: { "cache-control": "no-store" },
    });
  if (body.method === "ping")
    return json({ jsonrpc: "2.0", id: body.id, result: {} });
  if (!["tools/list", "tools/call"].includes(body.method))
    return json({
      jsonrpc: "2.0",
      id: body.id,
      error: { code: -32601, message: "Method not found" },
    });
  const headers = new Headers(request.headers);
  headers.set("MCP-Protocol-Version", LATEST_PROTOCOL_VERSION);
  headers.set("Mcp-Method", body.method);
  if (typeof body.params?.name === "string")
    headers.set("Mcp-Name", body.params.name);
  body.params = {
    ...body.params,
    _meta: {
      ...body.params?._meta,
      [MetaKey.ProtocolVersion]: LATEST_PROTOCOL_VERSION,
      [MetaKey.ClientInfo]: {
        name: "streamable-http-client",
        version: selected,
      },
      [MetaKey.ClientCapabilities]: {},
    },
  };
  headers.delete("content-length");
  return forward(
    new Request(request, {
      method: request.method,
      headers,
      body: JSON.stringify(body),
    }),
  );
}
