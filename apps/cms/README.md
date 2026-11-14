# TeaCMS

This Remix 3 Node app is the multi-site CMS. It selects sites by hostname and uses [`@harrhy/rich-text`](../../packages/rich-text/README.md), [`@harrhy/mcp`](../../packages/mcp/README.md), and other shared packages. Andrew and Luke each keep their presentation and assets under `sites/`, exported as `@harrhy/cms/sites/andrew` and `@harrhy/cms/sites/luke`.

`server.ts` starts the server, `config.ts` registers sites and origins, and `app.ts` connects each site to its router. `app/` owns routes, controllers, editor UI, storage, and assets; `createContentStore` and `createAuthStore` bind storage to a database. `operator/` owns the dashboard and `createOperatorStore`; `db/` holds SQLite migrations. Keep site code and assets in `sites/<id>/`.

UI styles use Remix `css(...)` mixins in `app/ui/`, `operator/`, and each site's `app/styles.ts`. `public/fonts.css` contains only the Inter font faces.

The Node host opens a request record through [`@harrhy/logger`](../../packages/logger/README.md). MCP handlers enrich that record. Request bodies, headers, and raw URLs are not logged.

Public HTML pages, including public pages on preview sites, support Brotli and gzip through Remix's response compression. Operator and editor routes, requests with cookies or authorization, and query variants are excluded. Pages still render from current published data on each request; this is not a page cache. Media and API responses retain their existing transport behavior.

HTML responses use Remix request nonces for scripts and generated styles, including the operator, editors, and public pages. They are private and no-store; anonymous public pages can still be compressed. Public pages allow the site's video embeds and enabled Google Analytics, while preview and CMS pages continue to suppress analytics.

## Develop

Use Node.js 26 LTS (minimum 26.13.0). From the repo root:

```sh
npm ci
npm run cms:dev
```

Checks:

```sh
npm run cms:check
npx playwright install chromium
npm run test:browser --workspace @harrhy/cms
```

Host tests and fixtures live in `__tests__/`; feature tests live in `__tests__/` beside their code. Operational scripts live in `scripts/`. See [Compose](../../compose.yml) and [operations](../../docs/cms/operations.md) for deployment and data, [MCP](../../docs/cms/mcp.md) for the optional read-only endpoint, and [AGENTS.md](AGENTS.md) for CMS editing rules.

## App-owned backups

`backup/` owns the optional daily scheduler, SQLite/media snapshots, seven-generation
retention and private status receipts. Set `TEA_BACKUP_DIR` to a distinct persistent
mount (local Compose uses `cms-backups:/app/backups`). The authenticated operator
dashboard shows status; public health does not expose it. All configured site
DB/uploads/public trees and the optional operator DB are included. See
[backup configuration, consistency and offline restore](../../docs/cms/backups.md).
Database snapshots are individually consistent, not a cross-database instant.
Local snapshots are not off-host disaster recovery. The separate production Andrew
site and its legacy media are outside this app's backup scope.

## Central Auth transition

The existing operator and site password logins stay active until the operator
has a reviewed Central Auth subject link and live browser/editor acceptance.
The first Central cutover can link only the operator: the existing one-use,
site-bound tickets still let the operator enter both editors. Direct site
login stays unavailable until each editor has an explicit reviewed link. Set
`TEA_AUTH_ISSUER`, `TEA_AUTH_PROJECT_ID`,
`TEA_AUTH_ORGANIZATION_ID`, and the three public client IDs
`TEA_AUTH_OPERATOR_CLIENT_ID`, `TEA_AUTH_ANDREW_CLIENT_ID`, and
`TEA_AUTH_LUKE_CLIENT_ID` together to enable Central mode. The exact callbacks
are `/auth/callback` on the operator host and `/tea/auth/callback` on each site
host. The app requires an existing local user row with a reviewed
`auth_subject`; it never links by email or creates an editor on sign-in.
Operator sign-in requires the CMS project admin grant; site editor sign-in
requires member or admin plus that site's local subject link. Operator tickets
continue to grant temporary access to site editors. Central sessions expire
after one hour, and old password sessions are rejected as soon as Central mode
is enabled. Log out clears the local session.

Central mode also replaces the shared read-only `TEA_MCP_TOKEN` with a human
CMS-admin resource token. Configure `TEA_AUTH_INTROSPECTION_CLIENT_ID` and
`TEA_AUTH_INTROSPECTION_SECRET` for that endpoint; the site resource metadata
is at `/.well-known/oauth-protected-resource/tea/mcp`. Production identity
links, provider grants, secrets and rollout belong to the Auth and Infra
owners, not this repository.

With the CMS stopped and backed up, apply a private mode-0600 reviewed link
manifest of `{ "operator": [{ "id": 1, "subject": "..." }], "sites": {
"andrew": [], "luke": [] } }` for the initial operator-only cutover. Add
site links only after the corresponding local IDs and Central subjects are
reviewed. Use the actual reviewed local IDs; the example operator ID is a
placeholder. First run `npm run link:central-auth --workspace @harrhy/cms --
/private/links.json` to validate every target without changing links, then
repeat with `--apply`. The command rejects unknown IDs, conflicting links,
duplicate subjects within a database, missing schema migrations, and missing
database files. It reports counts only. A retry with the same manifest is
idempotent. Keep the existing SQLite backup until production acceptance.

The [CMS publish workflow](../../.github/workflows/publish-cms.yml) runs on `main` changes to this app or its shared dependencies. It checks the CMS and publishes `ghcr.io/jackharrhy/teacms:latest` plus a commit tag. It can also be started manually. Mug follows `latest` with Watchtower; the commit tag supports rollback.
