# @tea/logger

Tea's shared logger for request and job events. The CMS and Shell MCP Node hosts open one record per request; [`@tea/mcp`](../mcp/README.md) adds method and tool fields to that record. `Log.run` also covers non-HTTP work such as jobs.

`src/index.ts` exports `createLogger`, `Log`, and `currentLog`. Hosts use `logger.request(request, handler)` to open and emit one record with HTTP method and status; `logger.open(kind).run(handler)` covers jobs. `@tea/logger/middleware` exposes the current log as `context.log` when a Remix router needs it. The current log uses Node `AsyncLocalStorage`; a Cloudflare Worker using it needs Node compatibility. Records include named fields and durations, but no URL, headers, body, exception message, or stack by default. Add only fields safe to retain. Failures keep error type, scalar code, and retriable flag.

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
