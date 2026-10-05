# @tea/json-schema

Schema builders that validate through Remix 3 `remix/data-schema` and describe the same input as JSON Schema 2020-12. CMS and Shell MCP use `@tea/json-schema` and `@tea/json-schema/checks` to define tool inputs. `@tea/mcp` publishes those descriptions to clients.

`src/index.ts` exports builders, parsing, and `toJSONSchema`; `src/checks.ts` exports checks with JSON Schema keywords; `src/coerce.ts` exports coercion helpers. Conversion results use [`@tea/result`](../result/README.md).

Run `npm run check --workspace @tea/json-schema` from the root. Changes also need the MCP, CMS, and Shell MCP checks.

---

## Origin and MIT license

This package ports [Sergio Xalambrí’s json-schema](https://github.com/sergiodxa/monorepo/tree/7582e46f150b052ba145945661ac9937f5f26f27/packages/json-schema) at revision `7582e46`.

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
