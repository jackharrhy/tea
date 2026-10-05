# @tea/shell-core

Shell job lifecycle and Remix 3 MCP contract for [`@tea/shell-mcp`](../../apps/shell-mcp/README.md). This package owns `execute`, `read_job`, and `cancel`, bounded job output, owner-scoped idempotency, HTTP routes, and transport limits. It uses Tea's [`@tea/mcp`](../mcp/README.md) handler, shared with CMS.

`router.ts` composes the routes and tools. The MCP route owns authentication and passes requests to `@tea/mcp`, which accepts the current protocol and bounds JSON bodies. Older MCP clients are not translated. `middleware/transport.ts` limits concurrent requests at the router. `execution/index.ts` exports `JobManager`, the runner interface, and disabled and mock runners. `config.ts` and `auth/types.ts` describe the host inputs. The package does not choose an OAuth provider, process helper, host identity, or public origin. Those belong to the app.

Run `npm run check --workspace @tea/shell-core` from the root. Tests are in `__tests__/`. Changing these interfaces also requires the Shell MCP app check.
