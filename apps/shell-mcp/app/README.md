# Shell MCP host wiring

`router.ts`, `routes.ts`, and `tools.ts` define the Remix and MCP interface. `execution/` owns the bounded job lifecycle and runner contract. `config-schema.ts` validates environment values with Remix data schemas; `config.ts` selects a mode and `runtime.ts` wires identity and execution. In `auth/`, `fourorm.ts` handles discovery and HTTP requests, `claims.ts` validates token and userinfo data, and `secret.ts` reads the credential file. `systemd-runner.ts` talks to a configured host helper.
