# @tea/request-body

Reads a Web `Request` body up to a byte limit. It checks the stream even when `Content-Length` is missing or wrong, and can stop waiting after a caller-selected timeout. The result distinguishes a missing body, an oversized body, and a failed read.

Import `readRequestBody` from `@tea/request-body`. Callers choose their limits and translate failures into their own HTTP or form responses. This package has no Remix or runtime adapter dependency in production.

Run `npm run check --workspace @tea/request-body` from the root. Consumers are CMS Node, CMS Edge, and `@tea/mcp`.
