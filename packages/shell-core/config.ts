type BaseConfig = Readonly<{
  publicOrigin: string;
  resource: string;
  mcpName: string;
  mcpTitle: string;
}>;

export type ShellConfig = BaseConfig &
  (
    | { mode: "locked"; runner: "disabled" }
    | { mode: "demo"; runner: "mock-only"; allowedUsernames: readonly string[] }
    | {
        mode: "fourorm";
        runner: "disabled" | "systemd";
        authorizationServer: string;
        requiredScope: string;
        allowedUsernames: readonly string[];
      }
  );
