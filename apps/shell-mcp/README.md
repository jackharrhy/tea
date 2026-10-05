# @tea/shell-mcp

Remix 3 Node host for [`@tea/shell-core`](../../packages/shell-core/README.md). It serves a shell MCP with `execute`, `read_job`, and `cancel`. The source began in `jack@newport:/home/jack/repos/personal/newport-shell-remix`; the current Newport service has not been redeployed from Tea.

`server.ts` starts the listener. `app/config.ts` parses locked, demo, or live settings; `app/runtime.ts` selects the identity provider and runner. `app/auth/fourorm.ts` verifies opaque tokens; `app/systemd-runner.ts` calls a configured root-owned helper. [`examples/newport/`](examples/newport/) contains the Newport-specific helper and quota bootstrap. Production units, ingress, credentials, and host configuration belong in the infrastructure repo.

## Develop and check

From the Tea root, run `npm ci` and `npm run check:shell-mcp`. The check covers the core package, host typecheck, local tests, and a loopback MCP smoke test with mock execution. `npm run dev:shell-mcp` starts locked on `127.0.0.1:3000`; `/healthz` responds and `/mcp` refuses requests. `npm run demo --workspace @tea/shell-mcp` uses the public fixture token `demo-only-token` and mock jobs on loopback only.

The OAuth integration test needs a compatible 4orm checkout and `FOURORM_TEST_REPO`; run `npm run test:oauth --workspace @tea/shell-mcp` after installing that fixture's dependencies. Newport host tests in `__tests__/host/` require its installed security boundary and `NEWPORT_REAL_TEST=1`; normal checks do not run them. See [integration notes](__tests__/integration/README.md).

## Live configuration

The default is `SHELL_MODE=locked` with execution disabled. A 4orm deployment must set `PUBLIC_ORIGIN`, `FOURORM_ISSUER`, `SHELL_AUTHORIZATION_SERVER`, `SHELL_REQUIRED_SCOPE`, `SHELL_ALLOWED_SUBJECTS`, `SHELL_ALLOWED_USERNAMES`, `FOURORM_INTROSPECTION_CLIENT_ID`, and `FOURORM_INTROSPECTION_SECRET_FILE`. The authorization server must share the issuer's HTTPS origin. Exact subject, username, scope, audience, expiry, and admin checks remain required. `SHELL_MCP_NAME` and `SHELL_MCP_TITLE` customize discovery names.

Systemd execution also requires `SHELL_RUNNER=systemd`, an absolute `SHELL_JOURNAL_FILE`, and an absolute `SHELL_HELPER_PATH` allowed by a narrow host sudo rule. For Newport, the helper path is `/usr/local/libexec/newport-shell-job`; its quota mounts, execution user, and network denies are host-specific. The helper must run under a separate unprivileged account. Never pass bearer tokens or introspection credentials to it. A scope, `cwd`, and Docker alone are not execution boundaries.

The root [Compose stack](../../compose.yml) exposes locked mode at `shell.localhost` for local wiring. Newport's live endpoint remains on its existing deployment until a separate rollout.
