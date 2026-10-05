# Shell MCP host wiring

`config.ts` parses deployment settings, `runtime.ts` composes each mode, `auth/` verifies 4orm identity or supplies local fixtures, and `systemd-runner.ts` talks to a configured host helper. MCP routes and job behavior live in [`@tea/shell-core`](../../../packages/shell-core/README.md).
