# @tea/shell-core

Shell job lifecycle and Remix 3 MCP contract for [`@tea/shell-mcp`](../../apps/shell-mcp/README.md). This package owns `execute`, `read_job`, and `cancel`, bounded job output, owner-scoped idempotency, HTTP routes, and transport limits. It uses the same published `@sdxc/mcp` version as CMS; there is no Tea wrapper around that library.

`router.ts` composes the routes and tools. `middleware/transport.ts` limits concurrent requests and MCP request bodies at the Remix middleware boundary. `execution/index.ts` exports `JobManager`, the runner interface, and disabled and mock runners. `config.ts` and `auth/types.ts` describe the host inputs. The package does not choose an OAuth provider, process helper, host identity, or public origin. Those belong to the app.

Run `npm run check --workspace @tea/shell-core` from the root. Tests are in `__tests__/`. Changing these interfaces also requires the Shell MCP app check.
