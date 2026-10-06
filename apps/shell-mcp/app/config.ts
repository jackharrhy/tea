import {
  commonEnv,
  liveEnv,
  parseEnvironment,
  publicOriginSchema,
  systemdEnv,
} from "./config-schema.ts";
import type {
  DemoShellConfig,
  LiveShellConfig,
  LockedShellConfig,
} from "./config-types.ts";

type HostConfig = Readonly<{ host: string; port: number }>;
type IdentityConfig = Readonly<{
  issuer: string;
  allowedSubjects: readonly string[];
  introspectionClientId: string;
  introspectionSecretFile: string;
}>;
type LiveConfig = HostConfig &
  LiveShellConfig &
  IdentityConfig &
  (
    | { runner: "disabled" }
    | { runner: "systemd"; journalFile: string; helperPath: string }
  );
export type AppConfig =
  | (HostConfig & LockedShellConfig)
  | (HostConfig & DemoShellConfig)
  | LiveConfig;

const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);

function isLoopbackHost(host: string): boolean {
  return loopbackHosts.has(host.replace(/^\[|\]$/g, ""));
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const common = parseEnvironment(commonEnv, env);
  const {
    SHELL_MODE: mode,
    SHELL_RUNNER: runner,
    HOST: host,
    PORT: port,
  } = common;
  const publicOrigin =
    common.PUBLIC_ORIGIN ?? `http://${host === "::1" ? "[::1]" : host}:${port}`;
  parseEnvironment(publicOriginSchema, { PUBLIC_ORIGIN: publicOrigin });

  const sharedConfig = {
    host,
    port,
    publicOrigin,
    resource: `${publicOrigin}/mcp`,
    mcpName: common.SHELL_MCP_NAME,
    mcpTitle: common.SHELL_MCP_TITLE,
  };

  if (mode !== "fourorm" && runner !== "disabled")
    throw new Error("Systemd runner requires fourorm mode");

  if (mode === "locked") {
    return { ...sharedConfig, mode, runner: "disabled" };
  }
  if (mode === "demo") {
    const origin = new URL(publicOrigin);
    if (
      !isLoopbackHost(host) ||
      !isLoopbackHost(origin.hostname) ||
      origin.protocol !== "http:"
    )
      throw new Error("Demo mode must use loopback HTTP");
    return {
      ...sharedConfig,
      mode,
      runner: "mock-only",
      allowedUsernames: ["demo"],
    };
  }

  if (!publicOrigin.startsWith("https://"))
    throw new Error("4orm mode requires an HTTPS public origin");
  const live = parseEnvironment(liveEnv, env);
  if (new URL(live.SHELL_AUTHORIZATION_SERVER).origin !== live.FOURORM_ISSUER)
    throw new Error("Authorization server must share the issuer origin");
  const liveConfig = {
    ...sharedConfig,
    mode,
    issuer: live.FOURORM_ISSUER,
    authorizationServer: live.SHELL_AUTHORIZATION_SERVER,
    requiredScope: live.SHELL_REQUIRED_SCOPE,
    allowedSubjects: live.SHELL_ALLOWED_SUBJECTS,
    allowedUsernames: live.SHELL_ALLOWED_USERNAMES,
    introspectionClientId: live.FOURORM_INTROSPECTION_CLIENT_ID,
    introspectionSecretFile: live.FOURORM_INTROSPECTION_SECRET_FILE,
  };
  if (runner === "disabled") return { ...liveConfig, runner };
  const systemd = parseEnvironment(systemdEnv, env);
  return {
    ...liveConfig,
    runner,
    journalFile: systemd.SHELL_JOURNAL_FILE,
    helperPath: systemd.SHELL_HELPER_PATH,
  };
}
