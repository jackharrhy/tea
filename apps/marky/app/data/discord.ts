import { PALETTE_COLORS } from "../shared/palette.ts";

// Discord API client. Stateless except for the per-guild roles cache.
// Every fetch-using export accepts an optional `fetchImpl` so tests can
// inject a stub without touching globals.

const API = "https://discord.com/api";
const ROLES_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface GuildMember {
  nick: string | null;
  roleIds: string[];
  user: { id: string; username: string; globalName: string | null };
}

export interface Role {
  id: string;
  name: string;
  color: number; // 0 = no color
  position: number;
}

export interface ExchangeArgs {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}

export interface ExchangeResult {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
}

export async function exchangeCode(
  args: ExchangeArgs,
  fetchImpl: typeof fetch = fetch,
): Promise<ExchangeResult> {
  const body = new URLSearchParams({
    client_id: args.clientId,
    client_secret: args.clientSecret,
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
  });

  const response = await fetchImpl(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Discord token exchange failed: ${response.status} ${text}`,
    );
  }

  const json = (await response.json()) as {
    access_token: string;
    token_type: string;
    expires_in: number;
  };
  return {
    accessToken: json.access_token,
    tokenType: json.token_type,
    expiresIn: json.expires_in,
  };
}

export async function fetchGuildMember(
  args: { accessToken: string; guildId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<GuildMember | null> {
  const response = await fetchImpl(
    `${API}/users/@me/guilds/${args.guildId}/member`,
    {
      headers: { Authorization: `Bearer ${args.accessToken}` },
    },
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Discord guild-member fetch failed: ${response.status} ${text}`,
    );
  }

  const json = (await response.json()) as {
    nick: string | null;
    roles: string[];
    user: { id: string; username: string; global_name: string | null };
  };
  return {
    nick: json.nick,
    roleIds: json.roles,
    user: {
      id: json.user.id,
      username: json.user.username,
      globalName: json.user.global_name,
    },
  };
}

interface CachedRoles {
  roles: Role[];
  fetchedAt: number;
}
const rolesCache = new Map<string, CachedRoles>();

export interface FetchGuildRolesOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export async function fetchGuildRoles(
  args: { botToken: string; guildId: string },
  options: FetchGuildRolesOptions = {},
): Promise<Role[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;

  const cached = rolesCache.get(args.guildId);
  if (cached && now() - cached.fetchedAt < ROLES_CACHE_TTL_MS) {
    return cached.roles;
  }

  const response = await fetchImpl(`${API}/guilds/${args.guildId}/roles`, {
    headers: { Authorization: `Bot ${args.botToken}` },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Discord roles fetch failed: ${response.status} ${text}`);
  }

  const json = (await response.json()) as Array<{
    id: string;
    name: string;
    color: number;
    position: number;
  }>;
  const roles: Role[] = json.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    position: r.position,
  }));

  rolesCache.set(args.guildId, { roles, fetchedAt: now() });
  return roles;
}

// Test-only: reset the in-memory cache.
export function resetRolesCacheForTests(): void {
  rolesCache.clear();
}

export function resolveDisplayName(member: GuildMember): string {
  if (member.nick) return member.nick;
  if (member.user.globalName) return member.user.globalName;
  return member.user.username;
}

export function resolveRoleColor(
  roleIds: string[],
  roles: Role[],
): string | null {
  if (roleIds.length === 0) return null;

  const byId = new Map(roles.map((r) => [r.id, r]));
  let best: Role | null = null;
  for (const id of roleIds) {
    const role = byId.get(id);
    if (!role || role.color === 0) continue;
    if (!best || role.position > best.position) best = role;
  }

  if (!best) return null;
  return `#${best.color.toString(16).padStart(6, "0")}`;
}

export function deterministicPaletteColor(userId: string): string {
  // Simple FNV-1a-ish hash; we just need a stable bucket. Discord ids are
  // numeric strings but we treat them as opaque.
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return PALETTE_COLORS[hash % PALETTE_COLORS.length];
}
