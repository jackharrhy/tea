# @tea/logger

An optional wide-event logger for Remix 3 request and job handling. [`@tea/mcp`](../mcp/README.md) enriches the current log when one is open; otherwise it runs without a logger.

`src/index.ts` exports `createLogger`, `Log`, and `currentLog`. `@tea/logger/middleware` exports Remix router middleware. The current log uses Node `AsyncLocalStorage`; a Cloudflare Worker using it needs Node compatibility.

Run `npm run check --workspace @tea/logger` from the root. Changes also need the MCP, CMS, and Shell MCP checks.

---

## Origin and MIT license

This package ports [Sergio Xalambrí’s logger](https://github.com/sergiodxa/monorepo/tree/7582e46f150b052ba145945661ac9937f5f26f27/packages/logger) at revision `7582e46`.

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
