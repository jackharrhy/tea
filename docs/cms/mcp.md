# TeaCMS MCP

The Node app serves read-only MCP at `POST /tea/mcp` on each registered site host. It uses [`@tea/mcp`](../../packages/mcp/README.md) with stateless Streamable HTTP. `list_published_pages` and `get_published_page` read the selected site's published content, never drafts or previews.

Without `TEA_MCP_TOKEN`, the endpoint returns 404. Set a long random token through your secret manager and send `Authorization: Bearer <token>`. One token grants read access to every site in this Node process. Keep it private and out of tracked files. Editor login does not authorize MCP.

In Central Auth mode, the shared token is ignored. Each site publishes
`/.well-known/oauth-protected-resource/tea/mcp`; the resource is the site's
`/tea/mcp` URL. A human token must have the CMS project audience, admin grant,
and admin role scope. The app introspects every request using its dedicated
resource credentials. Browser cookies and service tokens do not grant MCP
access. The tools remain read-only.

TeaCMS selects the site from the hostname before routing MCP. The route uses the public site's request-scoped `ContentStore`. A future write-capable MCP needs separate scoped credentials and per-tool authorization.

The Cloudflare app [`@tea/cms-edge`](../../apps/cms-edge/README.md) has no MCP endpoint yet. Its D1/R2 storage is separate from the Node app's SQLite store.
