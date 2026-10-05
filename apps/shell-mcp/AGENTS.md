# Shell MCP editing rules

Read [README.md](README.md) and the [shell-core guide](../../packages/shell-core/README.md) before changes. Use the installed Remix 3 guides for routing or middleware. Keep generic job behavior in `@tea/shell-core`, MCP transport behavior in `@tea/mcp`, and 4orm and systemd host wiring here.

Keep every MCP method authenticated. Preserve exact issuer, subject, audience, scope, allowed username, expiry, and admin checks, and keep execution disabled by default. The live runner uses a separate execution identity and a fixed helper boundary. Never pass credentials to a runner. Do not change Newport's installed service during local refactoring.

Host tests belong in `__tests__/host/`; OAuth integration tests belong in `__tests__/integration/`. Their setup is in the README. Host configuration and production operations stay in the infrastructure repo. Update this guide and README when boundaries or checks change.
