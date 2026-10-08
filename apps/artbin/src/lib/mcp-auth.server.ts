import { eq } from "drizzle-orm";

import { users, type User } from "#db";
import { db } from "#db/connection.server";

import { introspectBearerToken } from "./service-auth.server.ts";

export const MCP_ADMIN_SCOPE = "artbin:admin";

export function mcpResourceUrl(): string {
  return `${process.env.ARTBIN_URL ?? "http://localhost:5175"}/mcp`;
}

export async function requireMcpAdmin(
  request: Request,
): Promise<User | Response> {
  const principal = await introspectBearerToken(request);
  if (principal instanceof Response) return mcpAuthResponse(principal);
  if (!principal.scopes.has(MCP_ADMIN_SCOPE)) {
    return mcpError(
      403,
      "insufficient_scope",
      `Required scope: ${MCP_ADMIN_SCOPE}`,
      {
        "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${MCP_ADMIN_SCOPE}"`,
      },
    );
  }

  if (principal.principalType !== "user") {
    return mcpError(
      403,
      "invalid_principal",
      "An Artbin administrator OAuth token is required",
    );
  }
  if (!principal.audiences.has(mcpResourceUrl())) {
    return mcpError(
      401,
      "invalid_token",
      "Bearer token was not issued for this MCP resource",
    );
  }

  const user = await db.query.users.findFirst({
    where: eq(users.fourmId, principal.subject),
  });
  if (!user || !user.isAdmin) {
    return mcpError(
      403,
      "admin_required",
      "Artbin administrator access is required",
    );
  }
  return user;
}

function mcpAuthResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  const challenge = headers.get("WWW-Authenticate") ?? "Bearer";
  headers.set(
    "WWW-Authenticate",
    `${challenge}, resource_metadata="${mcpResourceMetadataUrl()}", scope="${MCP_ADMIN_SCOPE}"`,
  );
  return new Response(response.body, { status: response.status, headers });
}

function mcpResourceMetadataUrl(): string {
  const baseUrl = process.env.ARTBIN_URL ?? "http://localhost:5175";
  return `${baseUrl}/.well-known/oauth-protected-resource/mcp`;
}

function mcpError(
  status: number,
  code: string,
  message: string,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(headers);
  if (
    !responseHeaders.has("WWW-Authenticate") &&
    (status === 401 || status === 403)
  ) {
    responseHeaders.set(
      "WWW-Authenticate",
      `Bearer error="${status === 401 ? "invalid_token" : code}", resource_metadata="${mcpResourceMetadataUrl()}", scope="${MCP_ADMIN_SCOPE}"`,
    );
  } else if (responseHeaders.has("WWW-Authenticate")) {
    responseHeaders.set(
      "WWW-Authenticate",
      `${responseHeaders.get("WWW-Authenticate")}, resource_metadata="${mcpResourceMetadataUrl()}"`,
    );
  }
  return Response.json(
    { error: { code, message } },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...Object.fromEntries(responseHeaders),
      },
    },
  );
}
