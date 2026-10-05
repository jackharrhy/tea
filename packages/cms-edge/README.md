# @tea/cms-edge

The Remix 3 CMS runtime for Cloudflare Workers. The host supplies collections and Cloudflare bindings. This package handles the editor, drafts and publishing, content and preview endpoints, media, and sessions. Add public Remix routes through `createEdgeRouter(env, config, extend)` so the site and `/tea` share one Worker and router.

Exports: `@tea/cms-edge` (router), `@tea/cms-edge/content` (reads), `@tea/cms-edge/preview` (tokens), and `@tea/cms-edge/schema.sql` (D1 schema). See the [Worker example](example/README.md). A real host owns site rendering, bindings, and deployment.

Apply `db/schema.sql` to D1 before serving requests. Bind D1 as `DB`, R2 as `MEDIA`, and set `TEA_ADMIN_PASSWORD`, `TEA_SESSION_SECRET`, and `TEA_PREVIEW_SECRET` as Worker secrets. Set `TEA_EDITOR_ORIGIN` if TLS terminates before the Worker. Optional `previewUrl` makes a signed, short-lived public preview link; validate it with `@tea/cms-edge/preview`.

The host renders public pages. Read published content from its D1 binding with `getEntry(env.DB, collection, slug)` or `listEntries(env.DB, collection)` from `@tea/cms-edge/content`. Pass `true` for draft reads only after validating a signed token with `@tea/cms-edge/preview`. Public JSON lives at `/api/content/:collection` and `/api/content/:collection/:slug`; `/api/preview/*` requires `Authorization: Bearer <TEA_PREVIEW_SECRET>`.

`extend` receives `Router<EdgeContext>`. Create site controllers with `createController<typeof siteRoutes, EdgeContext>(siteRoutes, { actions: ... })`, then call `router.map(siteRoutes, controller)`. Remix's `render()` middleware is already installed, so actions can use `context.render(<Page />)`. Keep site routes outside `/tea` and `/api`.

From the root, run `npm ci` and `npm run check:cms-edge` for package and example typechecks plus edge tests in `app/__tests__/`. The example is part of this package, not a workspace.
