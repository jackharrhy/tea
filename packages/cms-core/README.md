# @tea/cms-core

The Remix 3 Node runtime for [`@tea/cms`](../../apps/cms/README.md): routes and controllers, SQLite content and auth stores, media, public and editor UI, and optional MCP. The app defines sites and selects a tenant before calling the router.

## Entry points

- `@tea/cms-core/router.ts` exports `createTeaRouter` for one resolved site and database.
- `@tea/cms-core/site.ts` defines the site contract.
- `@tea/cms-core/data/*` contains SQLite stores; migrations live in `db/migrations/`.
- `app/actions/admin/controller.tsx` wires admin routes; `page-actions.tsx` owns page editing and publishing.
- `app/actions/input.ts` reads bounded editor input through [`@tea/request-body`](../request-body/README.md).
- `app/mcp/handler.ts` registers published-content tools with [`@tea/mcp`](../mcp/README.md) and [`@tea/json-schema`](../json-schema/README.md).

Modules export through `@tea/cms-core/*`. This package must not depend on the Node host or a site's presentation. The host selects hostnames, starts the server, and configures deployment.

## Working here

From the root, run `npm ci` and `npm run cms:check` to check this package, its host, and tests. Keep tests in nearby `__tests__/` directories. Runtime setup is in the [CMS app guide](../../apps/cms/README.md).
