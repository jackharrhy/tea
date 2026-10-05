# Shell MCP host wiring

`config-schema.ts` validates environment values with Remix data schemas. `config.ts` selects a mode and composes its settings; `runtime.ts` wires identity and execution. In `auth/`, `fourorm.ts` handles discovery and HTTP requests, `claims.ts` validates token and userinfo data, and `secret.ts` reads the credential file. `systemd-runner.ts` talks to a configured host helper. MCP routes and job behavior live in [`@tea/shell-core`](../../../packages/shell-core/README.md).
