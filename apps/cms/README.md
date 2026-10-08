# TeaCMS

This Remix 3 Node app is the multi-site CMS. It selects sites by hostname and uses [`@tea/rich-text`](../../packages/rich-text/README.md), [`@tea/mcp`](../../packages/mcp/README.md), and other shared packages. Andrew and Luke each keep their presentation and assets under `sites/`, exported as `@tea/cms/sites/andrew` and `@tea/cms/sites/luke`.

`server.ts` starts the server, `config.ts` registers sites and origins, and `app.ts` connects each site to its router. `app/` owns routes, controllers, editor UI, storage, and assets; `createContentStore` and `createAuthStore` bind storage to a database. `operator/` owns the dashboard and `createOperatorStore`; `db/` holds SQLite migrations. Keep site code and assets in `sites/<id>/`.

UI styles use Remix `css(...)` mixins in `app/ui/`, `operator/`, and each site's `app/styles.ts`. `public/fonts.css` contains only the Inter font faces.

The Node host opens a request record through [`@tea/logger`](../../packages/logger/README.md). MCP handlers enrich that record. Request bodies, headers, and raw URLs are not logged.

## Develop

Use the latest Node.js 24 LTS release (minimum 24.3). From the repo root:

```sh
npm ci
npm run cms:dev
```

Checks:

```sh
npm run cms:check
npx playwright install chromium
npm run test:browser --workspace @tea/cms
```

Host tests and fixtures live in `__tests__/`; feature tests live near their code. Operational scripts live in `scripts/`. See [Compose](../../compose.yml) and [operations](../../docs/cms/operations.md) for deployment and data, [MCP](../../docs/cms/mcp.md) for the optional read-only endpoint, and [AGENTS.md](AGENTS.md) for CMS editing rules.

The [CMS publish workflow](../../.github/workflows/publish-cms.yml) runs on `main` changes to this app or its shared dependencies. It checks the CMS and publishes `ghcr.io/jackharrhy/tea-cms:latest` plus a commit tag. It can also be started manually. Mug follows `latest` with Watchtower; the commit tag supports rollback.
