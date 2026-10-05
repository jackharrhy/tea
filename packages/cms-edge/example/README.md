# TeaCMS Cloudflare host example

This Remix 3 Worker host template uses [`@tea/cms-edge`](../README.md). It is not a separate app or workspace. `worker.ts` shows a small collection with D1 and R2 bindings; `wrangler.jsonc` configures the Worker. There is no public site renderer. Add Remix routes through `createEdgeRouter`'s `extend` callback for a real site.

The template opens a request record with [`@tea/logger`](../../logger/README.md). Cloudflare Workers supports its `AsyncLocalStorage` through the configured Node compatibility flag.

## Develop

From the repo root, run `npm ci`, then `npm run dev:example --workspace @tea/cms-edge`. Run `npm run cms-edge:check` for types and tests. Apply `packages/cms-edge/db/schema.sql` to D1 before using the editor. Set `TEA_ADMIN_PASSWORD`, `TEA_SESSION_SECRET`, and `TEA_PREVIEW_SECRET` as Worker secrets or in ignored local `.dev.vars`.

The zero `database_id` and example bucket name in `wrangler.jsonc` are placeholders. Create account resources and replace them before deploying. Hostnames, DNS, account IDs, and production secrets belong in the infrastructure repo.
