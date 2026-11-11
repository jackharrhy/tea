# @harrhy/cms-edge

This Remix 3 Cloudflare Worker app serves a CMS editor and content API backed by D1 and R2. `worker.ts` starts the Worker with a sample `pages` collection. `app/` owns the router, auth, content, previews, media, and UI; `db/schema.sql` defines its D1 tables. The Worker has no public site renderer yet. Add public Remix routes through `createEdgeRouter`'s `extend` callback in `worker.ts`.

`app/styles.ts` holds the editor's Remix `css(...)` mixin.

Bind D1 as `DB` and R2 as `MEDIA`. Set `TEA_ADMIN_PASSWORD`, `TEA_SESSION_SECRET`, and `TEA_PREVIEW_SECRET` in ignored `.dev.vars` locally or as Worker secrets when deployed. Apply `db/schema.sql` to D1 before using the editor. `cloudflare.config.ts` has a placeholder D1 identifier; replace it with a real resource before deployment. Hostnames, account IDs, and production secrets belong in the infrastructure repo.

For Central Auth instead of the prototype editor password, set
`TEA_EDITOR_ORIGIN`, `TEA_AUTH_ISSUER`, `TEA_AUTH_CLIENT_ID`,
`TEA_AUTH_PROJECT_ID`, `TEA_AUTH_ORGANIZATION_ID`, and a reviewed immutable
`TEA_AUTH_OWNER_SUBJECT`. The exact public PKCE callback is
`<TEA_EDITOR_ORIGIN>/tea/auth/callback`. A project admin grant and exact owner
subject are both required; password sessions become invalid. The signed local
session expires after one hour. `TEA_SESSION_SECRET` remains necessary for the
session signature. If the host configures preview links, their short-lived
signatures still require `TEA_PREVIEW_SECRET`; the sample Worker has no preview
links and needs no such secret in Central mode. The secret never authorizes the
preview API in Central mode. That API requires an
introspected human project-admin token and the dedicated
`TEA_AUTH_INTROSPECTION_CLIENT_ID` and `TEA_AUTH_INTROSPECTION_SECRET`
resource credentials. This prototype has no production origin or Auth client
yet, so it is not part of a live cutover.

The editor is under `/tea`; published JSON is at `/api/content/:collection` and `/api/content/:collection/:slug`. In password mode, `/api/preview/*` requires `Authorization: Bearer <TEA_PREVIEW_SECRET>`; Central mode uses a human admin resource token instead. `TEA_EDITOR_ORIGIN` sets the canonical editor origin. Editor input uses [`@harrhy/request-body`](../../packages/request-body/README.md) for a 16 KiB stream limit, and request records use [`@harrhy/logger`](../../packages/logger/README.md).

From the repo root, run `npm ci`, then `npm run cms-edge:check`. Use `npm run cms-edge:dev` for local development. The Cloudflare `cf` CLI reads `cloudflare.config.ts` and uses the Vite plugin to build the Worker. The check generates Worker types, typechecks, runs tests in `app/__tests__/`, and builds the Worker. Deploy only after replacing the resource placeholder and setting secrets.
