# @tea/mcp

Tea's Remix 3 MCP handler and tool/resource definitions. CMS and Shell MCP use this package for stateless Streamable HTTP. Apps register tools on a handler and map its `fetch` function to a Remix route.

`src/index.ts` is the public entry point. `createHandler` owns parsing and protocol responses; `maxRequestBytes` and `requestTimeoutMs` bound JSON input. Schemas come from [`@tea/json-schema`](../json-schema/README.md), results from [`@tea/result`](../result/README.md), and optional request log enrichment from [`@tea/logger`](../logger/README.md).

Run `npm run check --workspace @tea/mcp` from the root. CMS and Shell MCP are its consumers.

---

## Origin and MIT license

This package ports [Sergio Xalambrí’s mcp](https://github.com/sergiodxa/monorepo/tree/7582e46f150b052ba145945661ac9937f5f26f27/packages/mcp) at revision `7582e46`.

MIT License

Copyright (c) 2026 Sergio Xalambrí

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
