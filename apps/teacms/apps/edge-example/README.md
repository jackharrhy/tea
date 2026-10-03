# TeaCMS Cloudflare example

This is a separate Worker host for `@teacms/edge`. It demonstrates D1 and R2 bindings and a small collection definition. It does not contain a public site renderer; add your own Remix routes through `createEdgeRouter`'s `extend` callback when making a real site.

From the Tea repository root, install dependencies, then run `npm run dev --workspace @teacms/edge-example`. Apply `../../packages/edge/db/schema.sql` to its D1 database before using the editor. Set `TEA_ADMIN_PASSWORD`, `TEA_SESSION_SECRET`, and `TEA_PREVIEW_SECRET` as Worker secrets (or ignored local `.dev.vars`).

The zero `database_id` and example bucket name in `wrangler.jsonc` are placeholders. Create resources for the target account and replace those values before deploying. Hostnames, DNS, account IDs, and production secrets are managed in the separate infrastructure repository.
