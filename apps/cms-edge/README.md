# @tea/cms-edge

This Remix 3 Cloudflare Worker app serves a CMS editor and content API backed by D1 and R2. `worker.ts` starts the Worker with a sample `pages` collection. `app/` owns the router, auth, content, previews, media, and UI; `db/schema.sql` defines its D1 tables. The Worker has no public site renderer yet. Add public Remix routes through `createEdgeRouter`'s `extend` callback in `worker.ts`.

Bind D1 as `DB` and R2 as `MEDIA`. Set `TEA_ADMIN_PASSWORD`, `TEA_SESSION_SECRET`, and `TEA_PREVIEW_SECRET` in ignored `.dev.vars` locally or as Worker secrets when deployed. Apply `db/schema.sql` to D1 before using the editor. `wrangler.jsonc` has placeholder resource identifiers; replace them with real resources before deployment. Hostnames, account IDs, and production secrets belong in the infrastructure repo.

The editor is under `/tea`; published JSON is at `/api/content/:collection` and `/api/content/:collection/:slug`. `/api/preview/*` requires `Authorization: Bearer <TEA_PREVIEW_SECRET>`. `TEA_EDITOR_ORIGIN` is available if TLS terminates before the Worker. Editor input uses [`@tea/request-body`](../../packages/request-body/README.md) for a 16 KiB stream limit, and request records use [`@tea/logger`](../../packages/logger/README.md).

From the repo root, run `npm ci`, then `npm run cms-edge:check`. Use `npm run cms-edge:dev` for local development. The check generates Worker types, typechecks, runs tests in `app/__tests__/`, and bundles a dry-run deployment. Deploy only after replacing the resource placeholders and setting secrets.
