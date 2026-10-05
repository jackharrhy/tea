# @tea/mcp

Tea's Remix 3 MCP handler and tool/resource definitions. CMS and Shell MCP use this package to serve stateless Streamable HTTP. Apps register tools on a handler and map its `fetch` function to a Remix route.

`src/index.ts` is the public entry point. `createHandler` owns MCP request parsing and protocol responses. It accepts `maxRequestBytes` and `requestTimeoutMs` so each host can bound the JSON it accepts. Tool schemas use `@sdxc/json-schema`; runtime logging and result helpers still use `@sdxc/logger` and `@sdxc/result`.

This code started from [Sergio Xalambrí's `@sdxc/mcp`](https://github.com/sergiodxa/monorepo/tree/7582e46f150b052ba145945661ac9937f5f26f27/packages/mcp), revision `7582e46`, published as `2026.10.2`. Tea now maintains it as `@tea/mcp`. The upstream MIT license is in [LICENSE.md](LICENSE.md). Upstream changes can be adopted selectively; this package does not track the published package automatically.

Run `npm run check --workspace @tea/mcp` from the root. The CMS and Shell MCP checks cover its consumers.
