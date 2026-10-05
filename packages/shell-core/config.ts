export type ShellConfig = Readonly<{
  mode: "locked" | "demo" | "fourorm";
  publicOrigin: string;
  resource: string;
  authorizationServer: string;
  requiredScope: string;
  allowedUsernames: readonly string[];
  runner: "disabled" | "systemd";
  mcpName: string;
  mcpTitle: string;
}>;
