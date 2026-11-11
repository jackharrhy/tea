import * as path from "node:path";
import type { IdentityConfig } from "@harrhy/identity";

// Typed env-derived configuration. Read once at startup via loadConfig() so
// failures surface before the server binds a port.

export interface CentralAuthConfig {
  mode: "central";
  identity: IdentityConfig;
  baseUrl: string;
  sessionSecret: string;
}

type AuthConfig = { mode: "anonymous" } | CentralAuthConfig;

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

const CENTRAL_REQUIRED = [
  "AUTH_ISSUER",
  "AUTH_CLIENT_ID",
  "AUTH_PROJECT_ID",
  "AUTH_ORGANIZATION_ID",
  "SESSION_SECRET",
  "MARKY_BASE_URL",
] as const;

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): AppConfig {
  const mode = env.MARKY_AUTH ?? "anonymous";
  if (mode !== "anonymous" && mode !== "central") {
    throw new Error(
      `MARKY_AUTH must be "anonymous" or "central", got "${mode}"`,
    );
  }

  const port = parsePort(env.PORT);
  const auth: AuthConfig =
    mode === "anonymous" ? { mode: "anonymous" } : loadCentralConfig(env);
  const baseUrl = auth.mode === "anonymous" ? null : auth.baseUrl;

  return {
    auth,
    port,
    contentDir: parseContentDir(env.MARKY_CONTENT_DIR),
    git: loadGitConfig(env, baseUrl),
  };
}

function loadCentralConfig(
  env: Record<string, string | undefined>,
): CentralAuthConfig {
  const missing = CENTRAL_REQUIRED.filter((key) => !env[key]?.trim());
  if (missing.length)
    throw new Error(`MARKY_AUTH=central requires: ${missing.join(", ")}`);
  const baseUrl = env.MARKY_BASE_URL!.replace(/\/+$/, "");
  if (new URL(baseUrl).protocol !== "https:")
    throw new Error("Central Auth requires an HTTPS MARKY_BASE_URL");
  return {
    mode: "central",
    identity: {
      issuer: env.AUTH_ISSUER!,
      clientId: env.AUTH_CLIENT_ID!,
      projectId: env.AUTH_PROJECT_ID!,
      organizationId: env.AUTH_ORGANIZATION_ID!,
    },
    baseUrl,
    sessionSecret: env.SESSION_SECRET!,
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
