import {
  IdentityError,
  projectAudienceScope,
  PROJECT_ROLES_SCOPE,
  requireTokenRole,
  roleScope,
} from "@tea/identity";
import { identityConfig } from "./oauth.server.ts";
import { eq } from "drizzle-orm";

import { users, type User } from "#db";
import { db } from "#db/connection.server";

import { introspectBearerToken } from "./service-auth.server.ts";

const MCP_ADMIN_SCOPE = roleScope("admin");
export function mcpAuthorizationScopes(): string[] {
  return [
    "openid",
    "profile",
    projectAudienceScope(identityConfig().projectId),
    PROJECT_ROLES_SCOPE,
    MCP_ADMIN_SCOPE,
  ];
}

export function mcpResourceUrl(): string {
  return `${process.env.ARTBIN_URL ?? "http://localhost:5175"}/mcp`;
}

export async function requireMcpAdmin(
  request: Request,
): Promise<User | Response> {
  const principal = await introspectBearerToken(request);
  if (principal instanceof Response) return mcpAuthResponse(principal);
  try {
    requireTokenRole(principal, identityConfig().projectId, "admin");
  } catch (error) {
    return mcpError(
      error instanceof IdentityError ? error.status : 503,
      "insufficient_scope",
      "Artbin administrator authorization is required",
    );
  }

  if (principal.principalType !== "user") {
    return mcpError(
      403,
      "invalid_principal",
      "An Artbin administrator OAuth token is required",
    );
  }

  const user = await db.query.users.findFirst({
    where: eq(users.authSubject, principal.subject),
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
    `${challenge === "Bearer" ? "Bearer " : challenge + ", "}resource_metadata="${mcpResourceMetadataUrl()}", scope="${mcpAuthorizationScopes().join(" ")}"`,
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
      `Bearer error="${status === 401 ? "invalid_token" : code}", resource_metadata="${mcpResourceMetadataUrl()}", scope="${mcpAuthorizationScopes().join(" ")}"`,
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
