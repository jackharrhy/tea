import { z } from "zod";
import type { WorldviewDatabase, WorldviewUser } from "./database.js";
import { ServiceHttpError } from "./service-http.js";

export const WORLDVIEW_MCP_SCOPE = "worldview:admin";

export interface WorldviewMcpAuthConfig {
  readonly fourmUrl: string;
  readonly publicUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

const IntrospectionSchema = z.looseObject({
  active: z.boolean(),
  principal_type: z.string().optional(),
  sub: z.string().optional(),
  aud: z.union([z.string(), z.array(z.string())]).optional(),
  scope: z.string().optional(),
  exp: z.number().optional(),
});
const ProfileSchema = z.looseObject({
  sub: z.string().min(1),
  username: z.string().min(1),
  display_name: z.string().min(1),
  is_admin: z.boolean(),
});

export function mcpResourceUrl(config: WorldviewMcpAuthConfig): string {
  return `${config.publicUrl.replace(/\/$/, "")}/mcp`;
}

export async function requireMcpAdmin(
  authorization: string | undefined,
  config: WorldviewMcpAuthConfig | undefined,
  database: WorldviewDatabase,
  fetcher: typeof fetch = fetch,
): Promise<WorldviewUser> {
  if (!config)
    throw new ServiceHttpError(503, "Worldview MCP is not configured");
  const token = /^Bearer ([^\s]+)$/i.exec(authorization ?? "")?.[1];
  if (!token) throw new ServiceHttpError(401, "Bearer token required");
  const credentials = Buffer.from(
    `${config.clientId}:${config.clientSecret}`,
  ).toString("base64");
  let response: Response;
  try {
    response = await fetcher(new URL("/oauth/introspect", config.fourmUrl), {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token, token_type_hint: "access_token" }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    throw new ServiceHttpError(503, "4orm token verification is unavailable");
  }
  if (!response.ok)
    throw new ServiceHttpError(503, "4orm token verification is unavailable");
  const parsed = IntrospectionSchema.safeParse(
    await response.json().catch(() => null),
  );
  if (!parsed.success)
    throw new ServiceHttpError(503, "4orm returned invalid token metadata");
  const value = parsed.data;
  const audiences = Array.isArray(value.aud) ? value.aud : [value.aud];
  if (
    !value.active ||
    value.principal_type !== "user" ||
    !value.sub ||
    !audiences.includes(mcpResourceUrl(config)) ||
    !value.scope?.split(/\s+/).includes(WORLDVIEW_MCP_SCOPE) ||
    !value.scope.split(/\s+/).includes("openid") ||
    !value.exp ||
    value.exp <= Math.floor(Date.now() / 1000)
  )
    throw new ServiceHttpError(
      401,
      "Worldview MCP token is invalid or expired",
    );

  let profileResponse: Response;
  try {
    profileResponse = await fetcher(
      new URL("/oauth/userinfo", config.fourmUrl),
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(3000),
      },
    );
  } catch {
    throw new ServiceHttpError(503, "4orm account lookup is unavailable");
  }
  if (!profileResponse.ok)
    throw new ServiceHttpError(401, "Worldview MCP account is unavailable");
  const profile = ProfileSchema.safeParse(
    await profileResponse.json().catch(() => null),
  );
  if (!profile.success || profile.data.sub !== value.sub) {
    throw new ServiceHttpError(
      401,
      "Worldview MCP account identity does not match",
    );
  }
  if (!profile.data.is_admin)
    throw new ServiceHttpError(403, "4orm administrator access required");
  return database.upsertUser({
    fourmSub: profile.data.sub,
    username: profile.data.username,
    displayName: profile.data.display_name,
    isAdmin: true,
  });
}
