# Shell MCP host wiring

`config-schema.ts` validates environment values with Remix data schemas. `config.ts` selects a mode and composes its settings; `runtime.ts` wires identity and execution. `auth/` holds 4orm verification, secret-file loading, and local fixtures. `systemd-runner.ts` talks to a configured host helper. MCP routes and job behavior live in [`@tea/shell-core`](../../../packages/shell-core/README.md).
