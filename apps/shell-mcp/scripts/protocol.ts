import { LATEST_PROTOCOL_VERSION, MetaKey } from "@sdxc/mcp";
export function rpcRequest(
  origin: string,
  method: string,
  params: Record<string, unknown> = {},
  token = "demo-only-token",
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
    "MCP-Protocol-Version": LATEST_PROTOCOL_VERSION,
    "Mcp-Method": method,
  };
  if (typeof params.name === "string") headers["Mcp-Name"] = params.name;
  return new Request(`${origin}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          [MetaKey.ProtocolVersion]: LATEST_PROTOCOL_VERSION,
          [MetaKey.ClientCapabilities]: {},
          [MetaKey.ClientInfo]: { name: "shell-fixture", version: "0.1.0" },
        },
      },
    }),
  });
}
export async function rpcResult(response: Response): Promise<any> {
  if (!response.ok)
    throw new Error(
      `Unexpected HTTP ${response.status}: ${await response.text()}`,
    );
  const body = (await response.json()) as any;
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}
export function toolValue(result: any): any {
  if (result.isError)
    throw new Error(result.content?.[0]?.text ?? "Tool failed");
  return JSON.parse(result.content[0].text);
}
