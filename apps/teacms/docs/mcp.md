# TeaCMS MCP

The Node TeaCMS app serves a read-only MCP endpoint at `POST /tea/mcp` on each registered site hostname. It uses [`@sdxc/mcp`](https://sdxc.sergiodxa.com/api/mcp) and the stateless Streamable HTTP protocol. It offers `list_published_pages` and `get_published_page`. Both read the selected site's published content; drafts and previews are unavailable.

The endpoint returns 404 unless `TEA_MCP_TOKEN` is set. Configure a long random token through your secret manager, then supply `Authorization: Bearer <token>` in your MCP client. The same token currently grants read access on every site served by this Node process. Keep it private, and do not place it in a tracked file. The normal editor login does not authorize MCP requests.

TeaCMS chooses the site from the request hostname before routing the MCP request. The MCP route uses the same request-scoped `ContentStore` as the public site. A future write capable MCP should use separate scoped credentials and explicit per-tool authorization.

The Cloudflare `@teacms/edge` package does not expose this MCP endpoint yet. Its D1/R2 storage path remains independent of the Node app's SQLite content store.
