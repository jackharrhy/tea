import * as path from "node:path";

// Typed env-derived configuration. Read once at startup via loadConfig() so
// failures surface before the server binds a port.

export interface DiscordAuthConfig {
  mode: "discord";
  clientId: string;
  clientSecret: string;
  guildId: string;
  baseUrl: string;
  sessionSecret: string;
  botToken?: string;
}

type AuthConfig = { mode: "anonymous" } | DiscordAuthConfig;

interface GitConfig {
  repoDir: string;
  authorName: string;
  authorEmail: string;
  persistIdleMs: number;
  pushIntervalMs: number;
  push?: { pat: string };
}

export interface AppConfig {
  auth: AuthConfig;
  port: number;
  contentDir: string;
  git?: GitConfig;
}

const DEFAULT_PORT = 44100;
const DEFAULT_PERSIST_IDLE_MS = 60_000;
const DEFAULT_PUSH_INTERVAL_MS = 300_000;

const DISCORD_REQUIRED = [
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_GUILD_ID",
  "SESSION_SECRET",
] as const;

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): AppConfig {
  const mode = env.MARKY_AUTH ?? "anonymous";
  if (mode !== "anonymous" && mode !== "discord") {
    throw new Error(
      `MARKY_AUTH must be "anonymous" or "discord", got "${mode}"`,
    );
  }

  const port = parsePort(env.PORT);
  const auth: AuthConfig =
    mode === "anonymous" ? { mode: "anonymous" } : loadDiscordConfig(env, port);
  const baseUrl = auth.mode === "discord" ? auth.baseUrl : null;

  return {
    auth,
    port,
    contentDir: parseContentDir(env.MARKY_CONTENT_DIR),
    git: loadGitConfig(env, baseUrl),
  };
}

function loadDiscordConfig(
  env: Record<string, string | undefined>,
  port: number,
): DiscordAuthConfig {
  const missing = DISCORD_REQUIRED.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `MARKY_AUTH=discord requires the following env vars: ${missing.join(", ")}`,
    );
  }

  const rawBaseUrl = env.MARKY_BASE_URL?.trim();
  const baseUrl = (rawBaseUrl || `http://localhost:${port}`).replace(
    /\/+$/,
    "",
  );

  return {
    mode: "discord",
    clientId: env.DISCORD_CLIENT_ID!.trim(),
    clientSecret: env.DISCORD_CLIENT_SECRET!.trim(),
    guildId: env.DISCORD_GUILD_ID!.trim(),
    baseUrl,
    sessionSecret: env.SESSION_SECRET!.trim(),
    botToken: env.DISCORD_BOT_TOKEN?.trim() || undefined,
  };
}

function loadGitConfig(
  env: Record<string, string | undefined>,
  baseUrl: string | null,
): GitConfig | undefined {
  const repoDir = env.MARKY_GIT_REPO?.trim();
  const pat = env.MARKY_GIT_PAT?.trim();
  const pushFlag = env.MARKY_GIT_PUSH?.trim();

  if (!repoDir) {
    if (pat) {
      throw new Error("MARKY_GIT_PAT requires MARKY_GIT_REPO to be set");
    }
    return undefined;
  }

  const authorName = env.MARKY_GIT_AUTHOR_NAME?.trim() || "marky-bot";
  const authorEmail =
    env.MARKY_GIT_AUTHOR_EMAIL?.trim() ||
    `marky-bot@${hostFromBaseUrl(baseUrl)}`;

  const persistIdleMs = parseInteger(
    env.MARKY_PERSIST_IDLE_MS,
    DEFAULT_PERSIST_IDLE_MS,
    "MARKY_PERSIST_IDLE_MS",
  );
  const pushIntervalMs = parseInteger(
    env.MARKY_PUSH_INTERVAL_MS,
    DEFAULT_PUSH_INTERVAL_MS,
    "MARKY_PUSH_INTERVAL_MS",
  );

  let push: { pat: string } | undefined;
  if (pushFlag === "true") {
    if (!pat) throw new Error("MARKY_GIT_PUSH=true requires MARKY_GIT_PAT");
    push = { pat };
  }

  return {
    repoDir,
    authorName,
    authorEmail,
    persistIdleMs,
    pushIntervalMs,
    push,
  };
}

function hostFromBaseUrl(baseUrl: string | null): string {
  if (!baseUrl) return "localhost";
  try {
    return new URL(baseUrl).hostname || "localhost";
  } catch {
    return "localhost";
  }
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_PORT;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`PORT must be a number, got "${raw}"`);
  }
  return parsed;
}

function parseInteger(
  raw: string | undefined,
  fallback: number,
  varName: string,
): number {
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`${varName} must be a number, got "${raw}"`);
  }
  return parsed;
}

function parseContentDir(raw: string | undefined): string {
  return path.resolve(
    raw && raw.length > 0 ? raw : path.join(process.cwd(), "content"),
  );
}
