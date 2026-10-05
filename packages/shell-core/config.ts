type BaseConfig = Readonly<{
  publicOrigin: string;
  resource: string;
  mcpName: string;
  mcpTitle: string;
}>;

export type LockedShellConfig = BaseConfig & {
  mode: "locked";
  runner: "disabled";
};
export type DemoShellConfig = BaseConfig & {
  mode: "demo";
  runner: "mock-only";
  allowedUsernames: readonly string[];
};
export type LiveShellConfig = BaseConfig & {
  mode: "fourorm";
  runner: "disabled" | "systemd";
  authorizationServer: string;
  requiredScope: string;
  allowedUsernames: readonly string[];
};
export type ShellConfig = LockedShellConfig | DemoShellConfig | LiveShellConfig;
