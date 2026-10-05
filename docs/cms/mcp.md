# TeaCMS MCP

The Node app serves read-only MCP at `POST /tea/mcp` on each registered site host. It uses [`@sdxc/mcp`](https://sdxc.sergiodxa.com/api/mcp) with stateless Streamable HTTP. `list_published_pages` and `get_published_page` read the selected site's published content, never drafts or previews.

Without `TEA_MCP_TOKEN`, the endpoint returns 404. Set a long random token through your secret manager and send `Authorization: Bearer <token>`. One token grants read access to every site in this Node process. Keep it private and out of tracked files. Editor login does not authorize MCP.

TeaCMS selects the site from the hostname before routing MCP. The route uses the public site's request-scoped `ContentStore`. A future write-capable MCP needs separate scoped credentials and per-tool authorization.

Cloudflare `@tea/cms-edge` has no MCP endpoint yet. Its D1/R2 storage is separate from the Node app's SQLite store.
