import { readFile, stat } from "node:fs/promises";
import type {
  DemoShellConfig,
  LiveShellConfig,
  LockedShellConfig,
} from "@tea/shell-core/config.ts";
type HostConfig = Readonly<{ host: string; port: number }>;
type LiveConfig = LiveShellConfig &
  Readonly<{
    issuer: string;
    allowedSubjects: readonly string[];
    introspectionClientId: string;
    introspectionSecretFile: string;
    journalFile: string;
    helperPath: string;
  }>;
export type AppConfig = HostConfig &
  (LockedShellConfig | DemoShellConfig | LiveConfig);
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const mode = env.SHELL_MODE ?? "locked";
  if (mode !== "locked" && mode !== "demo" && mode !== "fourorm")
    throw new Error("SHELL_MODE must be locked, demo, or fourorm");
  const runner = env.SHELL_RUNNER ?? "disabled";
  if (runner !== "disabled" && runner !== "systemd")
    throw new Error("Invalid runner");
  if (runner === "systemd" && mode !== "fourorm")
    throw new Error("Systemd runner requires fourorm mode");
  const host = env.HOST ?? "127.0.0.1";
  const port = Number(env.PORT ?? 3000);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535)
    throw new Error("Invalid PORT");
  if (mode === "demo" && !LOOPBACK.has(host))
    throw new Error("Demo mode must bind loopback");
  const publicOrigin =
    env.PUBLIC_ORIGIN ?? `http://${host === "::1" ? "[::1]" : host}:${port}`;
  const origin = new URL(publicOrigin);
  if (origin.origin !== publicOrigin || origin.username || origin.password)
    throw new Error("PUBLIC_ORIGIN must be an exact origin");
  if (
    mode === "demo" &&
    (!LOOPBACK.has(origin.hostname.replace(/^\[|\]$/g, "")) ||
      origin.protocol !== "http:")
  )
    throw new Error("Demo origin must be local HTTP");
  if (mode === "fourorm" && origin.protocol !== "https:")
    throw new Error("4orm mode requires an HTTPS public origin");
  const base = {
    host,
    port,
    publicOrigin,
    resource: `${publicOrigin}/mcp`,
    mcpName: env.SHELL_MCP_NAME ?? "shell-mcp",
    mcpTitle: env.SHELL_MCP_TITLE ?? "Shell MCP",
  };
  if (mode === "locked") return { ...base, mode, runner: "disabled" };
  if (mode === "demo")
    return { ...base, mode, runner: "mock-only", allowedUsernames: ["demo"] };

  const issuer = env.FOURORM_ISSUER ?? "";
  const authorizationServer = env.SHELL_AUTHORIZATION_SERVER ?? "";
  const requiredScope = env.SHELL_REQUIRED_SCOPE ?? "";
  const allowedSubjects = (env.SHELL_ALLOWED_SUBJECTS ?? "")
    .split(",")
    .filter(Boolean);
  const allowedUsernames = (env.SHELL_ALLOWED_USERNAMES ?? "")
    .split(",")
    .filter(Boolean);
  const helperPath = env.SHELL_HELPER_PATH ?? "";
  const journalFile = env.SHELL_JOURNAL_FILE ?? "";
  const introspectionClientId = env.FOURORM_INTROSPECTION_CLIENT_ID ?? "";
  const introspectionSecretFile = env.FOURORM_INTROSPECTION_SECRET_FILE ?? "";
  if (
    !issuer ||
    !authorizationServer ||
    !requiredScope ||
    !allowedSubjects.length ||
    !allowedUsernames.length ||
    !introspectionClientId ||
    !introspectionSecretFile
  )
    throw new Error(
      "4orm mode requires issuer, authorization server, scope, owner pins, and dedicated resource-server credentials",
    );
  const issuerUrl = new URL(issuer);
  const authorizationUrl = new URL(authorizationServer);
  if (
    issuerUrl.protocol !== "https:" ||
    issuerUrl.origin !== issuer ||
    authorizationUrl.protocol !== "https:" ||
    authorizationUrl.href !== authorizationServer ||
    authorizationUrl.origin !== issuerUrl.origin ||
    issuerUrl.username ||
    issuerUrl.password ||
    issuerUrl.search ||
    issuerUrl.hash ||
    authorizationUrl.username ||
    authorizationUrl.password ||
    authorizationUrl.search ||
    authorizationUrl.hash
  )
    throw new Error(
      "Issuer and authorization server must be exact same-origin HTTPS URLs",
    );
  if (runner === "systemd") {
    if (!journalFile.startsWith("/"))
      throw new Error("Systemd runner requires an absolute journal path");
    if (!helperPath.startsWith("/") || helperPath.includes("\0"))
      throw new Error("Systemd runner requires an absolute helper path");
  }
  return {
    ...base,
    mode,
    runner,
    journalFile,
    issuer,
    authorizationServer,
    requiredScope,
    allowedSubjects,
    allowedUsernames,
    introspectionClientId,
    introspectionSecretFile,
    helperPath,
  };
}
export async function readIntrospectionSecret(path: string): Promise<string> {
  const info = await stat(path);
  if (!info.isFile() || info.size > 8192 || (info.mode & 0o077) !== 0)
    throw new Error(
      "Secret must be a regular file with no group/other permissions",
    );
  const value = (await readFile(path, "utf8")).trim();
  if (!value || value.length > 4096)
    throw new Error("Invalid introspection secret file");
  return value;
}
