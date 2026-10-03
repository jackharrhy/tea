# @teacms/edge

A standalone TeaCMS runtime for Cloudflare Workers. The host app supplies collection definitions and Cloudflare bindings; TeaCMS owns the Remix UI editor, draft/publish separation, public and preview content endpoints, media, and session handling. A host maps its own public Remix routes through `createEdgeRouter(env, config, extend)` so public pages and `/tea` run on the same Worker and router.

Apply `db/schema.sql` to the instance's D1 database before serving requests. Bind the database as `DB` and an R2 bucket as `MEDIA`. Set `TEA_ADMIN_PASSWORD`, `TEA_SESSION_SECRET`, and `TEA_PREVIEW_SECRET` as Worker secrets. Set `TEA_EDITOR_ORIGIN` when TLS terminates before the Worker. The optional `previewUrl` callback creates a signed, short-lived link to the public renderer; the renderer can validate it with `@teacms/edge/preview`.

The public renderer belongs to the host app. Read published content directly from the same D1 binding with `getEntry(env.DB, collection, slug)` or `listEntries(env.DB, collection)` from `@teacms/edge/content`. Pass `true` as the final argument for draft reads only after checking a signed preview token with `@teacms/edge/preview`. Public JSON endpoints remain available at `/api/content/:collection` and `/api/content/:collection/:slug`; `/api/preview/*` requires `Authorization: Bearer <TEA_PREVIEW_SECRET>`.

The `extend` callback receives `Router<EdgeContext>`. Create site controllers with `createController<typeof siteRoutes, EdgeContext>(siteRoutes, { actions: ... })`, then call `router.map(siteRoutes, controller)`. The router already has Remix's `render()` middleware, so site actions can call `context.render(<Page />)`. Keep site routes outside TeaCMS's `/tea` and `/api` namespaces.
